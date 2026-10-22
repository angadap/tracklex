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
