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
  { key: "categories", label: "Tournament setup", note: "Create tournaments, categories and fees, and the structure of rounds" },
  { key: "entries", label: "Entries and payments", note: "See entries, mark paid, withdraw" },
  { key: "draws", label: "Draws and match slots", note: "Make matches, add or edit slots, set times, clear a stage" },
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

// ---------- tournaments, categories, stages ----------
export const tournamentsOf = (s, sport) =>
  s.tournaments.filter((t) => t.sport === sport).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
// The tournament people see by default for a sport: the newest one that is open for entries, else the newest.
export const activeTournament = (s, sport) => {
  const list = tournamentsOf(s, sport);
  return list.find((t) => t.regOpen) || list[0] || null;
};
export const currentSeason = (s) => s.tournaments.map((t) => t.season).sort((a, b) => b - a)[0] || new Date().getFullYear();
export const dateText = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
export const dateTimeText = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
export const tournamentById = (s, id) => s.tournaments.find((t) => t.id === id) || null;

export const categoriesIn = (s, tournamentId) =>
  s.categories
    .filter((c) => c.tournamentId === tournamentId)
    .sort(
      (a, b) =>
        (a.format === "doubles") - (b.format === "doubles") ||
        a.minAge - b.minAge ||
        "MFX".indexOf(a.gender) - "MFX".indexOf(b.gender)
    );

// Every category of a sport, across its tournaments (newest tournament first).
export const sportCategories = (s, sport) =>
  tournamentsOf(s, sport).flatMap((t) => categoriesIn(s, t.id));
// "Under 18 · Men singles" plus the tournament name when the sport has more than one tournament.
export const categoryFullLabel = (s, c) => {
  const label = `${c.name} · ${c.gender === "M" ? "Men" : c.gender === "F" ? "Women" : "Mixed"} ${c.format}`;
  return tournamentsOf(s, c.sport).length > 1 ? `${label} · ${tournamentById(s, c.tournamentId)?.name || ""}` : label;
};
export const ageFor = (s, dob, cat) => ageOn(dob, (cat && cutoffFor(s, cat)) || activeTournament(s, "table-tennis")?.ageCutoff || new Date().toISOString().slice(0, 10));
export const cutoffFor = (s, cat) => tournamentById(s, cat.tournamentId)?.ageCutoff;
export const stagesOf = (s, categoryId) => s.stages.filter((x) => x.categoryId === categoryId).sort((a, b) => a.seq - b.seq);

export const STAGE_KINDS = [
  { key: "knockout", label: "Knockout", note: "Lose and you are out. Random draw, byes if the number is odd, a new round each time." },
  { key: "round_robin", label: "Round robin", note: "Everyone plays everyone in their group. Use several groups to split a big field." },
  { key: "custom", label: "Custom", note: "You create every match slot yourself: any pairing, any round name, any time." },
];
export const kindLabel = (k) => STAGE_KINDS.find((x) => x.key === k)?.label || k;
export const groupName = (n) => (n ? `Group ${String.fromCharCode(64 + n)}` : "");
export function stageSummary(st) {
  if (st.kind === "knockout") return "Knockout";
  if (st.kind === "custom") return `Custom${st.advance ? ` · top ${st.advance} advance` : ""}`;
  const g = st.groups > 1 ? `${st.groups} groups · ` : "";
  return `Round robin · ${g}${st.legs === 2 ? "play twice · " : ""}${st.advance ? `top ${st.advance} advance` : "no one advances"}`;
}

export const stageMatches = (s, stageId) => s.matches.filter((m) => m.stageId === stageId);
export const stageHasMatches = (s, stageId) => s.matches.some((m) => m.stageId === stageId);
export const stageIsDone = (s, stageId) => {
  const ms = stageMatches(s, stageId);
  return ms.length > 0 && ms.every((m) => m.bye || m.status === "done");
};

// Table of a round-robin or custom stage, one table per group. Order: wins, game difference, games won, then entry id (stable).
export function standings(s, stageId) {
  const groups = new Map();
  const row = (g, id) => {
    const key = g ?? 0;
    if (!groups.has(key)) groups.set(key, new Map());
    const gm = groups.get(key);
    if (!gm.has(id)) gm.set(id, { regId: id, played: 0, won: 0, lost: 0, gf: 0, ga: 0 });
    return gm.get(id);
  };
  for (const m of stageMatches(s, stageId)) {
    if (m.p1RegId) row(m.groupNo, m.p1RegId);
    if (m.p2RegId) row(m.groupNo, m.p2RegId);
    if (m.status === "done" && !m.bye && m.p1RegId && m.p2RegId) {
      const a = row(m.groupNo, m.p1RegId);
      const b = row(m.groupNo, m.p2RegId);
      a.played++; b.played++;
      a.gf += m.score1; a.ga += m.score2; b.gf += m.score2; b.ga += m.score1;
      if (m.winnerRegId === m.p1RegId) { a.won++; b.lost++; } else { b.won++; a.lost++; }
    }
  }
  return [...groups.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([g, rows]) => ({
      group: g || null,
      rows: [...rows.values()]
        .sort((a, b) => b.won - a.won || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || (a.regId < b.regId ? -1 : 1))
        .map((r, i) => ({ ...r, rank: i + 1 })),
    }));
}

// The category's champion: only once its LAST stage is finished (a knockout's final, or a single-group table's leader).
export function champion(s, categoryId) {
  const stages = stagesOf(s, categoryId);
  const made = stages.filter((st) => stageHasMatches(s, st.id));
  if (!made.length) return null;
  const last = made[made.length - 1];
  if (stages[stages.length - 1].id !== last.id) return null;
  if (last.kind === "knockout") {
    const ms = stageMatches(s, last.id);
    const top = Math.max(...ms.map((m) => m.round));
    const cur = ms.filter((m) => m.round === top);
    return cur.length === 1 && cur[0].status === "done" && cur[0].p2RegId ? cur[0].winnerRegId : null;
  }
  if (!stageIsDone(s, last.id)) return null;
  const tables = standings(s, last.id);
  return tables.length === 1 ? tables[0].rows[0].regId : null;
};

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

export const formatMoney = (n) => (Number(n) > 0 ? `₹${Number(n).toLocaleString("en-IN")}` : "Free");
