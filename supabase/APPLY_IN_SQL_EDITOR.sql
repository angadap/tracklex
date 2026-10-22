-- Tracklex 0005: organiser permission levels, and players who are also organisers.
-- profiles.sport + profiles.perms describe what a person may run:
--   * an organiser account (username + password) always has them
--   * a PLAYER account can be given them by the admin ("make a player an organiser"): same mobile + PIN login, same players,
--     plus the tournament console for one sport
-- perms is any of: categories (categories and fees), entries (entries and payments), draws, scores.

alter table public.profiles add column if not exists perms text[] not null default '{}';
update public.profiles set perms = array['categories','entries','draws','scores'] where role = 'organiser' and cardinality(perms) = 0;

alter table public.profiles drop constraint if exists profiles_check;
alter table public.profiles drop constraint if exists profiles_shape;
alter table public.profiles add constraint profiles_shape check (
  perms <@ array['categories','entries','draws','scores']
  and (
    (role = 'player' and mobile is not null and username is null
       and ((sport is null and cardinality(perms) = 0) or (sport is not null and cardinality(perms) > 0)))
    or (role = 'admin' and username is not null and mobile is null and sport is null and cardinality(perms) = 0)
    or (role = 'organiser' and username is not null and sport is not null and mobile is null and cardinality(perms) > 0)
  )
);

-- Does the caller run anything in this sport at all? (admin: every sport)
create or replace function public.can_manage(p_sport text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_sport is not null and coalesce(
    (select role = 'admin' or (sport = p_sport and cardinality(perms) > 0) from public.profiles where id = auth.uid()),
    false)
$$;

-- Does the caller hold this specific permission in this sport? (admin: all of them)
create or replace function public.has_perm(p_sport text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_sport is not null and coalesce(
    (select role = 'admin' or (sport = p_sport and p_perm = any (perms)) from public.profiles where id = auth.uid()),
    false)
$$;

-- Raises a friendly error unless the caller may do `p_perm` in `p_sport`.
create or replace function public.require_perm(p_sport text, p_perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage(p_sport) then raise exception 'You can only manage the tournament you are assigned to.'; end if;
  if not public.has_perm(p_sport, p_perm) then raise exception 'You do not have permission for this. Ask the admin.'; end if;
end $$;

-- Entries (with payment status) and player details are for people who hold the "entries" permission.
create or replace function public.player_in_my_sport(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    join public.categories c on c.id = r.category_id
    where r.player_id = p_player and public.has_perm(c.sport, 'entries'))
$$;

drop policy if exists registrations_read on public.registrations;
create policy registrations_read on public.registrations for select to authenticated
  using (public.owns_player(player_id) or public.has_perm(public.category_sport(category_id), 'entries'));
-- Tracklex 0006: tournaments, stages (the structure of rounds) and match slots.
--   sport -> tournament (one event of one sport, e.g. "Warje Olympics 2026 · Table Tennis")
--         -> categories (age / gender groups; entries are per category)
--         -> stages (the rounds structure of a category: knockout, round robin, or custom; stages chain, e.g. groups then knockout)
--         -> matches (match slots: who plays whom, when, and the result)

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  sport text not null references public.sports (slug),
  name text not null check (length(trim(name)) > 0),
  season int not null check (season between 2000 and 2100),
  age_cutoff date not null,                       -- ages are counted on this date
  starts_on date,
  ends_on date,
  reg_open boolean not null default true,         -- players can enter while this is on
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index tournaments_sport_idx on public.tournaments (sport);

alter table public.categories add column tournament_id uuid not null references public.tournaments (id) on delete restrict;
create index categories_tournament_idx on public.categories (tournament_id);

create table public.stages (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  seq int not null check (seq >= 1),              -- order inside the category
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('knockout', 'round_robin', 'custom')),
  groups int not null default 1 check (groups between 1 and 16),   -- round robin: how many groups
  legs int not null default 1 check (legs between 1 and 2),        -- round robin: 2 = everyone plays everyone twice
  advance int not null default 0 check (advance between 0 and 64), -- round robin / custom: how many per group go to the next stage
  created_at timestamptz not null default now(),
  unique (category_id, seq)
);
create index stages_category_idx on public.stages (category_id);

alter table public.matches add column stage_id uuid not null references public.stages (id) on delete cascade;
alter table public.matches add column group_no int;
alter table public.matches add column scheduled_at timestamptz;
alter table public.matches alter column p1_reg_id drop not null;     -- a slot can exist before its players are known
alter table public.matches add constraint matches_bye_shape check (not bye or (p1_reg_id is not null and p2_reg_id is null));
create index matches_stage_idx on public.matches (stage_id);

-- ---------- read access (public, like categories and matches) ----------
alter table public.tournaments enable row level security;
alter table public.stages enable row level security;
create policy tournaments_read on public.tournaments for select to anon, authenticated using (true);
create policy stages_read on public.stages for select to anon, authenticated using (true);
grant select on public.tournaments, public.stages to anon, authenticated;

create or replace function public.tournament_sport(p_t uuid) returns text
language sql stable security definer set search_path = public as $$
  select sport from public.tournaments where id = p_t
$$;

create or replace function public.stage_category(p_stage uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select category_id from public.stages where id = p_stage
$$;

create or replace function public.stage_sport(p_stage uuid) returns text
language sql stable security definer set search_path = public as $$
  select c.sport from public.stages s join public.categories c on c.id = s.category_id where s.id = p_stage
$$;

-- Table of a round-robin / custom stage, per group. Order: wins, then game difference, then games won, then entry id (so it is stable).
create or replace function public.stage_standings(p_stage uuid)
returns table (group_no int, reg_id uuid, played int, won int, lost int, gf int, ga int, rank int)
language sql stable security definer set search_path = public as $$
  with played as (
    select m.group_no, m.p1_reg_id as reg_id, m.score1 as f, m.score2 as a, (m.winner_reg_id = m.p1_reg_id) as win
    from public.matches m
    where m.stage_id = p_stage and m.status = 'done' and not m.bye and m.p1_reg_id is not null and m.p2_reg_id is not null
    union all
    select m.group_no, m.p2_reg_id, m.score2, m.score1, (m.winner_reg_id = m.p2_reg_id)
    from public.matches m
    where m.stage_id = p_stage and m.status = 'done' and not m.bye and m.p1_reg_id is not null and m.p2_reg_id is not null
  ), members as (
    select m.group_no, m.p1_reg_id as reg_id from public.matches m where m.stage_id = p_stage and m.p1_reg_id is not null
    union
    select m.group_no, m.p2_reg_id from public.matches m where m.stage_id = p_stage and m.p2_reg_id is not null
  ), agg as (
    select mem.group_no, mem.reg_id,
           count(p.reg_id)::int as played,
           (count(*) filter (where p.win))::int as won,
           (count(*) filter (where p.reg_id is not null and not p.win))::int as lost,
           coalesce(sum(p.f), 0)::int as gf,
           coalesce(sum(p.a), 0)::int as ga
    from members mem
    left join played p on p.reg_id = mem.reg_id and p.group_no is not distinct from mem.group_no
    group by mem.group_no, mem.reg_id
  )
  select a.group_no, a.reg_id, a.played, a.won, a.lost, a.gf, a.ga,
         (row_number() over (partition by a.group_no order by a.won desc, (a.gf - a.ga) desc, a.gf desc, a.reg_id::text asc))::int
  from agg a
$$;
-- Tracklex 0007 (needs 0005 and 0006 first): every write goes through one of these functions. Each checks who is calling and the tournament rules,
-- so a modified app cannot bypass them. Error messages are written for people (the app shows them as they are).

-- ---------- players ----------
create or replace function public.save_player(p_id uuid, p_name text, p_dob date, p_gender text, p_society text, p_relation text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.my_role() is distinct from 'player' then raise exception 'Sign in with a player account first.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the player''s name.'; end if;
  if p_dob is null or p_dob > current_date then raise exception 'Enter a valid date of birth.'; end if;
  if p_gender is null or p_gender not in ('M', 'F') then raise exception 'Choose male or female.'; end if;
  if p_relation is null or p_relation not in ('self', 'child') then raise exception 'Choose who this player is.'; end if;
  if p_id is null then
    insert into public.players (account_id, name, dob, gender, society, relation)
    values (auth.uid(), trim(p_name), p_dob, p_gender, trim(coalesce(p_society, '')), p_relation)
    returning id into v_id;
  else
    update public.players set name = trim(p_name), dob = p_dob, gender = p_gender,
           society = trim(coalesce(p_society, '')), relation = p_relation
    where id = p_id and account_id = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'Player not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.remove_player(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'player' then raise exception 'Sign in with a player account first.'; end if;
  if not public.owns_player(p_id) then raise exception 'Player not found.'; end if;
  if exists (select 1 from public.registrations where player_id = p_id) then
    raise exception 'Withdraw this player''s entries first.';
  end if;
  delete from public.players where id = p_id;
end $$;

-- Admin only: organisers can see players entered in their sport but never change a profile.
create or replace function public.admin_save_player(p_id uuid, p_name text, p_dob date, p_gender text, p_society text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do this.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the player''s name.'; end if;
  if p_dob is null or p_dob > current_date then raise exception 'Enter a valid date of birth.'; end if;
  if p_gender is null or p_gender not in ('M', 'F') then raise exception 'Choose male or female.'; end if;
  update public.players set name = trim(p_name), dob = p_dob, gender = p_gender, society = trim(coalesce(p_society, ''))
  where id = p_id;
  if not found then raise exception 'Player not found.'; end if;
end $$;

create or replace function public.admin_remove_player(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do this.'; end if;
  if exists (select 1 from public.registrations where player_id = p_id) then
    raise exception 'Withdraw this player''s entries first.';
  end if;
  delete from public.players where id = p_id;
  if not found then raise exception 'Player not found.'; end if;
end $$;

-- ---------- entries ----------
create or replace function public.register_entry(p_player_id uuid, p_category_id uuid, p_partner text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare pl public.players; c public.categories; t public.tournaments; v_age int; v_id uuid;
begin
  if public.my_role() is distinct from 'player' then raise exception 'Sign in with a player account first.'; end if;
  select * into pl from public.players where id = p_player_id;
  select * into c from public.categories where id = p_category_id;
  if pl.id is null or c.id is null then raise exception 'Player or category not found.'; end if;
  if pl.account_id <> auth.uid() then raise exception 'You can only enter your own players.'; end if;
  select * into t from public.tournaments where id = c.tournament_id;
  if not t.reg_open then raise exception 'Entries for this tournament are closed.'; end if;
  v_age := extract(year from age(t.age_cutoff::timestamp, pl.dob::timestamp))::int;
  if not (v_age between c.min_age and c.max_age and (c.gender = 'X' or c.gender = pl.gender)) then
    raise exception '% is not eligible for %.', pl.name, c.name;
  end if;
  if exists (select 1 from public.registrations where player_id = p_player_id and category_id = p_category_id) then
    raise exception 'Already entered in this category.';
  end if;
  if exists (select 1 from public.matches where category_id = p_category_id) then
    raise exception 'The draw for this category has started. Entries are closed.';
  end if;
  if c.format = 'doubles' and coalesce(trim(p_partner), '') = '' then
    raise exception 'Enter your doubles partner''s name.';
  end if;
  insert into public.registrations (player_id, category_id, partner_name)
  values (p_player_id, p_category_id, case when c.format = 'doubles' then trim(p_partner) else '' end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.withdraw_entry(p_reg_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into r from public.registrations where id = p_reg_id;
  if r.id is null then raise exception 'Entry not found.'; end if;
  if exists (select 1 from public.matches where p1_reg_id = p_reg_id or p2_reg_id = p_reg_id) then
    raise exception 'The draw has started. Clear this category''s draw first.';
  end if;
  if not (public.owns_player(r.player_id) or public.has_perm(public.category_sport(r.category_id), 'entries')) then
    raise exception 'Not allowed.';
  end if;
  delete from public.registrations where id = p_reg_id;
end $$;

create or replace function public.set_paid(p_reg_id uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.registrations;
begin
  select * into r from public.registrations where id = p_reg_id;
  if r.id is null then raise exception 'Entry not found.'; end if;
  perform public.require_perm(public.category_sport(r.category_id), 'entries');
  update public.registrations set paid = coalesce(p_paid, false), paid_at = case when p_paid then now() end where id = p_reg_id;
end $$;

-- ---------- tournaments ----------
create or replace function public.save_tournament(p_id uuid, p_sport text, p_name text, p_season int, p_age_cutoff date,
                                                  p_starts_on date, p_ends_on date, p_reg_open boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_perm(p_sport, 'categories');
  if p_id is not null and public.tournament_sport(p_id) is distinct from p_sport then
    raise exception 'You can only manage the tournament you are assigned to.';
  end if;
  if not exists (select 1 from public.sports where slug = p_sport) then raise exception 'Choose a sport.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a tournament name.'; end if;
  if p_season is null or p_season < 2000 or p_season > 2100 then raise exception 'Enter a valid season year.'; end if;
  if p_age_cutoff is null then raise exception 'Choose the date ages are counted on.'; end if;
  if p_starts_on is not null and p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The end date cannot be before the start date.';
  end if;
  if p_id is null then
    insert into public.tournaments (sport, name, season, age_cutoff, starts_on, ends_on, reg_open)
    values (p_sport, trim(p_name), p_season, p_age_cutoff, p_starts_on, p_ends_on, coalesce(p_reg_open, true))
    returning id into v_id;
  else
    update public.tournaments set name = trim(p_name), season = p_season, age_cutoff = p_age_cutoff,
           starts_on = p_starts_on, ends_on = p_ends_on, reg_open = coalesce(p_reg_open, true)
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Tournament not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.tournament_sport(p_id) is null then raise exception 'Tournament not found.'; end if;
  perform public.require_perm(public.tournament_sport(p_id), 'categories');
  if exists (select 1 from public.registrations r join public.categories c on c.id = r.category_id where c.tournament_id = p_id) then
    raise exception 'This tournament has entries. Withdraw them first.';
  end if;
  delete from public.categories where tournament_id = p_id;
  delete from public.tournaments where id = p_id;
end $$;

-- ---------- categories (age / gender groups inside a tournament) ----------
create or replace function public.save_category(p_id uuid, p_tournament uuid, p_name text, p_gender text, p_format text,
                                                p_min_age int, p_max_age int, p_fee int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sport text := public.tournament_sport(p_tournament); v_fee int := coalesce(p_fee, 0);
begin
  if v_sport is null then raise exception 'Tournament not found.'; end if;
  perform public.require_perm(v_sport, 'categories');
  if p_id is not null and not exists (select 1 from public.categories where id = p_id and tournament_id = p_tournament) then
    raise exception 'Category not found.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a category name.'; end if;
  if p_gender is null or p_gender not in ('M', 'F', 'X') then raise exception 'Choose men, women or mixed.'; end if;
  if p_format is null or p_format not in ('singles', 'doubles') then raise exception 'Choose singles or doubles.'; end if;
  if p_min_age is null or p_max_age is null or p_min_age < 0 or p_max_age < p_min_age then
    raise exception 'Enter a valid age range (minimum cannot be above maximum).';
  end if;
  if v_fee < 0 then raise exception 'Fee cannot be negative.'; end if;
  if p_id is null then
    insert into public.categories (tournament_id, sport, name, gender, format, min_age, max_age, fee)
    values (p_tournament, v_sport, trim(p_name), p_gender, p_format, p_min_age, p_max_age, v_fee) returning id into v_id;
    -- every category starts with one knockout stage; change it, or add more stages, in the category's rounds setup
    insert into public.stages (category_id, seq, name, kind) values (v_id, 1, 'Knockout', 'knockout');
  else
    update public.categories set name = trim(p_name), gender = p_gender, format = p_format,
           min_age = p_min_age, max_age = p_max_age, fee = v_fee
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.category_sport(p_id) is null then raise exception 'Category not found.'; end if;
  perform public.require_perm(public.category_sport(p_id), 'categories');
  if exists (select 1 from public.registrations where category_id = p_id) then
    raise exception 'This category has entries. Withdraw them first.';
  end if;
  delete from public.categories where id = p_id;
end $$;

create or replace function public.add_starter_categories(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_sport text := public.tournament_sport(p_tournament);
begin
  if v_sport is null then raise exception 'Tournament not found.'; end if;
  perform public.require_perm(v_sport, 'categories');
  with ins as (
    insert into public.categories (tournament_id, sport, name, gender, format, min_age, max_age, fee)
    select p_tournament, v_sport, b.name, g.gender, 'singles', b.min_age, b.max_age, 0
    from (values ('Under 10', 0, 9), ('10–17', 10, 17), ('18–45', 18, 45), ('46–60', 46, 60), ('Above 60', 61, 120))
         as b(name, min_age, max_age)
    cross join (values ('M'), ('F')) as g(gender)
    returning id
  )
  insert into public.stages (category_id, seq, name, kind) select id, 1, 'Knockout', 'knockout' from ins;
end $$;

-- ---------- stages: the structure of rounds inside a category ----------
create or replace function public.save_stage(p_id uuid, p_category uuid, p_name text, p_kind text,
                                             p_groups int, p_legs int, p_advance int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; st public.stages; v_groups int; v_legs int; v_adv int;
begin
  if public.category_sport(p_category) is null then raise exception 'Category not found.'; end if;
  perform public.require_perm(public.category_sport(p_category), 'categories');
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a name for this stage.'; end if;
  if p_kind is null or p_kind not in ('knockout', 'round_robin', 'custom') then raise exception 'Choose a stage format.'; end if;
  v_groups := case when p_kind = 'round_robin' then coalesce(p_groups, 1) else 1 end;
  v_legs := case when p_kind = 'round_robin' then coalesce(p_legs, 1) else 1 end;
  v_adv := case when p_kind = 'knockout' then 0 else coalesce(p_advance, 0) end;
  if v_groups < 1 or v_groups > 16 then raise exception 'Choose between 1 and 16 groups.'; end if;
  if v_legs not in (1, 2) then raise exception 'Choose single or double round robin.'; end if;
  if v_adv < 0 or v_adv > 64 then raise exception 'Enter how many players advance (0 to 64).'; end if;
  if p_id is null then
    insert into public.stages (category_id, seq, name, kind, groups, legs, advance)
    values (p_category, coalesce((select max(seq) from public.stages where category_id = p_category), 0) + 1,
            trim(p_name), p_kind, v_groups, v_legs, v_adv)
    returning id into v_id;
  else
    select * into st from public.stages where id = p_id and category_id = p_category;
    if st.id is null then raise exception 'Stage not found.'; end if;
    if exists (select 1 from public.matches where stage_id = p_id)
       and (st.kind <> p_kind or st.groups <> v_groups or st.legs <> v_legs) then
      raise exception 'This stage already has matches. Clear them before changing its format.';
    end if;
    update public.stages set name = trim(p_name), kind = p_kind, groups = v_groups, legs = v_legs, advance = v_adv
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_stage(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.stage_sport(p_id) is null then raise exception 'Stage not found.'; end if;
  perform public.require_perm(public.stage_sport(p_id), 'categories');
  if exists (select 1 from public.matches where stage_id = p_id) then
    raise exception 'This stage has matches. Clear them first.';
  end if;
  delete from public.stages where id = p_id;
end $$;

-- p_dir: -1 earlier, +1 later. Both stages must still be empty.
create or replace function public.move_stage(p_id uuid, p_dir int)
returns void language plpgsql security definer set search_path = public as $$
declare a public.stages; b public.stages;
begin
  if public.stage_sport(p_id) is null then raise exception 'Stage not found.'; end if;
  perform public.require_perm(public.stage_sport(p_id), 'categories');
  select * into a from public.stages where id = p_id;
  if p_dir < 0 then
    select * into b from public.stages where category_id = a.category_id and seq < a.seq order by seq desc limit 1;
  else
    select * into b from public.stages where category_id = a.category_id and seq > a.seq order by seq asc limit 1;
  end if;
  if b.id is null then return; end if;
  if exists (select 1 from public.matches where stage_id in (a.id, b.id)) then
    raise exception 'Clear the matches in both stages before changing their order.';
  end if;
  update public.stages set seq = 100000 where id = a.id;
  update public.stages set seq = a.seq where id = b.id;
  update public.stages set seq = b.seq where id = a.id;
end $$;

-- ---------- making matches ----------
-- Knockout: round 1 is a random draw (byes for odd counts); each call after that makes the next round from the winners.
-- Round robin: makes every match of every group at once. A later stage takes the players who advanced from the stage before it.
create or replace function public.generate_stage(p_stage uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  st public.stages; ps public.stages; v_cat uuid; v_ids uuid[]; v_n int; v_round int := 1; v_label text; k int;
  v_a uuid; v_b uuid; v_grp uuid[]; v_assign int[]; gi int; leg int; r int; i int; sz int; v_seq int; v_base int;
begin
  select * into st from public.stages where id = p_stage;
  if st.id is null then raise exception 'Stage not found.'; end if;
  v_cat := st.category_id;
  perform public.require_perm(public.category_sport(v_cat), 'draws');
  perform 1 from public.categories where id = v_cat for update;   -- one change at a time per category

  if st.kind = 'custom' then raise exception 'Add match slots to this stage by hand.'; end if;

  -- knockout stage that is already started: make the next round
  if st.kind = 'knockout' and exists (select 1 from public.matches where stage_id = p_stage) then
    select max(round) into v_round from public.matches where stage_id = p_stage;
    if exists (select 1 from public.matches where stage_id = p_stage and round = v_round and status <> 'done' and not bye) then
      raise exception 'Finish every match in this round first.';
    end if;
    select array_agg(winner_reg_id order by group_no nulls first, seq) into v_ids
    from public.matches where stage_id = p_stage and round = v_round and winner_reg_id is not null;
    if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'This stage already has a champion.'; end if;
    v_round := v_round + 1;
  else
    if exists (select 1 from public.matches where stage_id = p_stage) then
      raise exception 'This stage already has its matches.';
    end if;
    select * into ps from public.stages where category_id = v_cat and seq < st.seq order by seq desc limit 1;
    if ps.id is null then
      select array_agg(id order by random()) into v_ids from public.registrations where category_id = v_cat;
    else
      if not exists (select 1 from public.matches where stage_id = ps.id) then
        raise exception 'Make the matches of "%" first.', ps.name;
      end if;
      if exists (select 1 from public.matches where stage_id = ps.id and status <> 'done' and not bye) then
        raise exception 'Finish every match in "%" first.', ps.name;
      end if;
      if ps.kind = 'knockout' or ps.advance < 1 then
        raise exception '"%" does not send players to the next stage. Set how many advance in its settings.', ps.name;
      end if;
      select array_agg(reg_id order by random()) into v_ids from public.stage_standings(ps.id) where rank <= ps.advance;
    end if;
    if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'At least 2 entries are needed to make this stage.'; end if;
  end if;
  v_n := array_length(v_ids, 1);

  if st.kind = 'knockout' then
    v_label := case when v_n <= 2 then 'Final' when v_n <= 4 then 'Semi-finals' when v_n <= 8 then 'Quarter-finals'
                    else 'Round ' || v_round end;
    for k in 0 .. ((v_n + 1) / 2) - 1 loop
      v_a := v_ids[2 * k + 1];
      v_b := v_ids[2 * k + 2];   -- null when the count is odd: a bye
      insert into public.matches (category_id, stage_id, round, round_label, seq, p1_reg_id, p2_reg_id, winner_reg_id, status, bye)
      values (v_cat, p_stage, v_round, v_label, k, v_a, v_b,
              case when v_b is null then v_a end,
              case when v_b is null then 'done' else 'scheduled' end,
              v_b is null);
    end loop;
    return;
  end if;

  -- round robin
  if v_n < 2 * st.groups then raise exception 'Too many groups for % entries. Each group needs at least 2.', v_n; end if;
  for gi in 1 .. st.groups loop
    v_grp := '{}';
    for i in 1 .. v_n loop
      if ((i - 1) % st.groups) + 1 = gi then v_grp := v_grp || v_ids[i]; end if;
    end loop;
    sz := array_length(v_grp, 1);
    if sz % 2 = 1 then v_grp := v_grp || null::uuid; sz := sz + 1; end if;
    for leg in 1 .. st.legs loop
      for r in 1 .. sz - 1 loop
        v_base := (leg - 1) * (sz - 1) + r;
        for i in 0 .. sz / 2 - 1 loop
          v_a := v_grp[i + 1];
          v_b := v_grp[sz - i];
          if v_a is not null and v_b is not null then
            select coalesce(max(seq), -1) + 1 into v_seq from public.matches where stage_id = p_stage and round = v_base;
            insert into public.matches (category_id, stage_id, round, round_label, seq, p1_reg_id, p2_reg_id, status, group_no)
            values (v_cat, p_stage, v_base, 'Round ' || v_base, v_seq,
                    case when leg = 2 then v_b else v_a end, case when leg = 2 then v_a else v_b end, 'scheduled', gi);
          end if;
        end loop;
        v_grp := array[v_grp[1]] || array[v_grp[sz]] || v_grp[2 : sz - 1];   -- rotate everyone but the first
      end loop;
      -- start the second leg from the original order
      if leg = 1 and st.legs = 2 then
        v_grp := '{}';
        for i in 1 .. v_n loop
          if ((i - 1) % st.groups) + 1 = gi then v_grp := v_grp || v_ids[i]; end if;
        end loop;
        if array_length(v_grp, 1) % 2 = 1 then v_grp := v_grp || null::uuid; end if;
      end if;
    end loop;
  end loop;
end $$;

-- A match slot added or changed by hand (any stage). Players may be left empty and filled in later.
create or replace function public.save_match(p_id uuid, p_stage uuid, p_p1 uuid, p_p2 uuid, p_label text,
                                             p_round int, p_when timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.matches; st public.stages; v_id uuid; v_cat uuid; v_round int := coalesce(p_round, 1);
begin
  if p_id is not null then
    select * into m from public.matches where id = p_id;
    if m.id is null then raise exception 'Match not found.'; end if;
    p_stage := m.stage_id;
  end if;
  select * into st from public.stages where id = p_stage;
  if st.id is null then raise exception 'Stage not found.'; end if;
  v_cat := st.category_id;
  perform public.require_perm(public.category_sport(v_cat), 'draws');
  if v_round < 1 then raise exception 'The round number must be 1 or more.'; end if;
  if p_p1 is not null and p_p1 = p_p2 then raise exception 'Choose two different players.'; end if;
  if p_p1 is not null and not exists (select 1 from public.registrations where id = p_p1 and category_id = v_cat) then
    raise exception 'Player 1 is not entered in this category.';
  end if;
  if p_p2 is not null and not exists (select 1 from public.registrations where id = p_p2 and category_id = v_cat) then
    raise exception 'Player 2 is not entered in this category.';
  end if;
  if exists (select 1 from public.stages s join public.matches x on x.stage_id = s.id
             where s.category_id = v_cat and s.seq > st.seq) then
    raise exception 'A later stage already has matches. Clear it first.';
  end if;
  if p_id is null then
    insert into public.matches (category_id, stage_id, round, round_label, seq, p1_reg_id, p2_reg_id, status, scheduled_at)
    values (v_cat, p_stage, v_round, coalesce(nullif(trim(p_label), ''), 'Round ' || v_round),
            (select coalesce(max(seq), -1) + 1 from public.matches where stage_id = p_stage and round = v_round),
            p_p1, p_p2, 'scheduled', p_when)
    returning id into v_id;
  else
    if m.status = 'done' and (m.p1_reg_id is distinct from p_p1 or m.p2_reg_id is distinct from p_p2) then
      raise exception 'This match already has a result. Clear the result before changing the players.';
    end if;
    if m.bye and (m.p1_reg_id is distinct from p_p1 or m.p2_reg_id is distinct from p_p2) then
      raise exception 'A bye cannot be changed. Delete it instead.';
    end if;
    update public.matches set p1_reg_id = p_p1, p2_reg_id = p_p2, scheduled_at = p_when,
           round_label = coalesce(nullif(trim(p_label), ''), round_label), round = v_round
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_match(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; st public.stages;
begin
  select * into m from public.matches where id = p_id;
  if m.id is null then raise exception 'Match not found.'; end if;
  select * into st from public.stages where id = m.stage_id;
  perform public.require_perm(public.category_sport(m.category_id), 'draws');
  if exists (select 1 from public.stages s join public.matches x on x.stage_id = s.id
             where s.category_id = m.category_id and s.seq > st.seq) then
    raise exception 'A later stage already has matches. Clear it first.';
  end if;
  delete from public.matches where id = p_id;
end $$;

-- Date and time of a match: whoever runs draws or scores may set it.
create or replace function public.set_schedule(p_match_id uuid, p_when timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; v_sport text;
begin
  select * into m from public.matches where id = p_match_id;
  if m.id is null then raise exception 'Match not found.'; end if;
  v_sport := public.category_sport(m.category_id);
  if not public.can_manage(v_sport) then raise exception 'You can only manage the tournament you are assigned to.'; end if;
  if not (public.has_perm(v_sport, 'draws') or public.has_perm(v_sport, 'scores')) then
    raise exception 'You do not have permission for this. Ask the admin.';
  end if;
  update public.matches set scheduled_at = p_when where id = p_match_id;
end $$;

-- Results are locked once what depends on them exists: the next round of a knockout, or any later stage.
create or replace function public.save_score(p_match_id uuid, p_score1 int, p_score2 int, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; st public.stages;
begin
  select * into m from public.matches where id = p_match_id;
  if m.id is null then raise exception 'Match not found.'; end if;
  perform public.require_perm(public.category_sport(m.category_id), 'scores');
  select * into st from public.stages where id = m.stage_id;
  if m.bye then raise exception 'A bye has no score.'; end if;
  if m.p1_reg_id is null or m.p2_reg_id is null then raise exception 'Both players must be set before entering a score.'; end if;
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then raise exception 'Enter games won as whole numbers.'; end if;
  if p_score1 = p_score2 then raise exception 'A match cannot end level. Enter the final games won.'; end if;
  if exists (select 1 from public.stages s join public.matches x on x.stage_id = s.id
             where s.category_id = m.category_id and s.seq > st.seq) then
    raise exception 'A later stage is already made. Clear it to change earlier results.';
  end if;
  if st.kind = 'knockout' and exists (select 1 from public.matches where stage_id = m.stage_id and round > m.round) then
    raise exception 'The next round is already made. Clear this stage to change earlier results.';
  end if;
  update public.matches set score1 = p_score1, score2 = p_score2,
         winner_reg_id = case when p_score1 > p_score2 then m.p1_reg_id else m.p2_reg_id end,
         status = 'done', note = trim(coalesce(p_note, ''))
  where id = p_match_id;
end $$;

create or replace function public.clear_score(p_match_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches; st public.stages;
begin
  select * into m from public.matches where id = p_match_id;
  if m.id is null then raise exception 'Match not found.'; end if;
  perform public.require_perm(public.category_sport(m.category_id), 'scores');
  select * into st from public.stages where id = m.stage_id;
  if m.bye then raise exception 'A bye has no score.'; end if;
  if exists (select 1 from public.stages s join public.matches x on x.stage_id = s.id
             where s.category_id = m.category_id and s.seq > st.seq) then
    raise exception 'A later stage is already made. Clear it to change earlier results.';
  end if;
  if st.kind = 'knockout' and exists (select 1 from public.matches where stage_id = m.stage_id and round > m.round) then
    raise exception 'The next round is already made. Clear this stage to change earlier results.';
  end if;
  update public.matches set score1 = null, score2 = null, winner_reg_id = null, status = 'scheduled', note = '' where id = p_match_id;
end $$;

-- Removes this stage's matches and those of every stage after it (they depend on this one).
create or replace function public.clear_stage(p_stage uuid)
returns void language plpgsql security definer set search_path = public as $$
declare st public.stages;
begin
  select * into st from public.stages where id = p_stage;
  if st.id is null then raise exception 'Stage not found.'; end if;
  perform public.require_perm(public.category_sport(st.category_id), 'draws');
  delete from public.matches
  where stage_id in (select id from public.stages where category_id = st.category_id and seq >= st.seq);
end $$;

-- ---------- who may call what ----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname <> 'auth_attempt'   -- only the sign-in function (service role) may call this, see 0004
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.list_entries() to anon;
grant execute on function public.stage_standings(uuid) to anon;
