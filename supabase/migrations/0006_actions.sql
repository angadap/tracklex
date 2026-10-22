-- Tracklex 0006 (needs 0005 first): every write goes through one of these functions. Each checks who is calling and the tournament rules,
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
declare pl public.players; c public.categories; s public.settings; v_age int; v_id uuid;
begin
  if public.my_role() is distinct from 'player' then raise exception 'Sign in with a player account first.'; end if;
  select * into pl from public.players where id = p_player_id;
  select * into c from public.categories where id = p_category_id;
  if pl.id is null or c.id is null then raise exception 'Player or category not found.'; end if;
  if pl.account_id <> auth.uid() then raise exception 'You can only enter your own players.'; end if;
  select * into s from public.settings;
  v_age := extract(year from age(s.age_cutoff::timestamp, pl.dob::timestamp))::int;
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

-- ---------- categories ----------
create or replace function public.save_category(p_id uuid, p_sport text, p_name text, p_gender text, p_format text,
                                                p_min_age int, p_max_age int, p_fee int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fee int := coalesce(p_fee, 0);
begin
  perform public.require_perm(p_sport, 'categories');
  if p_id is not null and public.category_sport(p_id) is distinct from p_sport then
    raise exception 'You can only manage the tournament you are assigned to.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a category name.'; end if;
  if p_gender is null or p_gender not in ('M', 'F', 'X') then raise exception 'Choose men, women or mixed.'; end if;
  if p_format is null or p_format not in ('singles', 'doubles') then raise exception 'Choose singles or doubles.'; end if;
  if p_min_age is null or p_max_age is null or p_min_age < 0 or p_max_age < p_min_age then
    raise exception 'Enter a valid age range (minimum cannot be above maximum).';
  end if;
  if v_fee < 0 then raise exception 'Fee cannot be negative.'; end if;
  if p_id is null then
    insert into public.categories (sport, name, gender, format, min_age, max_age, fee)
    values (p_sport, trim(p_name), p_gender, p_format, p_min_age, p_max_age, v_fee) returning id into v_id;
  else
    update public.categories set name = trim(p_name), gender = p_gender, format = p_format,
           min_age = p_min_age, max_age = p_max_age, fee = v_fee
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Category not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.delete_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(public.category_sport(p_id), 'categories');
  if exists (select 1 from public.registrations where category_id = p_id) then
    raise exception 'This category has entries. Withdraw them first.';
  end if;
  delete from public.categories where id = p_id;
end $$;

create or replace function public.add_starter_categories(p_sport text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(p_sport, 'categories');
  insert into public.categories (sport, name, gender, format, min_age, max_age, fee)
  select p_sport, b.name, g.gender, 'singles', b.min_age, b.max_age, 0
  from (values ('Under 10', 0, 9), ('10–17', 10, 17), ('18–45', 18, 45), ('46–60', 46, 60), ('Above 60', 61, 120))
       as b(name, min_age, max_age)
  cross join (values ('M'), ('F')) as g(gender);
end $$;

-- ---------- season settings (admin) ----------
create or replace function public.save_settings(p_season int, p_age_cutoff date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do this.'; end if;
  if p_season is null or p_season < 2000 or p_season > 2100 then raise exception 'Enter a valid season year.'; end if;
  if p_age_cutoff is null then raise exception 'Choose the date ages are counted on.'; end if;
  update public.settings set season = p_season, age_cutoff = p_age_cutoff;
end $$;

-- ---------- matches ----------
create or replace function public.generate_round(p_category_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_round int := 1; v_n int; v_label text; k int; v_a uuid; v_b uuid;
begin
  perform public.require_perm(public.category_sport(p_category_id), 'draws');
  perform 1 from public.categories where id = p_category_id for update;   -- one draw at a time per category
  if not exists (select 1 from public.matches where category_id = p_category_id) then
    select array_agg(id order by random()) into v_ids from public.registrations where category_id = p_category_id;
    if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'At least 2 entries are needed to make a draw.'; end if;
  else
    select max(round) into v_round from public.matches where category_id = p_category_id;
    if exists (select 1 from public.matches where category_id = p_category_id and round = v_round and status <> 'done') then
      raise exception 'Finish every match in this round first.';
    end if;
    select array_agg(winner_reg_id order by seq) into v_ids from public.matches where category_id = p_category_id and round = v_round;
    if array_length(v_ids, 1) < 2 then raise exception 'This category already has a champion.'; end if;
    v_round := v_round + 1;
  end if;
  v_n := array_length(v_ids, 1);
  v_label := case when v_n <= 2 then 'Final' when v_n <= 4 then 'Semi-finals' when v_n <= 8 then 'Quarter-finals'
                  else 'Round ' || v_round end;
  for k in 0 .. ((v_n + 1) / 2) - 1 loop
    v_a := v_ids[2 * k + 1];
    v_b := v_ids[2 * k + 2];   -- null when the count is odd: a bye
    insert into public.matches (category_id, round, round_label, seq, p1_reg_id, p2_reg_id, winner_reg_id, status, bye)
    values (p_category_id, v_round, v_label, k, v_a, v_b,
            case when v_b is null then v_a end,
            case when v_b is null then 'done' else 'scheduled' end,
            v_b is null);
  end loop;
end $$;

create or replace function public.save_score(p_match_id uuid, p_score1 int, p_score2 int, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  select * into m from public.matches where id = p_match_id;
  if m.id is null then raise exception 'Match not found.'; end if;
  perform public.require_perm(public.category_sport(m.category_id), 'scores');
  if m.bye then raise exception 'A bye has no score.'; end if;
  if p_score1 is null or p_score2 is null or p_score1 < 0 or p_score2 < 0 then raise exception 'Enter games won as whole numbers.'; end if;
  if p_score1 = p_score2 then raise exception 'A match cannot end level. Enter the final games won.'; end if;
  if exists (select 1 from public.matches where category_id = m.category_id and round > m.round) then
    raise exception 'The next round is already made. Clear the draw to change earlier results.';
  end if;
  update public.matches set score1 = p_score1, score2 = p_score2,
         winner_reg_id = case when p_score1 > p_score2 then m.p1_reg_id else m.p2_reg_id end,
         status = 'done', note = trim(coalesce(p_note, ''))
  where id = p_match_id;
end $$;

create or replace function public.clear_draw(p_category_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm(public.category_sport(p_category_id), 'draws');
  delete from public.matches where category_id = p_category_id;
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
