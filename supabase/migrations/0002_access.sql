-- Tracklex 0002: who can READ what. Clients cannot write to any table directly; every write goes through
-- the functions in 0003, which check the caller's role and the business rules.

-- ---------- helpers (SECURITY DEFINER so they can look at profiles without recursing through RLS) ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- Admin: every sport. Organiser: only the sport they are assigned to.
create or replace function public.can_manage(p_sport text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_sport is not null and coalesce(
    (select role = 'admin' or (role = 'organiser' and sport = p_sport) from public.profiles where id = auth.uid()),
    false)
$$;

create or replace function public.category_sport(p_cat uuid) returns text
language sql stable security definer set search_path = public as $$
  select sport from public.categories where id = p_cat
$$;

create or replace function public.owns_player(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.players where id = p_player and account_id = auth.uid())
$$;

create or replace function public.player_in_my_sport(p_player uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    join public.categories c on c.id = r.category_id
    where r.player_id = p_player and public.can_manage(c.sport))
$$;

-- Public bracket names. Shows only who is playing, never date of birth, mobile or payment status.
create or replace function public.list_entries()
returns table (id uuid, category_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.category_id,
         case when r.partner_name <> '' then p.name || ' & ' || r.partner_name else p.name end
  from public.registrations r join public.players p on p.id = r.player_id
$$;

-- ---------- row level security ----------
alter table public.sports enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.categories enable row level security;
alter table public.registrations enable row level security;
alter table public.matches enable row level security;
alter table public.app_secrets enable row level security;
alter table public.login_attempts enable row level security;

create policy sports_read on public.sports for select to anon, authenticated using (true);
create policy settings_read on public.settings for select to anon, authenticated using (true);
create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy matches_read on public.matches for select to anon, authenticated using (true);

-- Your own account; the admin sees all accounts (to reset PINs and manage organisers).
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Your own players; the admin sees all; an organiser sees players entered in their own sport.
create policy players_read on public.players for select to authenticated
  using (account_id = auth.uid() or public.is_admin() or public.player_in_my_sport(id));

-- Your own entries; the admin and the sport's organiser see that sport's entries (including paid status).
create policy registrations_read on public.registrations for select to authenticated
  using (public.owns_player(player_id) or public.can_manage(public.category_sport(category_id)));

-- ---------- table privileges: read only ----------
revoke all on all tables in schema public from anon, authenticated;
grant select on public.sports, public.settings, public.categories, public.matches to anon, authenticated;
grant select on public.profiles, public.players, public.registrations to authenticated;
