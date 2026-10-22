-- Tracklex 0004: atomic counting of sign-in attempts, used only by the tlx-auth edge function.
-- Every attempt is counted BEFORE the PIN or password is checked, so a burst of parallel guesses cannot slip past the limit:
-- at most p_max checks are made per window, then the key is locked for p_lock_minutes.
-- Returns 0 when the attempt may go ahead, otherwise the number of seconds the key stays locked.
create or replace function public.auth_attempt(p_key text, p_max int, p_lock_minutes int)
returns int language plpgsql security definer set search_path = public as $$
declare r public.login_attempts;
begin
  insert into public.login_attempts as l (key, fails, locked_until, updated_at)
  values (p_key, 1, null, now())
  on conflict (key) do update set
    fails = case when l.locked_until is not null and l.locked_until <= now() then 1 else l.fails + 1 end,
    locked_until = case when l.locked_until is not null and l.locked_until <= now() then null else l.locked_until end,
    updated_at = now()
  returning * into r;
  if r.locked_until is not null and r.locked_until > now() then
    return ceil(extract(epoch from (r.locked_until - now())))::int;
  end if;
  if r.fails > p_max then
    update public.login_attempts set locked_until = now() + make_interval(mins => p_lock_minutes)
    where key = p_key returning * into r;
    return ceil(extract(epoch from (r.locked_until - now())))::int;
  end if;
  return 0;
end $$;

-- Only the edge function (service role) may call it. Players must never be able to lock other people out.
revoke all on function public.auth_attempt(text, int, int) from public, anon, authenticated;
grant execute on function public.auth_attempt(text, int, int) to service_role;
