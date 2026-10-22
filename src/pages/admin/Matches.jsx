import { useState } from "react";
import { Shuffle, Trash2 } from "lucide-react";
import { useDb, can, tableTennisCategories, categoryLabel, entryName, entryCount, generateRound, saveScore, clearDraw, champion } from "../../lib/db.js";
import MatchRow from "../../components/MatchRow.jsx";
import { TopBar, Page, Btn, Empty, Sheet, Field, ErrorText, inputCls, inputCls as ic } from "../../components/ui.jsx";

export default function Matches() {
  const db = useDb();
  const cats = tableTennisCategories(db);
  const [catId, setCatId] = useState(cats[0]?.id || "");
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(null);
  const [formError, setFormError] = useState("");

  const mayDraw = can(db, "table-tennis", "draws");
  const mayScore = can(db, "table-tennis", "scores");
  const cat = cats.find((c) => c.id === catId);
  const entries = { length: entryCount(db, catId) };
  const ms = db.matches.filter((m) => m.categoryId === catId).sort((a, b) => a.round - b.round || a.seq - b.seq);
  const rounds = [...new Set(ms.map((m) => m.round))];
  const champ = cat ? champion(db, cat.id) : null;

  async function make() {
    const res = await generateRound(catId);
    setError(res.ok ? "" : res.error);
  }
  async function clear() {
    if (confirm("Clear the whole draw and all scores for this category?")) {
      const res = await clearDraw(catId);
      setError(res.ok ? "" : res.error);
    }
  }
  async function submit(e) {
    e.preventDefault();
    const res = await saveScore(edit.id, edit);
    if (!res.ok) return setFormError(res.error);
    setEdit(null);
  }

  if (cats.length === 0) {
    return (
      <>
        <TopBar title="Matches" back="/admin" backLabel="Dashboard" />
        <Page><Empty title="Add categories first" action={<Btn to="/admin/categories">Set up categories</Btn>}>Matches are made for each category.</Empty></Page>
      </>
    );
  }

  return (
    <>
      <TopBar title="Matches" back="/admin" backLabel="Dashboard" sub="Draw and scores" />
      <Page>
        <select className={inputCls} value={catId} onChange={(e) => { setCatId(e.target.value); setError(""); }} aria-label="Category">
          {cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c)}</option>)}
        </select>
        <p className="mt-3 text-sm text-soft">{entries.length} {entries.length === 1 ? "entry" : "entries"} in this category.</p>

        <div className="mt-3 space-y-3">
          {mayDraw && (
            <Btn className="w-full" onClick={make}>
              <Shuffle size={18} aria-hidden="true" /> {ms.length ? "Make next round" : "Make draw (round 1)"}
            </Btn>
          )}
          <ErrorText>{error}</ErrorText>
        </div>

        {champ && <p className="mt-4 rounded-xl bg-[#33270f] px-4 py-3 text-sm font-bold text-[#fbbf24]">Champion: {entryName(db, champ)}</p>}

        <div className="mt-5">
          {ms.length === 0 ? (
            <Empty title="No draw yet">Players are paired at random. If the number is odd, one player gets a bye into the next round.</Empty>
          ) : (
            rounds.map((r) => (
              <div key={r} className="mb-5">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">{ms.find((m) => m.round === r).roundLabel}</p>
                <div className="space-y-2">
                  {ms.filter((m) => m.round === r).map((m) => (
                    <MatchRow key={m.id} m={m} db={db} onClick={m.bye || !mayScore ? undefined : () => { setEdit({ ...m, score1: m.score1 ?? "", score2: m.score2 ?? "" }); setFormError(""); }} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {ms.length > 0 && mayDraw && (
          <Btn variant="danger" className="mt-2 w-full" onClick={clear}>
            <Trash2 size={17} aria-hidden="true" /> Clear draw
          </Btn>
        )}
      </Page>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Enter score">
        {edit && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-soft">Enter games won by each side (for example, 2 and 1 in a best-of-three).</p>
            <Field label={entryName(db, edit.p1RegId)}>
              <input className={ic} inputMode="numeric" value={edit.score1} onChange={(e) => setEdit({ ...edit, score1: e.target.value.replace(/\D/g, "") })} required />
            </Field>
            <Field label={entryName(db, edit.p2RegId)}>
              <input className={ic} inputMode="numeric" value={edit.score2} onChange={(e) => setEdit({ ...edit, score2: e.target.value.replace(/\D/g, "") })} required />
            </Field>
            <Field label="Note (optional)" hint="Table number or time, for example Table 2, 6:30 pm">
              <input className={ic} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
            <ErrorText>{formError}</ErrorText>
            <Btn type="submit" className="w-full">Save score</Btn>
          </form>
        )}
      </Sheet>
    </>
  );
}
