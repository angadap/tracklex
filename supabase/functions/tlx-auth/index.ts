// Tracklex sign-in and account management. Runs on Supabase Edge Functions (Deno).
//
// Why this exists: players sign in with a mobile number + PIN and staff with a username + password, but Supabase Auth only knows
// email + password. This function maps both onto Auth users whose real password is HMAC(secret, identity + what the person typed).
// The secret ("pepper") lives only in the database table app_secrets and never reaches a browser, so nobody can guess a PIN by
// calling Supabase Auth directly: every attempt has to come through here, where wrong guesses are counted and locked.
//
// Actions (POST JSON { action, ... }), always answered with HTTP 200 and { ok, error?, session? }:
//   signup, signin, staff-signin                       anyone
//   reset-pin, save-organiser, grant-organiser,
//   delete-organiser, reset-all-data                                     admin only (checked from the caller's login token)
//   change-password                                    admin or organiser, for themselves
//   bootstrap-admin                                    once, only while no admin exists and the setup code matches
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const freshAnon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, "Content-Type": "application/json" } });
const fail = (error: string) => json({ ok: false, error });
const okRes = (extra: Record<string, unknown> = {}) => json({ ok: true, ...extra });

const MOBILE = /^[6-9]\d{9}$/;
const PIN = /^\d{4,6}$/;
const USERNAME = /^[a-z0-9._-]{3,20}$/;
const WRONG_PLAYER = "Mobile number or PIN is incorrect.";
const WRONG_STAFF = "Username or password is incorrect.";
const NOT_ADMIN = "Only the admin can do this.";

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------- pepper ----------
let pepperCache: string | null = null;
async function pepper(): Promise<string> {
  if (pepperCache) return pepperCache;
  const read = async () => (await db.from("app_secrets").select("value").eq("name", "pepper").maybeSingle()).data?.value as string | undefined;
  let v = await read();
  if (!v) {
    const fresh = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    await db.from("app_secrets").upsert({ name: "pepper", value: fresh }, { onConflict: "name", ignoreDuplicates: true });
    v = await read(); // whoever wrote first wins
  }
  if (!v) throw new Error("pepper unavailable");
  return (pepperCache = v);
}

async function derive(kind: "p" | "s", id: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(await pepper()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${kind}:${id}:${secret}`)));
}
const playerEmail = (mobile: string) => `${mobile}@players.tracklex.invalid`;
const staffEmail = (username: string) => `${username}@staff.tracklex.invalid`;

// ---------- throttling ----------
// Every attempt is counted atomically in the database (auth_attempt) BEFORE the PIN or password is checked, so a burst of
// parallel guesses cannot slip past the limit. A success clears the counter.
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const lockText = (secs: number) => {
  const mins = Math.max(1, Math.ceil(secs / 60));
  return `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
};
// Returns a message when this key is locked, otherwise null (the attempt may go ahead).
async function attempt(key: string, max = MAX_FAILS, lockMinutes = LOCK_MINUTES): Promise<string | null> {
  const { data, error } = await db.rpc("auth_attempt", { p_key: key, p_max: max, p_lock_minutes: lockMinutes });
  if (error) throw error;
  return (data as number) > 0 ? lockText(data as number) : null;
}
const clearFails = (key: string) => db.from("login_attempts").delete().eq("key", key);
const ipOf = (req: Request) =>
  (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

// ---------- helpers ----------
type Profile = { id: string; name: string; mobile: string | null; username: string | null; sport: string | null; role: string; perms: string[] };

// What an organiser can be allowed to do. Must match the check on profiles.perms.
const PERMS = ["categories", "entries", "draws", "scores"];
function cleanPerms(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = PERMS.filter((p) => v.includes(p));
  return out.length ? out : null;
}

async function sessionFor(email: string, password: string) {
  const { data, error } = await freshAnon().auth.signInWithPassword({ email, password });
  if (error || !data.session) return null;
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

async function caller(req: Request): Promise<Profile | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: p } = await db.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  return (p as Profile) ?? null;
}

async function createStaff(role: "admin" | "organiser", name: string, username: string, password: string, sport: string | null, perms: string[] = []) {
  const { data, error } = await db.auth.admin.createUser({
    email: staffEmail(username), password: await derive("s", username, password), email_confirm: true,
  });
  if (error || !data.user) {
    console.error("createUser failed", error?.message);
    return "Could not create the account. Try again.";
  }
  const { error: pe } = await db.from("profiles").insert({ id: data.user.id, name, username, sport, role, perms });
  if (pe) {
    await db.auth.admin.deleteUser(data.user.id);
    console.error("profile insert failed", pe.message);
    return pe.code === "23505" ? "This username is already taken." : "Could not create the account. Try again.";
  }
  return null;
}

// ---------- actions ----------
async function signup(b: any, req: Request) {
  const name = String(b.name ?? "").trim();
  const mobile = String(b.mobile ?? "");
  const pin = String(b.pin ?? "");
  if (!name) return fail("Enter your name.");
  if (!MOBILE.test(mobile)) return fail("Enter a 10-digit mobile number.");
  if (!PIN.test(pin)) return fail("Your PIN must be 4 to 6 digits.");
  if (await attempt(`ip:signup:${ipOf(req)}`, 10, 60)) return fail("Too many sign-ups from this connection. Try again in an hour.");
  const dup = "This mobile number is already registered. Sign in instead.";
  if ((await db.from("profiles").select("id").eq("mobile", mobile).maybeSingle()).data) return fail(dup);
  const email = playerEmail(mobile);
  const password = await derive("p", mobile, pin);
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    console.error("createUser failed", error?.message);
    return fail(/already|registered|exists/i.test(error?.message ?? "") ? dup : "Could not create your account. Try again.");
  }
  const { error: pe } = await db.from("profiles").insert({ id: data.user.id, name, mobile, role: "player" });
  if (pe) {
    await db.auth.admin.deleteUser(data.user.id);
    console.error("profile insert failed", pe.message);
    return fail(pe.code === "23505" ? dup : "Could not create your account. Try again.");
  }
  const session = await sessionFor(email, password);
  return session ? okRes({ session }) : fail("Your account was created. Sign in to continue.");
}

async function signin(b: any, req: Request) {
  const mobile = String(b.mobile ?? "");
  const pin = String(b.pin ?? "");
  if (await attempt(`ip:signin:${ipOf(req)}`, 60, 15)) return fail("Too many attempts from this connection. Try again in a few minutes.");
  if (!MOBILE.test(mobile) || !PIN.test(pin)) return fail(WRONG_PLAYER);
  const key = `p:${mobile}`;
  const locked = await attempt(key);
  if (locked) return fail(locked);
  const session = await sessionFor(playerEmail(mobile), await derive("p", mobile, pin));
  if (!session) return fail(WRONG_PLAYER);
  await clearFails(key);
  return okRes({ session });
}

async function staffSignin(b: any, req: Request) {
  const username = String(b.username ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (await attempt(`ip:signin:${ipOf(req)}`, 60, 15)) return fail("Too many attempts from this connection. Try again in a few minutes.");
  if (!USERNAME.test(username) || !password) return fail(WRONG_STAFF);
  const key = `s:${username}`;
  const locked = await attempt(key);
  if (locked) return fail(locked);
  const session = await sessionFor(staffEmail(username), await derive("s", username, password));
  if (!session) return fail(WRONG_STAFF);
  await clearFails(key);
  return okRes({ session });
}

async function resetPin(b: any, me: Profile | null) {
  if (me?.role !== "admin") return fail(NOT_ADMIN);
  const pin = String(b.pin ?? "");
  if (!PIN.test(pin)) return fail("The PIN must be 4 to 6 digits.");
  const { data: target } = await db.from("profiles").select("*").eq("id", String(b.accountId ?? "")).eq("role", "player").maybeSingle();
  if (!target) return fail("Account not found.");
  const { error } = await db.auth.admin.updateUserById(target.id, { password: await derive("p", target.mobile, pin) });
  if (error) return fail("Could not reset the PIN. Try again.");
  await clearFails(`p:${target.mobile}`);
  return okRes();
}

async function saveOrganiser(b: any, me: Profile | null) {
  if (me?.role !== "admin") return fail(NOT_ADMIN);
  const id = b.id ? String(b.id) : null;
  const name = String(b.name ?? "").trim();
  const username = String(b.username ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const sport = String(b.sport ?? "");
  if (!name) return fail("Enter the organiser's name.");
  if (!USERNAME.test(username)) return fail("The username must be 3 to 20 letters, numbers, dots, dashes or underscores.");
  if (!(await db.from("sports").select("slug").eq("slug", sport).maybeSingle()).data) return fail("Choose a sport that is already set up.");
  const perms = cleanPerms(b.perms);
  if (!perms) return fail("Choose at least one thing this organiser can do.");
  if (!id && !password) return fail("Set a password for the new organiser.");
  if (password && password.length < 8) return fail("The password must be at least 8 characters.");
  if (!id) {
    if ((await db.from("profiles").select("id").eq("username", username).maybeSingle()).data) return fail("This username is already taken.");
    const err = await createStaff("organiser", name, username, password, sport, perms);
    return err ? fail(err) : okRes();
  }
  const { data: target } = await db.from("profiles").select("*").eq("id", id).eq("role", "organiser").maybeSingle();
  if (!target) return fail("Organiser not found.");
  const { error } = await db.from("profiles").update({ name, sport, perms }).eq("id", id);
  if (error) return fail("Could not save the organiser. Try again.");
  if (password) {
    const { error: pe } = await db.auth.admin.updateUserById(id, { password: await derive("s", target.username, password) });
    if (pe) return fail("Saved the details, but could not change the password. Try again.");
    await clearFails(`s:${target.username}`);
  }
  return okRes();
}

async function deleteOrganiser(b: any, me: Profile | null) {
  if (me?.role !== "admin") return fail(NOT_ADMIN);
  const id = String(b.id ?? "");
  const { data: target } = await db.from("profiles").select("id, role").eq("id", id).in("role", ["organiser", "player"]).maybeSingle();
  if (!target) return fail("Organiser not found.");
  if (target.role === "player") {
    // A player who was made an organiser keeps their account and players; only the organiser access is removed.
    const { error } = await db.from("profiles").update({ sport: null, perms: [] }).eq("id", id);
    return error ? fail("Could not remove organiser access. Try again.") : okRes();
  }
  const { error } = await db.auth.admin.deleteUser(id);
  return error ? fail("Could not remove the organiser. Try again.") : okRes();
}

// Admin makes an existing PLAYER account an organiser of one sport (or changes what they may do). They keep signing in with
// mobile + PIN and keep their players and entries; they also get the tournament console for that sport.
async function grantOrganiser(b: any, me: Profile | null) {
  if (me?.role !== "admin") return fail(NOT_ADMIN);
  const sport = String(b.sport ?? "");
  const perms = cleanPerms(b.perms);
  if (!(await db.from("sports").select("slug").eq("slug", sport).maybeSingle()).data) return fail("Choose a sport that is already set up.");
  if (!perms) return fail("Choose at least one thing this organiser can do.");
  const { data: target } = await db.from("profiles").select("id").eq("id", String(b.accountId ?? "")).eq("role", "player").maybeSingle();
  if (!target) return fail("Player account not found.");
  const { error } = await db.from("profiles").update({ sport, perms }).eq("id", target.id);
  return error ? fail("Could not save. Try again.") : okRes();
}

async function changePassword(b: any, me: Profile | null) {
  if (!me || (me.role !== "admin" && me.role !== "organiser") || !me.username) return fail("Sign in as admin or organiser first.");
  const current = String(b.current ?? "");
  const next = String(b.next ?? "");
  const key = `s:${me.username}`;
  const locked = await attempt(key);
  if (locked) return fail(locked);
  if (!(await sessionFor(staffEmail(me.username), await derive("s", me.username, current)))) {
    return fail("Your current password is incorrect.");
  }
  if (next.length < 8) return fail("The new password must be at least 8 characters.");
  const { error } = await db.auth.admin.updateUserById(me.id, { password: await derive("s", me.username, next) });
  if (error) return fail("Could not change the password. Try again.");
  await clearFails(key);
  return okRes();
}

// Wipes players, entries, tournaments, categories, stages and matches. Admin and organiser accounts and the season settings stay.
async function resetAllData(me: Profile | null) {
  if (me?.role !== "admin") return fail(NOT_ADMIN);
  for (const table of ["matches", "registrations", "players", "categories", "tournaments"]) {   // stages go with their categories
    const { error } = await db.from(table).delete().not("id", "is", null);
    if (error) {
      console.error("wipe failed", table, error.message);
      return fail("Could not delete everything. Try again.");
    }
  }
  const { data: players } = await db.from("profiles").select("id").eq("role", "player");
  for (const p of players ?? []) await db.auth.admin.deleteUser(p.id);
  return okRes();
}

// One-time creation of the first admin. Needs the setup code stored by the project owner in app_secrets, and is
// refused for ever once any admin exists. The code is deleted after use.
async function bootstrapAdmin(b: any) {
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if ((count ?? 0) > 0) return fail("Setup is already complete.");
  const { data: code } = await db.from("app_secrets").select("value").eq("name", "bootstrap_code").maybeSingle();
  if (!code?.value || code.value !== String(b.code ?? "")) return fail("Setup code is not valid.");
  const name = String(b.name ?? "").trim() || "Admin";
  const username = String(b.username ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!USERNAME.test(username)) return fail("The username must be 3 to 20 letters, numbers, dots, dashes or underscores.");
  if (password.length < 8) return fail("The password must be at least 8 characters.");
  const err = await createStaff("admin", name, username, password, null);
  if (err) return fail(err);
  await db.from("app_secrets").delete().eq("name", "bootstrap_code");
  return okRes();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Bad request.");
  let b: any;
  try {
    b = await req.json();
  } catch {
    return fail("Bad request.");
  }
  try {
    switch (b?.action) {
      case "signup": return await signup(b, req);
      case "signin": return await signin(b, req);
      case "staff-signin": return await staffSignin(b, req);
      case "reset-pin": return await resetPin(b, await caller(req));
      case "save-organiser": return await saveOrganiser(b, await caller(req));
      case "delete-organiser": return await deleteOrganiser(b, await caller(req));
      case "grant-organiser": return await grantOrganiser(b, await caller(req));
      case "change-password": return await changePassword(b, await caller(req));
      case "reset-all-data": return await resetAllData(await caller(req));
      case "bootstrap-admin": return await bootstrapAdmin(b);
      default: return fail("Bad request.");
    }
  } catch (e) {
    console.error("tlx-auth error", e);
    return fail("Something went wrong on the server. Try again.");
  }
});
