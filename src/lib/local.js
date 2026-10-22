// Offline DEMO backend. State lives in localStorage, so the whole app works with no server.
// Used when the Supabase keys are not set (see db.js), and by the automated screen tests.
// It mirrors the rules and permissions of the live database (supabase/migrations) and exposes the same functions
// as remote.js. Data here stays in the one browser it was entered in.
import { useSyncExternalStore } from "react";
import { SPORTS } from "../data/sports.js";
import {
  ok, fail, isEligible, me, isAdmin, isStaffAccount, canManage, can, PERMS, deriveEntries,
  stagesOf, standings, stageIsDone, tournamentById, cutoffFor,
} from "./core.js";

const KEY = "warje.db.v1";

const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const initial = () => ({
  accounts: [], // player: { id, name, mobile, pinHash, role: "player" }
  // admin: { id, name, username, passwordHash, role: "admin" }  (does everything)
  // organiser: { id, name, username, passwordHash, role: "organiser", sport }  (runs one sport's tournament only)
  players: [], // { id, accountId, name, dob, gender: "M" | "F", society, relation: "self" | "child" }
  tournaments: [], // { id, sport, name, season, ageCutoff, startsOn, endsOn, regOpen, createdAt }
  categories: [], // { id, tournamentId, sport, name, gender: "M" | "F" | "X", format: "singles" | "doubles", minAge, maxAge, fee }
  registrations: [], // { id, playerId, categoryId, partnerName, paid, paidAt, createdAt }
  stages: [], // { id, categoryId, seq, name, kind: "knockout" | "round_robin" | "custom", groups, legs, advance }
  matches: [], // { id, categoryId, stageId, groupNo, scheduledAt, round, roundLabel, seq, p1RegId, p2RegId, score1, score2, winnerRegId, status, bye, note }
  entries: [], // derived: public names per entry
  session: null, // accountId
  guest: false, // browsing without an account
  error: "",
});

// Older saved demo data: organiser accounts made before permission levels get every permission.
const ALL = ["categories", "entries", "draws", "scores"];
const upgrade = (s) => {
  let next = {
    ...s,
    tournaments: s.tournaments || [],
    stages: s.stages || [],
    accounts: s.accounts.map((a) => (a.perms ? a : { ...a, perms: a.role === "organiser" ? ALL : [] })),
  };
  // Data saved before tournaments existed: one tournament per sport, one knockout stage per category.
  if (next.categories.some((c) => !c.tournamentId)) {
    const made = new Map();
    const cats = next.categories.map((c) => {
      if (c.tournamentId) return c;
      if (!made.has(c.sport)) {
        made.set(c.sport, { id: uid(), sport: c.sport, name: `Warje Olympics ${s.settings?.season || 2026}`, season: s.settings?.season || 2026,
          ageCutoff: s.settings?.ageCutoff || "2026-10-01", startsOn: null, endsOn: null, regOpen: true, createdAt: new Date().toISOString() });
      }
      return { ...c, tournamentId: made.get(c.sport).id };
    });
    const stages = [...next.stages];
    const stageOf = {};
    for (const c of cats) {
      let st = stages.find((x) => x.categoryId === c.id);
      if (!st) { st = { id: uid(), categoryId: c.id, seq: 1, name: "Knockout", kind: "knockout", groups: 1, legs: 1, advance: 0 }; stages.push(st); }
      stageOf[c.id] = st.id;
    }
    next = { ...next, categories: cats, tournaments: [...next.tournaments, ...made.values()], stages,
      matches: next.matches.map((m) => (m.stageId ? m : { ...m, stageId: stageOf[m.categoryId], groupNo: null, scheduledAt: null })) };
  }
  return next;
};
const finalize = (s) => ({ ...upgrade(s), entries: deriveEntries(s) });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return finalize({ ...initial(), ...JSON.parse(raw), error: "" });
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return finalize(initial());
}

let state = load();
const listeners = new Set();

function commit(next) {
  state = finalize(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: keep working in memory */
  }
  listeners.forEach((l) => l());
}

export const getState = () => state;
const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useDb = () => useSyncExternalStore(subscribe, getState);
export const init = async () => ensureDemoAdmin();

// ---------- helpers ----------
async function hashPin(mobile, pin) {
  const text = `warje:${mobile}:${pin}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return "weak" + h;
}

const hashPassword = (username, password) => hashPin(`admin:${username}`, password);

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

const adminOnly = () => fail("Only the admin can do this.");
const notYours = () => fail("You can only manage the tournament you are assigned to.");
const noPerm = () => fail("You do not have permission for this. Ask the admin.");
// null when the caller may do `perm` in `sport`, otherwise the failure to return.
const need = (sport, perm) => (!canManage(state, sport) ? notYours() : can(state, sport, perm) ? null : noPerm());
const cleanPerms = (v) => {
  const out = PERMS.map((p) => p.key).filter((k) => Array.isArray(v) && v.includes(k));
  return out.length ? out : null;
};
const categorySport = (id) => state.categories.find((c) => c.id === id)?.sport;
const entrySport = (regId) => {
  const r = state.registrations.find((x) => x.id === regId);
  return r && categorySport(r.categoryId);
};

// ---------- auth ----------
export async function signUp({ name, mobile, pin }) {
  name = name.trim();
  if (!name) return fail("Enter your name.");
  if (!/^[6-9]\d{9}$/.test(mobile)) return fail("Enter a 10-digit mobile number.");
  if (!/^\d{4,6}$/.test(pin)) return fail("Your PIN must be 4 to 6 digits.");
  if (state.accounts.some((a) => a.mobile === mobile)) return fail("This mobile number is already registered. Sign in instead.");
  const account = { id: uid(), name, mobile, pinHash: await hashPin(mobile, pin), role: "player" };
  commit({ ...state, accounts: [...state.accounts, account], session: account.id, guest: false });
  return ok();
}

export async function signIn({ mobile, pin }) {
  const acc = state.accounts.find((a) => a.role === "player" && a.mobile === mobile);
  if (!acc || acc.pinHash !== (await hashPin(mobile, pin))) return fail("Mobile number or PIN is incorrect.");
  commit({ ...state, session: acc.id, guest: false });
  return ok();
}

export async function staffSignIn({ username, password }) {
  const u = (username || "").trim().toLowerCase();
  const acc = state.accounts.find((a) => (a.role === "admin" || a.role === "organiser") && a.username === u);
  if (!acc || acc.passwordHash !== (await hashPassword(u, password || ""))) return fail("Username or password is incorrect.");
  commit({ ...state, session: acc.id, guest: false });
  return ok();
}

export const signOut = async () => commit({ ...state, session: null, guest: false });
export const continueAsGuest = () => commit({ ...state, session: null, guest: true });

export async function changeStaffPassword({ current, next }) {
  const acc = me(state);
  if (!acc || !isStaffAccount(state)) return fail("Sign in as admin or organiser first.");
  if (acc.passwordHash !== (await hashPassword(acc.username, current || ""))) return fail("Your current password is incorrect.");
  if ((next || "").length < 8) return fail("The new password must be at least 8 characters.");
  const passwordHash = await hashPassword(acc.username, next);
  commit({ ...state, accounts: state.accounts.map((a) => (a.id === acc.id ? { ...a, passwordHash } : a)) });
  return ok();
}

// Demo only: seeds one admin (admin / admin123) so the staff login can be tried without a server.
export async function ensureDemoAdmin() {
  if (state.accounts.some((a) => a.role === "admin" && a.username)) return;
  const kept = state.accounts.filter((a) => a.role !== "admin");
  const admin = { id: uid(), name: "Admin", username: "admin", passwordHash: await hashPassword("admin", "admin123"), role: "admin" };
  commit({ ...state, accounts: [...kept, admin], session: kept.some((a) => a.id === state.session) ? state.session : null });
}

export async function resetPin(accountId, pin) {
  if (!isAdmin(state)) return adminOnly();
  if (!/^\d{4,6}$/.test(pin)) return fail("The PIN must be 4 to 6 digits.");
  const acc = state.accounts.find((a) => a.id === accountId && a.role === "player");
  if (!acc) return fail("Account not found.");
  const pinHash = await hashPin(acc.mobile, pin);
  commit({ ...state, accounts: state.accounts.map((a) => (a.id === accountId ? { ...a, pinHash } : a)) });
  return ok();
}

// ---------- players ----------
function cleanPlayer(input) {
  const name = (input.name || "").trim();
  if (!name) return { error: "Enter the player's name." };
  if (!input.dob || new Date(input.dob) > new Date()) return { error: "Enter a valid date of birth." };
  if (!["M", "F"].includes(input.gender)) return { error: "Choose male or female." };
  return { data: { name, dob: input.dob, gender: input.gender, society: (input.society || "").trim() } };
}

// Admin only: organisers can see players but never change their profiles.
export async function adminSavePlayer(id, input) {
  if (!isAdmin(state)) return adminOnly();
  const { error, data } = cleanPlayer(input);
  if (error) return fail(error);
  if (!state.players.some((p) => p.id === id)) return fail("Player not found.");
  commit({ ...state, players: state.players.map((p) => (p.id === id ? { ...p, ...data } : p)) });
  return ok();
}

export async function adminRemovePlayer(id) {
  if (!isAdmin(state)) return adminOnly();
  if (state.registrations.some((r) => r.playerId === id)) return fail("Withdraw this player's entries first.");
  commit({ ...state, players: state.players.filter((p) => p.id !== id) });
  return ok();
}

export async function savePlayer(input) {
  if (me(state)?.role !== "player") return fail("Sign in with a player account first.");
  const { error, data: base } = cleanPlayer(input);
  if (error) return fail(error);
  const data = { ...base, relation: input.relation };
  if (input.id) {
    commit({ ...state, players: state.players.map((p) => (p.id === input.id && p.accountId === state.session ? { ...p, ...data } : p)) });
  } else {
    commit({ ...state, players: [...state.players, { id: uid(), accountId: state.session, ...data }] });
  }
  return ok();
}

export async function removePlayer(id) {
  if (state.registrations.some((r) => r.playerId === id)) return fail("Withdraw this player's entries first.");
  commit({ ...state, players: state.players.filter((p) => !(p.id === id && p.accountId === state.session)) });
  return ok();
}

// ---------- registrations ----------
export async function register({ playerId, categoryId, partnerName = "" }) {
  const player = state.players.find((p) => p.id === playerId);
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!player || !cat) return fail("Player or category not found.");
  if (player.accountId !== state.session) return fail("You can only enter your own players.");
  const t = tournamentById(state, cat.tournamentId);
  if (!t?.regOpen) return fail("Entries for this tournament are closed.");
  if (!isEligible(player, cat, t.ageCutoff)) return fail(`${player.name} is not eligible for ${cat.name}.`);
  if (state.registrations.some((r) => r.playerId === playerId && r.categoryId === categoryId)) return fail("Already entered in this category.");
  if (state.matches.some((m) => m.categoryId === categoryId)) return fail("The draw for this category has started. Entries are closed.");
  if (cat.format === "doubles" && !partnerName.trim()) return fail("Enter your doubles partner's name.");
  const reg = { id: uid(), playerId, categoryId, partnerName: cat.format === "doubles" ? partnerName.trim() : "", paid: false, paidAt: null, createdAt: new Date().toISOString() };
  commit({ ...state, registrations: [...state.registrations, reg] });
  return ok();
}

export async function withdraw(regId) {
  const reg = state.registrations.find((r) => r.id === regId);
  if (!reg) return fail("Entry not found.");
  if (state.matches.some((m) => m.p1RegId === regId || m.p2RegId === regId)) return fail("The draw has started. Clear this category's draw first.");
  const player = state.players.find((p) => p.id === reg.playerId);
  if (player?.accountId !== state.session && !can(state, entrySport(regId), "entries")) return fail("Not allowed.");
  commit({ ...state, registrations: state.registrations.filter((r) => r.id !== regId) });
  return ok();
}

export async function setPaid(regId, paid) {
  const e = need(entrySport(regId), "entries");
  if (e) return e;
  commit({ ...state, registrations: state.registrations.map((r) => (r.id === regId ? { ...r, paid, paidAt: paid ? new Date().toISOString() : null } : r)) });
  return ok();
}

// ---------- tournaments ----------
const tournamentSport = (id) => state.tournaments.find((t) => t.id === id)?.sport;

export async function saveTournament({ id, sport, name, season, ageCutoff, startsOn, endsOn, regOpen }) {
  const e = need(sport, "categories");
  if (e) return e;
  if (id && tournamentSport(id) !== sport) return notYours();
  if (!SPORTS.some((x) => x.slug === sport)) return fail("Choose a sport.");
  name = (name || "").trim();
  const y = Number(season);
  if (!name) return fail("Enter a tournament name.");
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return fail("Enter a valid season year.");
  if (!ageCutoff) return fail("Choose the date ages are counted on.");
  if (startsOn && endsOn && endsOn < startsOn) return fail("The end date cannot be before the start date.");
  const data = { sport, name, season: y, ageCutoff, startsOn: startsOn || null, endsOn: endsOn || null, regOpen: regOpen !== false };
  if (id) {
    if (!state.tournaments.some((t) => t.id === id)) return fail("Tournament not found.");
    commit({ ...state, tournaments: state.tournaments.map((t) => (t.id === id ? { ...t, ...data } : t)) });
    return ok({ id });
  }
  const t = { id: uid(), createdAt: new Date().toISOString(), ...data };
  commit({ ...state, tournaments: [...state.tournaments, t] });
  return ok({ id: t.id });
}

export async function deleteTournament(id) {
  if (!tournamentSport(id)) return fail("Tournament not found.");
  const e = need(tournamentSport(id), "categories");
  if (e) return e;
  const cats = state.categories.filter((c) => c.tournamentId === id).map((c) => c.id);
  if (state.registrations.some((r) => cats.includes(r.categoryId))) return fail("This tournament has entries. Withdraw them first.");
  commit({
    ...state,
    tournaments: state.tournaments.filter((t) => t.id !== id),
    categories: state.categories.filter((c) => c.tournamentId !== id),
    stages: state.stages.filter((s) => !cats.includes(s.categoryId)),
    matches: state.matches.filter((m) => !cats.includes(m.categoryId)),
  });
  return ok();
}

// ---------- categories (age / gender groups inside a tournament) ----------
const defaultStage = (categoryId) => ({ id: uid(), categoryId, seq: 1, name: "Knockout", kind: "knockout", groups: 1, legs: 1, advance: 0 });

export async function saveCategory(input) {
  const sport = tournamentSport(input.tournamentId);
  if (!sport) return fail("Tournament not found.");
  const e = need(sport, "categories");
  if (e) return e;
  if (input.id && !state.categories.some((c) => c.id === input.id && c.tournamentId === input.tournamentId)) return fail("Category not found.");
  const name = (input.name || "").trim();
  const minAge = Number(input.minAge);
  const maxAge = Number(input.maxAge);
  const fee = Number(input.fee || 0);
  if (!name) return fail("Enter a category name.");
  if (!["M", "F", "X"].includes(input.gender)) return fail("Choose men, women or mixed.");
  if (!["singles", "doubles"].includes(input.format)) return fail("Choose singles or doubles.");
  if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) || minAge < 0 || maxAge < minAge) return fail("Enter a valid age range (minimum cannot be above maximum).");
  if (!Number.isInteger(fee) || fee < 0) return fail("Fee must be a whole number of rupees, 0 or more.");
  const data = { tournamentId: input.tournamentId, sport, name, gender: input.gender, format: input.format, minAge, maxAge, fee };
  if (input.id) {
    commit({ ...state, categories: state.categories.map((c) => (c.id === input.id ? { ...c, ...data } : c)) });
    return ok({ id: input.id });
  }
  const cat = { id: uid(), ...data };
  commit({ ...state, categories: [...state.categories, cat], stages: [...state.stages, defaultStage(cat.id)] });
  return ok({ id: cat.id });
}

export async function deleteCategory(id) {
  if (!categorySport(id)) return fail("Category not found.");
  const e = need(categorySport(id), "categories");
  if (e) return e;
  if (state.registrations.some((r) => r.categoryId === id)) return fail("This category has entries. Withdraw them first.");
  commit({
    ...state,
    categories: state.categories.filter((c) => c.id !== id),
    stages: state.stages.filter((s) => s.categoryId !== id),
    matches: state.matches.filter((m) => m.categoryId !== id),
  });
  return ok();
}

export async function addStarterCategories(tournamentId) {
  const sport = tournamentSport(tournamentId);
  if (!sport) return fail("Tournament not found.");
  const e = need(sport, "categories");
  if (e) return e;
  const bands = [
    ["Under 10", 0, 9],
    ["10–17", 10, 17],
    ["18–45", 18, 45],
    ["46–60", 46, 60],
    ["Above 60", 61, 120],
  ];
  const added = bands.flatMap(([name, minAge, maxAge]) =>
    ["M", "F"].map((gender) => ({ id: uid(), tournamentId, sport, name, gender, format: "singles", minAge, maxAge, fee: 0 }))
  );
  commit({ ...state, categories: [...state.categories, ...added], stages: [...state.stages, ...added.map((c) => defaultStage(c.id))] });
  return ok();
}

// ---------- stages: the structure of rounds inside a category ----------
const stageById = (id) => state.stages.find((s) => s.id === id);
const stageSport = (id) => categorySport(stageById(id)?.categoryId);
const hasMatches = (stageId) => state.matches.some((m) => m.stageId === stageId);
const laterStageHasMatches = (st) => stagesOf(state, st.categoryId).some((x) => x.seq > st.seq && hasMatches(x.id));

export async function saveStage({ id, categoryId, name, kind, groups, legs, advance }) {
  if (!categorySport(categoryId)) return fail("Category not found.");
  const e = need(categorySport(categoryId), "categories");
  if (e) return e;
  name = (name || "").trim();
  if (!name) return fail("Enter a name for this stage.");
  if (!["knockout", "round_robin", "custom"].includes(kind)) return fail("Choose a stage format.");
  const g = kind === "round_robin" ? Number(groups ?? 1) : 1;
  const l = kind === "round_robin" ? Number(legs ?? 1) : 1;
  const adv = kind === "knockout" ? 0 : Number(advance ?? 0);
  if (!Number.isInteger(g) || g < 1 || g > 16) return fail("Choose between 1 and 16 groups.");
  if (![1, 2].includes(l)) return fail("Choose single or double round robin.");
  if (!Number.isInteger(adv) || adv < 0 || adv > 64) return fail("Enter how many players advance (0 to 64).");
  if (!id) {
    const seq = Math.max(0, ...stagesOf(state, categoryId).map((s) => s.seq)) + 1;
    const st = { id: uid(), categoryId, seq, name, kind, groups: g, legs: l, advance: adv };
    commit({ ...state, stages: [...state.stages, st] });
    return ok({ id: st.id });
  }
  const old = state.stages.find((s) => s.id === id && s.categoryId === categoryId);
  if (!old) return fail("Stage not found.");
  if (hasMatches(id) && (old.kind !== kind || old.groups !== g || old.legs !== l)) return fail("This stage already has matches. Clear them before changing its format.");
  commit({ ...state, stages: state.stages.map((s) => (s.id === id ? { ...s, name, kind, groups: g, legs: l, advance: adv } : s)) });
  return ok({ id });
}

export async function deleteStage(id) {
  if (!stageById(id)) return fail("Stage not found.");
  const e = need(stageSport(id), "categories");
  if (e) return e;
  if (hasMatches(id)) return fail("This stage has matches. Clear them first.");
  commit({ ...state, stages: state.stages.filter((s) => s.id !== id) });
  return ok();
}

export async function moveStage(id, dir) {
  const st = stageById(id);
  if (!st) return fail("Stage not found.");
  const e = need(stageSport(id), "categories");
  if (e) return e;
  const list = stagesOf(state, st.categoryId);
  const i = list.findIndex((s) => s.id === id);
  const other = list[i + (dir < 0 ? -1 : 1)];
  if (!other) return ok();
  if (hasMatches(id) || hasMatches(other.id)) return fail("Clear the matches in both stages before changing their order.");
  commit({ ...state, stages: state.stages.map((s) => (s.id === id ? { ...s, seq: other.seq } : s.id === other.id ? { ...s, seq: st.seq } : s)) });
  return ok();
}

export async function resetAllData() {
  if (!isAdmin(state)) return adminOnly();
  const staff = state.accounts.filter((a) => a.role === "admin" || a.role === "organiser");
  commit({ ...initial(), accounts: staff, session: state.session });
  return ok();
}

// ---------- organisers (admin only) ----------
export async function saveOrganiser({ id, name, username, password, sport, perms }) {
  if (!isAdmin(state)) return adminOnly();
  name = (name || "").trim();
  const u = (username || "").trim().toLowerCase();
  if (!name) return fail("Enter the organiser's name.");
  if (!/^[a-z0-9._-]{3,20}$/.test(u)) return fail("The username must be 3 to 20 letters, numbers, dots, dashes or underscores.");
  if (!SPORTS.some((x) => x.slug === sport && x.ready)) return fail("Choose a sport that is already set up.");
  const clean = cleanPerms(perms);
  if (!clean) return fail("Choose at least one thing this organiser can do.");
  const hasPw = (password || "").length > 0;
  if (!id && !hasPw) return fail("Set a password for the new organiser.");
  if (hasPw && password.length < 8) return fail("The password must be at least 8 characters.");
  if (state.accounts.some((a) => a.username === u && a.id !== id)) return fail("This username is already taken.");
  if (id) {
    const acc = state.accounts.find((a) => a.id === id && a.role === "organiser");
    if (!acc) return fail("Organiser not found.");
    const passwordHash = hasPw ? await hashPassword(acc.username, password) : acc.passwordHash;
    commit({ ...state, accounts: state.accounts.map((a) => (a.id === id ? { ...a, name, sport, perms: clean, passwordHash } : a)) });
  } else {
    const acc = { id: uid(), name, username: u, passwordHash: await hashPassword(u, password), role: "organiser", sport, perms: clean };
    commit({ ...state, accounts: [...state.accounts, acc] });
  }
  return ok();
}

// Admin makes a player account an organiser of one sport (or changes what they may do). Same mobile + PIN login, same players.
export async function grantOrganiser({ accountId, sport, perms }) {
  if (!isAdmin(state)) return adminOnly();
  if (!SPORTS.some((x) => x.slug === sport && x.ready)) return fail("Choose a sport that is already set up.");
  const clean = cleanPerms(perms);
  if (!clean) return fail("Choose at least one thing this organiser can do.");
  if (!state.accounts.some((a) => a.id === accountId && a.role === "player")) return fail("Player account not found.");
  commit({ ...state, accounts: state.accounts.map((a) => (a.id === accountId ? { ...a, sport, perms: clean } : a)) });
  return ok();
}

// Organiser account: removed. Player made an organiser: keeps the account and players, loses only the organiser access.
export async function deleteOrganiser(id) {
  if (!isAdmin(state)) return adminOnly();
  const acc = state.accounts.find((a) => a.id === id && (a.role === "organiser" || a.role === "player"));
  if (!acc) return fail("Organiser not found.");
  if (acc.role === "player") {
    commit({ ...state, accounts: state.accounts.map((a) => (a.id === id ? { ...a, sport: null, perms: [] } : a)) });
  } else {
    commit({ ...state, accounts: state.accounts.filter((a) => a.id !== id) });
  }
  return ok();
}

// ---------- making matches ----------
const roundLabel = (n, round) => (n <= 2 ? "Final" : n <= 4 ? "Semi-finals" : n <= 8 ? "Quarter-finals" : `Round ${round}`);
const matchBase = (categoryId, stageId) => ({ categoryId, stageId, groupNo: null, scheduledAt: null, score1: null, score2: null, winnerRegId: null, status: "scheduled", bye: false, note: "" });
const nextSeq = (stageId, round, extra = []) =>
  Math.max(-1, ...state.matches.filter((m) => m.stageId === stageId && m.round === round).map((m) => m.seq), ...extra.filter((m) => m.stageId === stageId && m.round === round).map((m) => m.seq)) + 1;

// Knockout: round 1 is a random draw (byes for odd counts); later calls make the next round from the winners.
// Round robin: makes every match of every group at once. A later stage takes the players who advanced from the stage before it.
export async function generateStage(stageId) {
  const st = stageById(stageId);
  if (!st) return fail("Stage not found.");
  const e = need(categorySport(st.categoryId), "draws");
  if (e) return e;
  if (st.kind === "custom") return fail("Add match slots to this stage by hand.");
  const mine = state.matches.filter((m) => m.stageId === stageId);
  let ids;
  let round = 1;
  if (st.kind === "knockout" && mine.length) {
    round = Math.max(...mine.map((m) => m.round));
    if (mine.some((m) => m.round === round && m.status !== "done" && !m.bye)) return fail("Finish every match in this round first.");
    ids = mine.filter((m) => m.round === round && m.winnerRegId).sort((a, b) => (a.groupNo ?? -1) - (b.groupNo ?? -1) || a.seq - b.seq).map((m) => m.winnerRegId);
    if (ids.length < 2) return fail("This stage already has a champion.");
    round += 1;
  } else {
    if (mine.length) return fail("This stage already has its matches.");
    const prev = stagesOf(state, st.categoryId).filter((x) => x.seq < st.seq).pop();
    if (!prev) {
      ids = shuffle(state.registrations.filter((r) => r.categoryId === st.categoryId).map((r) => r.id));
    } else {
      if (!hasMatches(prev.id)) return fail(`Make the matches of "${prev.name}" first.`);
      if (!stageIsDone(state, prev.id)) return fail(`Finish every match in "${prev.name}" first.`);
      if (prev.kind === "knockout" || prev.advance < 1) return fail(`"${prev.name}" does not send players to the next stage. Set how many advance in its settings.`);
      ids = shuffle(standings(state, prev.id).flatMap((t) => t.rows.filter((r) => r.rank <= prev.advance).map((r) => r.regId)));
    }
    if (ids.length < 2) return fail("At least 2 entries are needed to make this stage.");
  }
  const n = ids.length;
  const made = [];
  if (st.kind === "knockout") {
    const label = roundLabel(n, round);
    for (let k = 0; k < Math.ceil(n / 2); k++) {
      const a = ids[2 * k];
      const b = ids[2 * k + 1] ?? null;
      made.push({ id: uid(), ...matchBase(st.categoryId, stageId), round, roundLabel: label, seq: k, p1RegId: a, p2RegId: b, winnerRegId: b ? null : a, status: b ? "scheduled" : "done", bye: !b });
    }
  } else {
    if (n < 2 * st.groups) return fail(`Too many groups for ${n} entries. Each group needs at least 2.`);
    for (let gi = 1; gi <= st.groups; gi++) {
      const members = ids.filter((_, i) => (i % st.groups) + 1 === gi);
      for (let leg = 1; leg <= st.legs; leg++) {
        let grp = [...members];
        if (grp.length % 2) grp.push(null);
        const sz = grp.length;
        for (let r = 1; r <= sz - 1; r++) {
          const base = (leg - 1) * (sz - 1) + r;
          for (let i = 0; i < sz / 2; i++) {
            const a = grp[i];
            const b = grp[sz - 1 - i];
            if (a && b) {
              made.push({ id: uid(), ...matchBase(st.categoryId, stageId), groupNo: gi, round: base, roundLabel: `Round ${base}`, seq: nextSeq(stageId, base, made), p1RegId: leg === 2 ? b : a, p2RegId: leg === 2 ? a : b });
            }
          }
          grp = [grp[0], grp[sz - 1], ...grp.slice(1, sz - 1)];
        }
      }
    }
  }
  commit({ ...state, matches: [...state.matches, ...made] });
  return ok();
}

// A match slot added or changed by hand (any stage). Players may be left empty and filled in later.
export async function saveMatch({ id, stageId, p1RegId, p2RegId, label, round, scheduledAt }) {
  const old = id ? state.matches.find((m) => m.id === id) : null;
  if (id && !old) return fail("Match not found.");
  const st = stageById(old ? old.stageId : stageId);
  if (!st) return fail("Stage not found.");
  const e = need(categorySport(st.categoryId), "draws");
  if (e) return e;
  const r = Number(round ?? 1);
  const p1 = p1RegId || null;
  const p2 = p2RegId || null;
  if (!Number.isInteger(r) || r < 1) return fail("The round number must be 1 or more.");
  if (p1 && p1 === p2) return fail("Choose two different players.");
  const inCat = (reg) => state.registrations.some((x) => x.id === reg && x.categoryId === st.categoryId);
  if (p1 && !inCat(p1)) return fail("Player 1 is not entered in this category.");
  if (p2 && !inCat(p2)) return fail("Player 2 is not entered in this category.");
  if (laterStageHasMatches(st)) return fail("A later stage already has matches. Clear it first.");
  const when = scheduledAt || null;
  if (!old) {
    const m = { id: uid(), ...matchBase(st.categoryId, st.id), round: r, roundLabel: (label || "").trim() || `Round ${r}`, seq: nextSeq(st.id, r), p1RegId: p1, p2RegId: p2, scheduledAt: when };
    commit({ ...state, matches: [...state.matches, m] });
    return ok({ id: m.id });
  }
  const changed = old.p1RegId !== p1 || old.p2RegId !== p2;
  if (old.status === "done" && changed) return fail("This match already has a result. Clear the result before changing the players.");
  if (old.bye && changed) return fail("A bye cannot be changed. Delete it instead.");
  commit({ ...state, matches: state.matches.map((m) => (m.id === id ? { ...m, p1RegId: p1, p2RegId: p2, scheduledAt: when, roundLabel: (label || "").trim() || m.roundLabel, round: r } : m)) });
  return ok({ id });
}

export async function deleteMatch(id) {
  const m = state.matches.find((x) => x.id === id);
  if (!m) return fail("Match not found.");
  const st = stageById(m.stageId);
  const e = need(categorySport(m.categoryId), "draws");
  if (e) return e;
  if (laterStageHasMatches(st)) return fail("A later stage already has matches. Clear it first.");
  commit({ ...state, matches: state.matches.filter((x) => x.id !== id) });
  return ok();
}

// Date and time of a match: whoever runs draws or scores may set it.
export async function setSchedule(matchId, when) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return fail("Match not found.");
  const sport = categorySport(m.categoryId);
  if (!canManage(state, sport)) return notYours();
  if (!can(state, sport, "draws") && !can(state, sport, "scores")) return noPerm();
  commit({ ...state, matches: state.matches.map((x) => (x.id === matchId ? { ...x, scheduledAt: when || null } : x)) });
  return ok();
}

// Results are locked once what depends on them exists: the next round of a knockout, or any later stage.
function resultLocked(m) {
  const st = stageById(m.stageId);
  if (laterStageHasMatches(st)) return "A later stage is already made. Clear it to change earlier results.";
  if (st.kind === "knockout" && state.matches.some((x) => x.stageId === m.stageId && x.round > m.round)) return "The next round is already made. Clear this stage to change earlier results.";
  return null;
}

export async function saveScore(matchId, { score1, score2, note }) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return fail("Match not found.");
  const e = need(categorySport(m.categoryId), "scores");
  if (e) return e;
  if (m.bye) return fail("A bye has no score.");
  if (!m.p1RegId || !m.p2RegId) return fail("Both players must be set before entering a score.");
  const a = Number(score1);
  const b = Number(score2);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return fail("Enter games won as whole numbers.");
  if (a === b) return fail("A match cannot end level. Enter the final games won.");
  const locked = resultLocked(m);
  if (locked) return fail(locked);
  commit({ ...state, matches: state.matches.map((x) => (x.id === matchId ? { ...x, score1: a, score2: b, winnerRegId: a > b ? m.p1RegId : m.p2RegId, status: "done", note: (note || "").trim() } : x)) });
  return ok();
}

export async function clearScore(matchId) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return fail("Match not found.");
  const e = need(categorySport(m.categoryId), "scores");
  if (e) return e;
  if (m.bye) return fail("A bye has no score.");
  const locked = resultLocked(m);
  if (locked) return fail(locked);
  commit({ ...state, matches: state.matches.map((x) => (x.id === matchId ? { ...x, score1: null, score2: null, winnerRegId: null, status: "scheduled", note: "" } : x)) });
  return ok();
}

// Removes this stage's matches and those of every stage after it (they depend on this one).
export async function clearStage(stageId) {
  const st = stageById(stageId);
  if (!st) return fail("Stage not found.");
  const e = need(categorySport(st.categoryId), "draws");
  if (e) return e;
  const ids = stagesOf(state, st.categoryId).filter((x) => x.seq >= st.seq).map((x) => x.id);
  commit({ ...state, matches: state.matches.filter((m) => !ids.includes(m.stageId)) });
  return ok();
}
