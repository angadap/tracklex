import { entryName, dateTimeText } from "../lib/db.js";

function Side({ name, score, win, dim }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`min-w-0 truncate text-[15px] ${win ? "font-extrabold text-white" : dim ? "text-muted" : "font-semibold text-soft"}`}>{name}</span>
      <span className={`font-display text-2xl font-extrabold italic tabular-nums ${win ? "text-white" : "text-muted"}`}>{score ?? "–"}</span>
    </div>
  );
}

export default function MatchRow({ m, db, onClick, mine }) {
  const a = m.p1RegId ? entryName(db, m.p1RegId) : "To be decided";
  const b = m.p2RegId ? entryName(db, m.p2RegId) : m.bye ? "Bye" : "To be decided";
  const done = m.status === "done";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`block w-full rounded-2xl bg-surface px-4 py-3 text-left ${mine ? "ring-1 ring-white/70" : ""}`}
    >
      <Side name={a} score={m.bye ? "" : m.score1} win={done && m.winnerRegId === m.p1RegId} />
      <div className="my-1 h-px bg-hair" />
      <Side name={b} score={m.bye ? "" : m.score2} win={done && m.winnerRegId === m.p2RegId} dim={m.bye} />
      <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        {m.bye ? "Advances without playing" : done ? "Final score, games won" : m.scheduledAt ? dateTimeText(m.scheduledAt) : "To be played"}
        {done && m.scheduledAt ? ` · ${dateTimeText(m.scheduledAt)}` : ""}{m.note ? ` · ${m.note}` : ""}
        {mine ? " · Your match" : ""}
      </p>
    </Tag>
  );
}
