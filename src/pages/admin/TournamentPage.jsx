import { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { Plus, ChevronRight, Pencil } from "lucide-react";
import {
  useDb, can, tournamentById, categoriesIn, stagesOf, categoryLabel, formatMoney, entryCount, dateText,
  saveCategory, deleteCategory, addStarterCategories, deleteTournament, stageMatches,
} from "../../lib/db.js";
import { TopBar, Page, Btn, Card, Chip, Empty, Sheet, Field, ErrorText, SectionTitle, inputCls } from "../../components/ui.jsx";
import { TournamentForm } from "./Tournaments.jsx";

const blank = { name: "", gender: "M", format: "singles", minAge: "", maxAge: "", fee: "" };

export default function TournamentPage() {
  const { tid } = useParams();
  const db = useDb();
  const t = tournamentById(db, tid);
  const [form, setForm] = useState(null); // category form
  const [tform, setTform] = useState(null); // tournament form
  const [error, setError] = useState("");
  if (!t) return <Navigate to="/admin/tournaments" replace />;
  const mayEdit = can(db, t.sport, "categories");
  const cats = categoriesIn(db, t.id);
  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    const res = await saveCategory({ ...form, tournamentId: t.id });
    if (!res.ok) return setError(res.error);
    setForm(null);
    setError("");
  }
  async function remove() {
    const res = await deleteCategory(form.id);
    if (!res.ok) return setError(res.error);
    setForm(null);
  }
  async function removeTournament() {
    if (!confirm(`Delete ${t.name} with all its categories and matches? This cannot be undone.`)) return;
    const res = await deleteTournament(t.id);
    if (!res.ok) return alert(res.error);
    setTform(null);
  }

  return (
    <>
      <TopBar title={t.name} back="/admin/tournaments" backLabel="Tournaments" sub={`Season ${t.season} · ages counted on today's date`} />
      <Page>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={t.regOpen ? "good" : "neutral"}>{t.regOpen ? "Entries open" : "Entries closed"}</Chip>
          {t.startsOn && <Chip>{dateText(t.startsOn)}{t.endsOn ? ` to ${dateText(t.endsOn)}` : ""}</Chip>}
          {mayEdit && (
            <button onClick={() => setTform({ ...t, startsOn: t.startsOn || "", endsOn: t.endsOn || "" })} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-bold">
              <Pencil size={14} aria-hidden="true" /> Edit
            </button>
          )}
        </div>

        <SectionTitle>Categories</SectionTitle>
        <p className="-mt-2 mb-3 text-sm text-soft">Players are divided into categories by age and gender. Open a category to set up its rounds and matches.</p>
        {mayEdit && (
          <Btn className="mb-4 w-full" onClick={() => { setForm({ ...blank }); setError(""); }}>
            <Plus size={18} aria-hidden="true" /> Add category
          </Btn>
        )}
        {cats.length === 0 ? (
          <Empty
            title="No categories yet"
            action={mayEdit ? <Btn variant="soft" onClick={async () => { const res = await addStarterCategories(t.id); if (!res.ok) alert(res.error); }}>Add starter set</Btn> : null}
          >
            The starter set adds Under 10, 10–17, 18–45, 46–60 and Above 60 for men and women. You can edit or delete each one.
          </Empty>
        ) : (
          <ul className="space-y-2.5">
            {cats.map((c) => {
              const n = entryCount(db, c.id);
              const stages = stagesOf(db, c.id);
              const made = stages.filter((s) => stageMatches(db, s.id).length > 0).length;
              return (
                <li key={c.id} className="flex items-stretch gap-2">
                  <Link to={`/admin/categories/${c.id}`} className="min-w-0 flex-1">
                    <Card className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{categoryLabel(c)}</p>
                        <p className="mt-0.5 text-[13px] text-soft">
                          Ages {c.minAge}–{c.maxAge} · {n} {n === 1 ? "entry" : "entries"} · {stages.length} {stages.length === 1 ? "stage" : "stages"}
                          {made ? ` · ${made} made` : ""}
                        </p>
                      </div>
                      <Chip>{formatMoney(c.fee)}</Chip>
                      <ChevronRight size={20} className="text-muted" aria-hidden="true" />
                    </Card>
                  </Link>
                  {mayEdit && (
                    <button onClick={() => { setForm({ ...c }); setError(""); }} aria-label={`Edit ${c.name}`} className="grid w-12 shrink-0 place-items-center rounded-2xl bg-surface text-soft">
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Page>

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit category" : "Add category"}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={change("name")} placeholder="For example, Under 18" required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Gender">
                <select className={inputCls} value={form.gender} onChange={change("gender")}>
                  <option value="M">Men</option><option value="F">Women</option><option value="X">Mixed</option>
                </select>
              </Field>
              <Field label="Format">
                <select className={inputCls} value={form.format} onChange={change("format")}>
                  <option value="singles">Singles</option><option value="doubles">Doubles</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum age"><input className={inputCls} inputMode="numeric" value={form.minAge} onChange={change("minAge")} required /></Field>
              <Field label="Maximum age"><input className={inputCls} inputMode="numeric" value={form.maxAge} onChange={change("maxAge")} required /></Field>
            </div>
            <Field label="Entry fee (₹)" hint="Leave empty or enter 0 for a free event."><input className={inputCls} inputMode="numeric" value={form.fee} onChange={change("fee")} /></Field>
            {!form.id && <p className="text-[13px] text-soft">A new category starts with one knockout stage. Change it, or add more stages, inside the category.</p>}
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save category</Btn>
            {form.id && <Btn variant="danger" className="w-full" onClick={remove}>Delete category</Btn>}
          </form>
        )}
      </Sheet>

      <Sheet open={!!tform} onClose={() => setTform(null)} title="Edit tournament">
        {tform && (
          <>
            <TournamentForm db={db} form={tform} setForm={setTform} sport={t.sport} onDone={() => setTform(null)} />
            <Btn variant="danger" className="mt-3 w-full" onClick={removeTournament}>Delete tournament</Btn>
          </>
        )}
      </Sheet>
    </>
  );
}
