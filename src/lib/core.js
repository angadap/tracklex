// Shared by both data backends (local demo and Supabase): pure rules and selectors.
// Nothing here touches storage or the network. Selectors take the app state as their first argument.
import { SPORTS } from "../data/sports.js";

export const SPORT = "table-tennis";

export const ok = (extra = {}) => ({ ok: true, ...extra });
export const fail = (error) => ({ ok: false, error });

export function ageOn(dob, on) {
  const d = new Date(dob);
  const c = new Date(on);
  let age = c.getFullYear() - d.getFullYear();
  const m = c.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && c.getDate() < d.getDate())) age--;
  return age;
}

export function isEligible(player, cat, cutoff) {
  const age = ageOn(player.dob, cutoff);
  return age >= cat.minAge && age <= cat.maxAge && (cat.gender === "X" || cat.gender === player.gender);
}

// ---------- selectors ----------
export const me = (s) => s.accounts.find((a) => a.id === s.session) || null;
export const isAdmin = (s) => me(s)?.role === "admin";

// What an organiser can be allowed to do. Admin can do all of it, in every sport.
export const PERMS = [
  { key: "categories", label: "Categories and fees", note: "Add, edit and delete categories" },
  { key: "entries", label: "Entries and payments", note: "See entries, mark paid, withdraw" },
  { key: "draws", label: "Draws", note: "Make rounds, clear a draw" },
  { key: "scores", label: "Scores", note: "Enter match results" },
];
export const PRESETS = [
  { name: "Full organiser", perms: ["categories", "entries", "draws", "scores"] },
  { name: "Registration desk", perms: ["entries"] },
  { name: "Scorer", perms: ["scores"] },
];
export const presetName = (perms = []) => {
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  return PRESETS.find((p) => same(p.perms, perms))?.name || `${perms.length} of ${PERMS.length} permissions`;
};

// An organiser grant is a sport plus permissions. Organiser accounts always have one; the admin can also give one to a player account.
export const grantOf = (s) => {
  const m = me(s);
  return m && m.role !== "admin" && m.sport && m.perms?.length ? { sport: m.sport, perms: m.perms } : null;
};
export const isOrganiser = (s) => !!grantOf(s);
export const isStaff = (s) => isAdmin(s) || isOrganiser(s);
// Signed in with an admin or organiser ACCOUNT (not a player who was made an organiser): these do not register for events.
export const isStaffAccount = (s) => ["admin", "organiser"].includes(me(s)?.role);
// May this person do `perm` in `sport`?
export const can = (s, sport, perm) => !!sport && (isAdmin(s) || (grantOf(s)?.sport === sport && grantOf(s).perms.includes(perm)));
// Does this person run anything in `sport`?
export const canManage = (s, sport) => !!sport && (isAdmin(s) || grantOf(s)?.sport === sport);
export const sportName = (slug) => SPORTS.find((x) => x.slug === slug)?.name || slug;
export const myPlayers = (s) => s.players.filter((p) => p.accountId === s.session);

export const tableTennisCategories = (s) =>
  s.categories
    .filter((c) => c.sport === SPORT)
    .sort(
      (a, b) =>
        (a.format === "doubles") - (b.format === "doubles") ||
        a.minAge - b.minAge ||
        "MFX".indexOf(a.gender) - "MFX".indexOf(b.gender)
    );

export const categoryLabel = (c) =>
  `${c.name} · ${c.gender === "M" ? "Men" : c.gender === "F" ? "Women" : "Mixed"} ${c.format}`;

// `entries` is the public list of who is playing in each category: { id (entry id), categoryId, name }.
// It carries no date of birth, mobile number or payment status, so everyone (even guests) can see brackets.
const entryIndex = new WeakMap();
const entryMap = (s) => {
  let m = entryIndex.get(s.entries);
  if (!m) {
    m = new Map(s.entries.map((e) => [e.id, e]));
    entryIndex.set(s.entries, m);
  }
  return m;
};
export const entryName = (s, regId) => entryMap(s).get(regId)?.name || "Unknown";
export const entryCount = (s, categoryId) => s.entries.filter((e) => e.categoryId === categoryId).length;

export function deriveEntries(s) {
  return s.registrations.flatMap((r) => {
    const p = s.players.find((x) => x.id === r.playerId);
    if (!p) return [];
    return [{ id: r.id, categoryId: r.categoryId, name: r.partnerName ? `${p.name} & ${r.partnerName}` : p.name }];
  });
}

export const champion = (s, categoryId) => {
  const ms = s.matches.filter((m) => m.categoryId === categoryId);
  if (!ms.length) return null;
  const last = Math.max(...ms.map((m) => m.round));
  const cur = ms.filter((m) => m.round === last);
  return cur.length === 1 && cur[0].status === "done" && cur[0].p2RegId ? cur[0].winnerRegId : null;
};

export const formatMoney = (n) => (Number(n) > 0 ? `₹${Number(n).toLocaleString("en-IN")}` : "Free");
