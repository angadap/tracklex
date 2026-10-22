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
