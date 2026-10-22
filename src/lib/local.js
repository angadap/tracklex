// Offline DEMO backend. State lives in localStorage, so the whole app works with no server.
// Used when the Supabase keys are not set (see db.js), and by the automated screen tests.
// It mirrors the rules and permissions of the live database (supabase/migrations) and exposes the same functions
// as remote.js. Data here stays in the one browser it was entered in.
import { useSyncExternalStore } from "react";
import { SPORTS } from "../data/sports.js";
import {
  SPORT, ok, fail, isEligible, me, isAdmin, isStaffAccount, canManage, can, PERMS, deriveEntries,
} from "./core.js";

const KEY = "warje.db.v1";

const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

const initial = () => ({
  settings: { season: 2026, ageCutoff: "2026-10-01" },
  accounts: [], // player: { id, name, mobile, pinHash, role: "player" }
  // admin: { id, name, username, passwordHash, role: "admin" }  (does everything)
  // organiser: { id, name, username, passwordHash, role: "organiser", sport }  (runs one sport's tournament only)
  players: [], // { id, accountId, name, dob, gender: "M" | "F", society, relation: "self" | "child" }
  categories: [], // { id, sport, name, gender: "M" | "F" | "X", format: "singles" | "doubles", minAge, maxAge, fee }
  registrations: [], // { id, playerId, categoryId, partnerName, paid, paidAt, createdAt }
  matches: [], // { id, categoryId, round, roundLabel, seq, p1RegId, p2RegId, score1, score2, winnerRegId, status, bye, note }
  entries: [], // derived: public names per entry
  session: null, // accountId
  guest: false, // browsing without an account
  error: "",
});

// Older saved demo data: organiser accounts made before permission levels get every permission.
const ALL = ["categories", "entries", "draws", "scores"];
const upgrade = (s) => ({
  ...s,
  accounts: s.accounts.map((a) => (a.perms ? a : { ...a, perms: a.role === "organiser" ? ALL : [] })),
});
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
  if (!isEligible(player, cat, state.settings.ageCutoff)) return fail(`${player.name} is not eligible for ${cat.name}.`);
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

// ---------- categories (admin and the sport's organiser) ----------
export async function saveCategory(input) {
  const e = need(SPORT, "categories");
  if (e) return e;
  if (input.id && categorySport(input.id) !== SPORT) return notYours();
  const name = input.name.trim();
  const minAge = Number(input.minAge);
  const maxAge = Number(input.maxAge);
  const fee = Number(input.fee || 0);
  if (!name) return fail("Enter a category name.");
  if (!Number.isInteger(minAge) || !Number.isInteger(maxAge) || minAge < 0 || maxAge < minAge) return fail("Enter a valid age range (minimum cannot be above maximum).");
  if (!(fee >= 0)) return fail("Fee cannot be negative.");
  const data = { sport: SPORT, name, gender: input.gender, format: input.format, minAge, maxAge, fee };
  if (input.id) commit({ ...state, categories: state.categories.map((c) => (c.id === input.id ? { ...c, ...data } : c)) });
  else commit({ ...state, categories: [...state.categories, { id: uid(), ...data }] });
  return ok();
}

export async function deleteCategory(id) {
  const e = need(categorySport(id), "categories");
  if (e) return e;
  if (state.registrations.some((r) => r.categoryId === id)) return fail("This category has entries. Withdraw them first.");
  commit({ ...state, categories: state.categories.filter((c) => c.id !== id) });
  return ok();
}

export async function addStarterCategories() {
  const e = need(SPORT, "categories");
  if (e) return e;
  const bands = [
    ["Under 10", 0, 9],
    ["10–17", 10, 17],
    ["18–45", 18, 45],
    ["46–60", 46, 60],
    ["Above 60", 61, 120],
  ];
  const added = bands.flatMap(([name, minAge, maxAge]) =>
    ["M", "F"].map((gender) => ({ id: uid(), sport: SPORT, name, gender, format: "singles", minAge, maxAge, fee: 0 }))
  );
  commit({ ...state, categories: [...state.categories, ...added] });
  return ok();
}

export async function saveSettings({ season, ageCutoff }) {
  if (!isAdmin(state)) return adminOnly();
  const y = Number(season);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return fail("Enter a valid season year.");
  if (!ageCutoff) return fail("Choose the date ages are counted on.");
  commit({ ...state, settings: { season: y, ageCutoff } });
  return ok();
}

export async function resetAllData() {
  if (!isAdmin(state)) return adminOnly();
  const staff = state.accounts.filter((a) => a.role === "admin" || a.role === "organiser");
  commit({ ...initial(), settings: state.settings, accounts: staff, session: state.session });
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

// ---------- matches ----------
const roundLabel = (n, round) => (n <= 2 ? "Final" : n <= 4 ? "Semi-finals" : n <= 8 ? "Quarter-finals" : `Round ${round}`);

export async function generateRound(categoryId) {
  const e = need(categorySport(categoryId), "draws");
  if (e) return e;
  const regs = state.registrations.filter((r) => r.categoryId === categoryId);
  const ms = state.matches.filter((m) => m.categoryId === categoryId);
  let ids;
  let round = 1;
  if (!ms.length) {
    if (regs.length < 2) return fail("At least 2 entries are needed to make a draw.");
    ids = shuffle(regs.map((r) => r.id));
  } else {
    round = Math.max(...ms.map((m) => m.round));
    const cur = ms.filter((m) => m.round === round).sort((a, b) => a.seq - b.seq);
    if (cur.some((m) => m.status !== "done")) return fail("Finish every match in this round first.");
    ids = cur.map((m) => m.winnerRegId);
    if (ids.length < 2) return fail("This category already has a champion.");
    round += 1;
  }
  const label = roundLabel(ids.length, round);
  const created = [];
  for (let i = 0; i < ids.length; i += 2) {
    const b = ids[i + 1] ?? null;
    created.push({
      id: uid(), categoryId, round, roundLabel: label, seq: i / 2,
      p1RegId: ids[i], p2RegId: b, score1: null, score2: null,
      winnerRegId: b ? null : ids[i], status: b ? "scheduled" : "done", bye: !b, note: "",
    });
  }
  commit({ ...state, matches: [...state.matches, ...created] });
  return ok();
}

export async function saveScore(matchId, { score1, score2, note }) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return fail("Match not found.");
  const e = need(categorySport(m.categoryId), "scores");
  if (e) return e;
  const a = Number(score1);
  const b = Number(score2);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return fail("Enter games won as whole numbers.");
  if (a === b) return fail("A match cannot end level. Enter the final games won.");
  const later = state.matches.some((x) => x.categoryId === m.categoryId && x.round > m.round);
  if (later) return fail("The next round is already made. Clear the draw to change earlier results.");
  const winnerRegId = a > b ? m.p1RegId : m.p2RegId;
  commit({ ...state, matches: state.matches.map((x) => (x.id === matchId ? { ...x, score1: a, score2: b, winnerRegId, status: "done", note: (note || "").trim() } : x)) });
  return ok();
}

export async function clearDraw(categoryId) {
  const e = need(categorySport(categoryId), "draws");
  if (e) return e;
  commit({ ...state, matches: state.matches.filter((m) => m.categoryId !== categoryId) });
  return ok();
}
