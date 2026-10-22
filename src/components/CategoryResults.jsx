import MatchRow from "./MatchRow.jsx";
import { entryName, stagesOf, stageMatches, standings, stageSummary, groupName, champion } from "../lib/db.js";

// Read-only view of one category: its stages in order, tables for round-robin stages, and matches by round.
export function StandingsTable({ db, stage }) {
  const tables = standings(db, stage.id);
  if (!tables.length) return null;
  return (
    <div className="mb-3 space-y-3">
      {tables.map((t) => (
        <div key={t.group ?? 0} className="overflow-hidden rounded-2xl bg-surface">
          {t.group && <p className="px-4 pt-3 text-xs font-bold uppercase tracking-[0.14em] text-muted">{groupName(t.group)}</p>}
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                <th className="px-4 py-2 font-bold">#</th>
                <th className="py-2 font-bold">Player</th>
                <th className="py-2 text-right font-bold">P</th>
                <th className="py-2 text-right font-bold">W</th>
                <th className="py-2 text-right font-bold">L</th>
                <th className="px-4 py-2 text-right font-bold">Games</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.regId} className={`border-t border-hair ${stage.advance && r.rank <= stage.advance ? "text-white" : "text-soft"}`}>
                  <td className="px-4 py-2 font-bold tabular-nums">{r.rank}</td>
                  <td className="max-w-[150px] truncate py-2 font-semibold">{entryName(db, r.regId)}</td>
                  <td className="py-2 text-right tabular-nums">{r.played}</td>
                  <td className="py-2 text-right tabular-nums">{r.won}</td>
                  <td className="py-2 text-right tabular-nums">{r.lost}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.gf}–{r.ga}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stage.advance > 0 && <p className="border-t border-hair px-4 py-2 text-[11px] text-muted">Top {stage.advance} advance</p>}
        </div>
      ))}
    </div>
  );
}

export function MatchesByRound({ db, matches, mineRegIds, onPick }) {
  const groups = [...new Set(matches.map((m) => m.groupNo ?? 0))].sort((a, b) => a - b);
  return groups.map((g) => {
    const inGroup = matches.filter((m) => (m.groupNo ?? 0) === g);
    // A round is its number plus its name, so a hand-made slot called "Bronze" gets its own heading.
    const rounds = [...new Map(inGroup.map((m) => [`${m.round}|${m.roundLabel}`, m])).values()]
      .sort((a, b) => a.round - b.round || a.roundLabel.localeCompare(b.roundLabel))
      .map((m) => `${m.round}|${m.roundLabel}`);
    return (
      <div key={g} className="mb-2">
        {g > 0 && <p className="mb-1.5 text-sm font-bold">{groupName(g)}</p>}
        {rounds.map((r) => (
          <div key={r} className="mb-3">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.14em] text-muted">{r.slice(r.indexOf("|") + 1)}</p>
            <div className="space-y-2">
              {inGroup
                .filter((m) => `${m.round}|${m.roundLabel}` === r)
                .sort((a, b) => a.seq - b.seq)
                .map((m) => (
                  <MatchRow key={m.id} m={m} db={db} mine={mineRegIds?.has(m.p1RegId) || mineRegIds?.has(m.p2RegId)} onClick={onPick ? () => onPick(m) : undefined} />
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  });
}

export default function CategoryResults({ db, category, mineRegIds }) {
  const stages = stagesOf(db, category.id).filter((s) => stageMatches(db, s.id).length > 0);
  const champ = champion(db, category.id);
  if (!stages.length) return null;
  return (
    <div className="mb-6">
      {champ && <p className="mb-2 rounded-xl bg-[#33270f] px-4 py-2.5 text-sm font-bold text-[#fbbf24]">Champion: {entryName(db, champ)}</p>}
      {stages.map((st) => {
        const ms = stageMatches(db, st.id);
        return (
          <div key={st.id} className="mb-4">
            <p className="mb-2 text-sm font-bold">
              {st.name} <span className="font-semibold text-muted">· {stageSummary(st)}</span>
            </p>
            {st.kind !== "knockout" && <StandingsTable db={db} stage={st} />}
            <MatchesByRound db={db} matches={ms} mineRegIds={mineRegIds} />
          </div>
        );
      })}
    </div>
  );
}
