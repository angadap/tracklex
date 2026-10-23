-- Tracklex 0008: optional T-shirt size and photo on a player, and ages are counted on today's date (India time).
-- Safe to run more than once.

alter table public.players add column if not exists tshirt text not null default '';
alter table public.players add column if not exists photo text not null default '';

-- Entering an event: eligibility uses the player's age today, not a fixed date.
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
  v_age := extract(year from age(((now() at time zone 'Asia/Kolkata')::date)::timestamp, pl.dob::timestamp))::int;
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

-- T-shirt size and photo (a small picture the app shrinks first). Both optional: send '' to clear.
-- The player's own account or the admin may set them.
create or replace function public.set_player_extras(p_id uuid, p_tshirt text, p_photo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_t text := coalesce(trim(p_tshirt), ''); v_p text := coalesce(p_photo, '');
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if not (public.owns_player(p_id) or public.is_admin()) then raise exception 'Player not found.'; end if;
  if v_t not in ('', 'Kids S', 'Kids M', 'Kids L', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL') then
    raise exception 'Choose a T-shirt size from the list.';
  end if;
  if v_p <> '' and (v_p not like 'data:image/%' or length(v_p) > 200000) then
    raise exception 'That photo is not usable. Choose a different one.';
  end if;
  update public.players set tshirt = v_t, photo = v_p where id = p_id;
end $$;

revoke all on function public.set_player_extras(uuid, text, text) from public, anon;
grant execute on function public.set_player_extras(uuid, text, text) to authenticated;
