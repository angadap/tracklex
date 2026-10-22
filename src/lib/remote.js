// LIVE backend: Supabase. Same functions as local.js, so screens do not know which one is running.
//   * Reading: plain selects. Row-level security decides what each person can see (supabase/migrations/0002).
//   * Tournament and player changes: database functions (supabase/migrations/0003) that check the caller's role and the rules.
//   * Sign-in, PIN reset, organisers, passwords: the `tlx-auth` edge function (supabase/functions/tlx-auth).
import { useSyncExternalStore } from "react";
import { createClient } from "@supabase/supabase-js";
import { SPORT, ok, fail } from "./core.js";

const URL = import.meta.env?.VITE_SUPABASE_URL;
const KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;

const sb =
  URL && KEY
    ? createClient(URL, KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "tracklex.auth" },
      })
    : null;

const GUEST_KEY = "tracklex.guest";
const readGuest = () => {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
};
const writeGuest = (v) => {
  try {
    v ? localStorage.setItem(GUEST_KEY, "1") : localStorage.removeItem(GUEST_KEY);
  } catch {
    /* storage blocked */
  }
};

const empty = () => ({
  settings: { season: 2026, ageCutoff: "2026-10-01" },
  accounts: [], players: [], categories: [], registrations: [], matches: [], entries: [],
  session: null, guest: false, error: "",
});

let state = empty();
const listeners = new Set();
function commit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useDb = () => useSyncExternalStore(subscribe, getState);

// ---------- errors ----------
const NET = "Could not reach the server. Check your connection and try again.";
function why(e) {
  const m = e?.message || "";
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return NET;
  return m || "Something went wrong. Try again.";
}
const isAuthExpired = (e) => e?.code === "PGRST301" || e?.code === "PGRST303" || /jwt|token/i.test(e?.message || "");

// ---------- reading ----------
// PostgREST returns at most 1000 rows per request, so read in pages.
async function fetchAll(build) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) break;
  }
  return rows;
}

const mapCategory = (r) => ({ id: r.id, sport: r.sport, name: r.name, gender: r.gender, format: r.format, minAge: r.min_age, maxAge: r.max_age, fee: r.fee });
const mapMatch = (r) => ({
  id: r.id, categoryId: r.category_id, round: r.round, roundLabel: r.round_label, seq: r.seq,
  p1RegId: r.p1_reg_id, p2RegId: r.p2_reg_id, score1: r.score1, score2: r.score2,
  winnerRegId: r.winner_reg_id, status: r.status, bye: r.bye, note: r.note,
});
const mapPlayer = (r) => ({ id: r.id, accountId: r.account_id, name: r.name, dob: r.dob, gender: r.gender, society: r.society, relation: r.relation });
const mapReg = (r) => ({ id: r.id, playerId: r.player_id, categoryId: r.category_id, partnerName: r.partner_name, paid: r.paid, paidAt: r.paid_at, createdAt: r.created_at });
const mapAccount = (r) => ({ id: r.id, name: r.name, mobile: r.mobile, username: r.username, sport: r.sport, role: r.role, perms: r.perms || [] });

// Everything the current visitor is allowed to see, as one state patch.
async function loadAll(uid) {
  const jobs = [
    sb.from("settings").select("season, age_cutoff").maybeSingle(),
    fetchAll(() => sb.from("categories").select("*").order("created_at").order("id")),
    fetchAll(() => sb.from("matches").select("*").order("round").order("seq").order("id")),
    fetchAll(() => sb.rpc("list_entries").order("id")),
  ];
  if (uid) {
    jobs.push(
      fetchAll(() => sb.from("profiles").select("*").order("created_at").order("id")),
      fetchAll(() => sb.from("players").select("*").order("created_at").order("id")),
      fetchAll(() => sb.from("registrations").select("*").order("created_at").order("id"))
    );
  }
  const [settings, categories, matches, entries, profiles = [], players = [], regs = []] = await Promise.all(jobs);
  if (settings.error) throw settings.error;
  return {
    settings: settings.data ? { season: settings.data.season, ageCutoff: settings.data.age_cutoff } : state.settings,
    categories: categories.map(mapCategory),
    matches: matches.map(mapMatch),
    entries: entries.map((e) => ({ id: e.id, categoryId: e.category_id, name: e.name })),
    accounts: profiles.map(mapAccount),
    players: players.map(mapPlayer),
    registrations: regs.map(mapReg),
  };
}

const signedOutPatch = () => ({ session: null, accounts: [], players: [], registrations: [] });

let refreshing = null;
let again = false;
export async function refresh() {
  if (!sb) return;
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const uid = state.session;
      const patch = await loadAll(uid);
      if (uid && !patch.accounts.some((a) => a.id === uid)) Object.assign(patch, signedOutPatch());
      commit({ ...patch, error: "" });
    } catch (e) {
      if (isAuthExpired(e)) {
        await sb.auth.signOut().catch(() => {});
        commit({ ...signedOutPatch(), error: "Your session has expired. Sign in again." });
      } else commit({ error: why(e) });
    } finally {
      refreshing = null;
      if (again) {
        again = false;
        refresh();
      }
    }
  })();
  return refreshing;
}

export async function init() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id || null;
  commit({ session: uid, guest: uid ? false : readGuest() });
  await refresh();
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && state.session) setTimeout(() => commit(signedOutPatch()), 0);
  });
  // Keep every phone fresh: when the app comes back to the front, and every 30 seconds while it is open.
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
}

// ---------- calling the server ----------
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) {
    if (isAuthExpired(error)) {
      await signOut();
      return fail("Your session has expired. Sign in again.");
    }
    return fail(why(error));
  }
  await refresh();
  return ok({ data });
}

async function authCall(action, body = {}) {
  const { data, error } = await sb.functions.invoke("tlx-auth", { body: { action, ...body } });
  if (error || !data) return fail(NET);
  return data; // { ok, error?, session? }
}

async function startSession(res) {
  if (!res.ok) return res;
  const { data, error } = await sb.auth.setSession({
    access_token: res.session.access_token,
    refresh_token: res.session.refresh_token,
  });
  if (error || !data.session) return fail("Could not start your session. Try again.");
  const uid = data.session.user.id;
  try {
    const patch = await loadAll(uid);
    if (!patch.accounts.some((a) => a.id === uid)) return fail("Your account could not be loaded. Try again.");
    writeGuest(false);
    commit({ ...patch, session: uid, guest: false, error: "" });
  } catch (e) {
    return fail(why(e));
  }
  return ok();
}

// ---------- auth ----------
export async function signUp({ name, mobile, pin }) {
  name = (name || "").trim();
  if (!name) return fail("Enter your name.");
  if (!/^[6-9]\d{9}$/.test(mobile)) return fail("Enter a 10-digit mobile number.");
  if (!/^\d{4,6}$/.test(pin)) return fail("Your PIN must be 4 to 6 digits.");
  return startSession(await authCall("signup", { name, mobile, pin }));
}

export async function signIn({ mobile, pin }) {
  return startSession(await authCall("signin", { mobile, pin }));
}

export async function staffSignIn({ username, password }) {
  return startSession(await authCall("staff-signin", { username: (username || "").trim().toLowerCase(), password: password || "" }));
}

export async function signOut() {
  writeGuest(false);
  commit(signedOutPatch());
  commit({ guest: false });
  await sb.auth.signOut().catch(() => {});
  await refresh();
  return ok();
}

export function continueAsGuest() {
  writeGuest(true);
  commit({ guest: true });
}

export async function changeStaffPassword({ current, next }) {
  return authCall("change-password", { current: current || "", next: next || "" });
}

export async function resetPin(accountId, pin) {
  if (!/^\d{4,6}$/.test(pin)) return fail("The PIN must be 4 to 6 digits.");
  return authCall("reset-pin", { accountId, pin });
}

export async function saveOrganiser({ id, name, username, password, sport, perms }) {
  const res = await authCall("save-organiser", { id: id || null, name, username: (username || "").trim().toLowerCase(), password: password || "", sport, perms });
  if (res.ok) await refresh();
  return res;
}

export async function grantOrganiser({ accountId, sport, perms }) {
  const res = await authCall("grant-organiser", { accountId, sport, perms });
  if (res.ok) await refresh();
  return res;
}

export async function deleteOrganiser(id) {
  const res = await authCall("delete-organiser", { id });
  if (res.ok) await refresh();
  return res;
}

export async function resetAllData() {
  const res = await authCall("reset-all-data");
  if (res.ok) await refresh();
  return res;
}

// Not used in live mode (the first admin is created once on the server); kept so both backends match.
export const ensureDemoAdmin = async () => {};

// ---------- players ----------
export const savePlayer = (p) =>
  rpc("save_player", { p_id: p.id || null, p_name: p.name, p_dob: p.dob || null, p_gender: p.gender, p_society: p.society || "", p_relation: p.relation });
export const removePlayer = (id) => rpc("remove_player", { p_id: id });
export const adminSavePlayer = (id, p) =>
  rpc("admin_save_player", { p_id: id, p_name: p.name, p_dob: p.dob || null, p_gender: p.gender, p_society: p.society || "" });
export const adminRemovePlayer = (id) => rpc("admin_remove_player", { p_id: id });

// ---------- entries ----------
export const register = ({ playerId, categoryId, partnerName = "" }) =>
  rpc("register_entry", { p_player_id: playerId, p_category_id: categoryId, p_partner: partnerName });
export const withdraw = (regId) => rpc("withdraw_entry", { p_reg_id: regId });
export const setPaid = (regId, paid) => rpc("set_paid", { p_reg_id: regId, p_paid: !!paid });

// ---------- categories ----------
export async function saveCategory(input) {
  const minAge = Number(input.minAge);
  const maxAge = Number(input.maxAge);
  const fee = Number(input.fee || 0);
  if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) || minAge < 0 || maxAge < minAge)
    return fail("Enter a valid age range (minimum cannot be above maximum).");
  if (!Number.isInteger(fee) || fee < 0) return fail("Fee must be a whole number of rupees, 0 or more.");
  return rpc("save_category", {
    p_id: input.id || null, p_sport: SPORT, p_name: input.name || "", p_gender: input.gender, p_format: input.format,
    p_min_age: minAge, p_max_age: maxAge, p_fee: fee,
  });
}
export const deleteCategory = (id) => rpc("delete_category", { p_id: id });
export const addStarterCategories = () => rpc("add_starter_categories", { p_sport: SPORT });

export async function saveSettings({ season, ageCutoff }) {
  const y = Number(season);
  if (!Number.isInteger(y)) return fail("Enter a valid season year.");
  return rpc("save_settings", { p_season: y, p_age_cutoff: ageCutoff || null });
}

// ---------- matches ----------
export const generateRound = (categoryId) => rpc("generate_round", { p_category_id: categoryId });
export const clearDraw = (categoryId) => rpc("clear_draw", { p_category_id: categoryId });
export async function saveScore(matchId, { score1, score2, note }) {
  const a = Number(score1);
  const b = Number(score2);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return fail("Enter games won as whole numbers.");
  return rpc("save_score", { p_match_id: matchId, p_score1: a, p_score2: b, p_note: note || "" });
}
