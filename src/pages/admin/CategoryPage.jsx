import { useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { Plus, Shuffle, ChevronUp, ChevronDown, Pencil, Trash2, CalendarPlus } from "lucide-react";
import {
  useDb, can, categoryLabel, tournamentById, stagesOf, stageMatches, stageSummary, entryCount, STAGE_KINDS, kindLabel,
  saveStage, deleteStage, moveStage, generateStage, clearStage, saveMatch, deleteMatch, setSchedule, saveScore, clearScore, entryName,
} from "../../lib/db.js";
import { TopBar, Page, Btn, Card, Chip, Empty, Sheet, Field, ErrorText, SectionTitle, inputCls } from "../../components/ui.jsx";
import { StandingsTable, MatchesByRound } from "../../components/CategoryResults.jsx";

const toLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);

const blankStage = { name: "", kind: "knockout", groups: 1, legs: 1, advance: 0 };

export default function CategoryPage() {
  const { cid } = useParams();
  const db = useDb();
  const cat = db.categories.find((c) => c.id === cid);
  const [stageForm, setStageForm] = useState(null);
  const [matchForm, setMatchForm] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  if (!cat) return <Navigate to="/admin/tournaments" replace />;

  const sport = cat.sport;
  const mayEdit = can(db, sport, "categories");
  const mayDraw = can(db, sport, "draws");
  const mayScore = can(db, sport, "scores");
  const t = tournamentById(db, cat.tournamentId);
  const stages = stagesOf(db, cat.id);
  const entries = db.entries.filter((e) => e.categoryId === cat.id);
  const n = entryCount(db, cat.id);

  const run = async (p) => {
    const res = await p;
    setNote(res.ok ? "" : res.error);
    return res;
  };

  async function saveStageForm(e) {
    e.preventDefault();
    const res = await saveStage({ ...stageForm, categoryId: cat.id });
    if (!res.ok) return setError(res.error);
    setStageForm(null);
    setError("");
  }
  async function removeStage() {
    const res = await deleteStage(stageForm.id);
    if (!res.ok) return setError(res.error);
    setStageForm(null);
  }
  async function clear(st) {
    const later = stages.filter((x) => x.seq > st.seq && stageMatches(db, x.id).length);
    const extra = later.length ? ` The matches of ${later.map((x) => `"${x.name}"`).join(", ")} will be cleared too.` : "";
    if (confirm(`Clear all matches and results in "${st.name}"?${extra}`)) await run(clearStage(st.id));
  }

  // ---- match sheet
  const openMatch = (m) => { setMatchForm({ ...m, when: toLocal(m.scheduledAt), s1: m.score1 ?? "", s2: m.score2 ?? "", label: m.roundLabel }); setError(""); };
  const newMatch = (st) => {
    const last = Math.max(0, ...stageMatches(db, st.id).map((m) => m.round));
    setMatchForm({ id: null, stageId: st.id, p1RegId: "", p2RegId: "", label: "", round: last || 1, when: "", s1: "", s2: "", note: "", status: "scheduled" });
    setError("");
  };
  const mf = (k) => (e) => setMatchForm({ ...matchForm, [k]: e.target.value });

  async function saveSlot(e) {
    e.preventDefault();
    const res = await saveMatch({ id: matchForm.id, stageId: matchForm.stageId, p1RegId: matchForm.p1RegId, p2RegId: matchForm.p2RegId, label: matchForm.label, round: matchForm.round, scheduledAt: fromLocal(matchForm.when) });
    if (!res.ok) return setError(res.error);
    setMatchForm(null);
  }
  async function saveTime(e) {
    e.preventDefault();
    const res = await setSchedule(matchForm.id, fromLocal(matchForm.when));
    if (!res.ok) return setError(res.error);
    setMatchForm(null);
  }
  async function saveResult(e) {
    e.preventDefault();
    const res = await saveScore(matchForm.id, { score1: matchForm.s1, score2: matchForm.s2, note: matchForm.note });
    if (!res.ok) return setError(res.error);
    setMatchForm(null);
  }
  async function clearResult() {
    const res = await clearScore(matchForm.id);
    if (!res.ok) return setError(res.error);
    setMatchForm(null);
  }
  async function removeSlot() {
    if (!confirm("Delete this match slot?")) return;
    const res = await deleteMatch(matchForm.id);
    if (!res.ok) return setError(res.error);
    setMatchForm(null);
  }

  const playerOptions = (
    <>
      <option value="">To be decided</option>
      {entries.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </>
  );
  const editing = matchForm?.id ? db.matches.find((m) => m.id === matchForm.id) : null;
  const bothSet = editing?.p1RegId && editing?.p2RegId;

  return (
    <>
      <TopBar title={categoryLabel(cat)} back={`/admin/tournaments/${cat.tournamentId}`} backLabel={t?.name || "Tournament"} sub={`Ages ${cat.minAge}–${cat.maxAge} · ${n} ${n === 1 ? "entry" : "entries"}`} />
      <Page>
        <SectionTitle>Rounds</SectionTitle>
        <p className="-mt-2 mb-3 text-sm text-soft">
          A category runs through its stages in order. For example, a round robin in groups where the top 2 advance, then a knockout.
        </p>
        {note && <div className="mb-3"><ErrorText>{note}</ErrorText></div>}
        {stages.length === 0 && <Empty title="No stages yet">Add a stage to decide how this category is played.</Empty>}

        <ol className="space-y-5">
          {stages.map((st, i) => {
            const ms = stageMatches(db, st.id);
            const played = ms.filter((m) => m.status === "done" && !m.bye).length;
            const total = ms.filter((m) => !m.bye).length;
            return (
              <li key={st.id}>
                <Card>
                  <div className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-lg font-extrabold italic">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{st.name}</p>
                      <p className="mt-0.5 text-[13px] text-soft">{stageSummary(st)}</p>
                      <div className="mt-2"><Chip tone={ms.length && played === total ? "good" : "neutral"}>{ms.length ? `${played} of ${total} played` : "No matches yet"}</Chip></div>
                    </div>
                    {mayEdit && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button aria-label="Move earlier" disabled={i === 0} onClick={() => run(moveStage(st.id, -1))} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 disabled:opacity-30"><ChevronUp size={17} aria-hidden="true" /></button>
                        <button aria-label="Move later" disabled={i === stages.length - 1} onClick={() => run(moveStage(st.id, 1))} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 disabled:opacity-30"><ChevronDown size={17} aria-hidden="true" /></button>
                        <button aria-label={`Edit ${st.name}`} onClick={() => { setStageForm({ ...st }); setError(""); }} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2"><Pencil size={15} aria-hidden="true" /></button>
                      </div>
                    )}
                  </div>

                  {mayDraw && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {st.kind !== "custom" && !(st.kind === "round_robin" && ms.length) && (
                        <Btn className="h-11 flex-1 px-4 text-sm" onClick={() => run(generateStage(st.id))}>
                          <Shuffle size={16} aria-hidden="true" /> {ms.length ? "Make next round" : "Make matches"}
                        </Btn>
                      )}
                      <Btn variant="soft" className="h-11 flex-1 px-4 text-sm" onClick={() => newMatch(st)}>
                        <CalendarPlus size={16} aria-hidden="true" /> Add match slot
                      </Btn>
                      {ms.length > 0 && (
                        <Btn variant="danger" className="h-11 px-4 text-sm" onClick={() => clear(st)} aria-label={`Clear matches of ${st.name}`}>
                          <Trash2 size={16} aria-hidden="true" /> Clear
                        </Btn>
                      )}
                    </div>
                  )}
                </Card>

                {ms.length > 0 && (
                  <div className="mt-3">
                    {st.kind !== "knockout" && <StandingsTable db={db} stage={st} />}
                    <MatchesByRound db={db} matches={ms} onPick={mayDraw || mayScore ? openMatch : undefined} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {mayEdit && (
          <Btn variant="soft" className="mt-5 w-full" onClick={() => { setStageForm({ ...blankStage, name: stages.length ? `Stage ${stages.length + 1}` : "Knockout" }); setError(""); }}>
            <Plus size={18} aria-hidden="true" /> Add stage
          </Btn>
        )}
      </Page>

      {/* ---- stage sheet ---- */}
      <Sheet open={!!stageForm} onClose={() => setStageForm(null)} title={stageForm?.id ? "Edit stage" : "Add stage"}>
        {stageForm && (
          <form onSubmit={saveStageForm} className="space-y-4">
            <Field label="Name"><input className={inputCls} value={stageForm.name} onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })} placeholder="For example, Group stage" required /></Field>
            <fieldset>
              <legend className="mb-2 text-sm font-bold">How is it played?</legend>
              <ul className="space-y-1.5">
                {STAGE_KINDS.map((k) => (
                  <li key={k.key}>
                    <label className={`flex items-start gap-3 rounded-xl px-3.5 py-3 ${stageForm.kind === k.key ? "bg-white text-void" : "bg-surface-2"}`}>
                      <input type="radio" name="kind" className="mt-1 accent-black" checked={stageForm.kind === k.key} onChange={() => setStageForm({ ...stageForm, kind: k.key })} />
                      <span>
                        <span className="block text-sm font-bold">{k.label}</span>
                        <span className={`block text-[13px] ${stageForm.kind === k.key ? "text-void/70" : "text-soft"}`}>{k.note}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {stageForm.kind === "round_robin" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Groups" hint="Players are split evenly."><input className={inputCls} inputMode="numeric" value={stageForm.groups} onChange={(e) => setStageForm({ ...stageForm, groups: e.target.value })} /></Field>
                <Field label="Each pair plays">
                  <select className={inputCls} value={stageForm.legs} onChange={(e) => setStageForm({ ...stageForm, legs: Number(e.target.value) })}>
                    <option value={1}>Once</option><option value={2}>Twice</option>
                  </select>
                </Field>
              </div>
            )}
            {stageForm.kind !== "knockout" && (
              <Field label={stageForm.kind === "round_robin" ? "Advance from each group" : "Advance to the next stage"} hint="0 means nobody moves on (this is the last stage).">
                <input className={inputCls} inputMode="numeric" value={stageForm.advance} onChange={(e) => setStageForm({ ...stageForm, advance: e.target.value })} />
              </Field>
            )}
            {stageForm.id && <p className="text-[13px] text-soft">The format of a stage cannot change once it has matches. Clear them first.</p>}
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save stage</Btn>
            {stageForm.id && <Btn variant="danger" className="w-full" onClick={removeStage}>Delete stage</Btn>}
          </form>
        )}
      </Sheet>

      {/* ---- match slot sheet ---- */}
      <Sheet open={!!matchForm} onClose={() => setMatchForm(null)} title={matchForm?.id ? "Match" : "Add match slot"}>
        {matchForm && (
          <div className="space-y-6">
            {mayDraw && !editing?.bye && (
              <form onSubmit={saveSlot} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Player 1"><select className={inputCls} value={matchForm.p1RegId || ""} onChange={mf("p1RegId")}>{playerOptions}</select></Field>
                  <Field label="Player 2"><select className={inputCls} value={matchForm.p2RegId || ""} onChange={mf("p2RegId")}>{playerOptions}</select></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Round name" hint="Shown to players."><input className={inputCls} value={matchForm.label} onChange={mf("label")} placeholder="Semi-final" /></Field>
                  <Field label="Round number" hint="Groups matches together."><input className={inputCls} inputMode="numeric" value={matchForm.round} onChange={mf("round")} /></Field>
                </div>
                <Field label="Date and time"><input className={inputCls} type="datetime-local" value={matchForm.when} onChange={mf("when")} /></Field>
                <ErrorText>{error}</ErrorText>
                <Btn type="submit" className="w-full">{matchForm.id ? "Save match" : "Add match slot"}</Btn>
              </form>
            )}
            {!mayDraw && mayScore && editing && !editing.bye && (
              <form onSubmit={saveTime} className="space-y-4">
                <Field label="Date and time"><input className={inputCls} type="datetime-local" value={matchForm.when} onChange={mf("when")} /></Field>
                <Btn type="submit" variant="soft" className="w-full">Save time</Btn>
              </form>
            )}
            {editing?.bye && <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">{entryName(db, editing.p1RegId)} advances without playing.</p>}

            {mayScore && editing && !editing.bye && (
              <form onSubmit={saveResult} className="space-y-4">
                <p className="text-sm font-bold">Result · games won</p>
                {!bothSet ? (
                  <p className="text-sm text-soft">Set both players before entering a result.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={entryName(db, editing.p1RegId)}><input className={inputCls} inputMode="numeric" value={matchForm.s1} onChange={mf("s1")} required /></Field>
                      <Field label={entryName(db, editing.p2RegId)}><input className={inputCls} inputMode="numeric" value={matchForm.s2} onChange={mf("s2")} required /></Field>
                    </div>
                    <Field label="Note"><input className={inputCls} value={matchForm.note} onChange={mf("note")} placeholder="Optional" /></Field>
                    {!mayDraw && <ErrorText>{error}</ErrorText>}
                    <Btn type="submit" className="w-full">Save result</Btn>
                    {editing.status === "done" && <Btn variant="soft" className="w-full" onClick={clearResult}>Clear result</Btn>}
                  </>
                )}
              </form>
            )}
            {mayDraw && editing && <Btn variant="danger" className="w-full" onClick={removeSlot}>Delete match slot</Btn>}
          </div>
        )}
      </Sheet>
    </>
  );
}
