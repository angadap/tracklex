-- Tracklex 0001: tables. Access rules are in 0002, write rules (functions) in 0003.

create table public.sports (
  slug text primary key,
  name text not null
);
insert into public.sports (slug, name) values ('table-tennis', 'Table Tennis'), ('badminton', 'Badminton');

-- Exactly one row: the current season and the date ages are counted on.
create table public.settings (
  id boolean primary key default true check (id),
  season int not null default 2026 check (season between 2000 and 2100),
  age_cutoff date not null default date '2026-10-01'
);
insert into public.settings default values;

-- One row per sign-in account. id = auth.users.id
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (length(trim(name)) > 0),
  mobile text unique check (mobile ~ '^[6-9][0-9]{9}$'),
  username text unique check (username ~ '^[a-z0-9._-]{3,20}$'),
  sport text references public.sports (slug),
  role text not null default 'player' check (role in ('player', 'admin', 'organiser')),
  created_at timestamptz not null default now(),
  check (
    (role = 'player' and mobile is not null and username is null and sport is null)
    or (role = 'admin' and username is not null and mobile is null and sport is null)
    or (role = 'organiser' and username is not null and sport is not null and mobile is null)
  )
);

-- Self and children both live here; a parent account owns many players.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  dob date not null check (dob <= current_date),
  gender text not null check (gender in ('M', 'F')),
  society text not null default '',
  relation text not null check (relation in ('self', 'child')),
  created_at timestamptz not null default now()
);
create index players_account_idx on public.players (account_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  sport text not null references public.sports (slug),
  name text not null check (length(trim(name)) > 0),
  gender text not null check (gender in ('M', 'F', 'X')),   -- X = mixed
  format text not null check (format in ('singles', 'doubles')),
  min_age int not null check (min_age >= 0),
  max_age int not null,
  fee int not null default 0 check (fee >= 0),
  created_at timestamptz not null default now(),
  check (max_age >= min_age)
);
create index categories_sport_idx on public.categories (sport);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  partner_name text not null default '',
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, category_id)
);
create index registrations_category_idx on public.registrations (category_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  round int not null,
  round_label text not null,
  seq int not null,
  p1_reg_id uuid not null references public.registrations (id) on delete restrict,
  p2_reg_id uuid references public.registrations (id) on delete restrict,   -- null = bye
  score1 int,
  score2 int,
  winner_reg_id uuid references public.registrations (id) on delete restrict,
  status text not null default 'scheduled' check (status in ('scheduled', 'done')),
  bye boolean not null default false,
  note text not null default ''
);
create index matches_category_idx on public.matches (category_id);

-- Server-only tables (no policies, no grants: only the sign-in function can use them).
create table public.app_secrets (name text primary key, value text not null);
create table public.login_attempts (
  key text primary key,
  fails int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
