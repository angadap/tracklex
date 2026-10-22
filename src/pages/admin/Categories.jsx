import { useState } from "react";
import { Plus } from "lucide-react";
import { useDb, tableTennisCategories, categoryLabel, formatMoney, entryCount, saveCategory, deleteCategory, addStarterCategories } from "../../lib/db.js";
import { TopBar, Page, Btn, Card, Chip, Empty, Sheet, Field, ErrorText, inputCls } from "../../components/ui.jsx";

const blank = { name: "", gender: "M", format: "singles", minAge: "", maxAge: "", fee: "" };

export default function Categories() {
  const db = useDb();
  const cats = tableTennisCategories(db);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const open = (c) => { setForm(c ? { ...c } : { ...blank }); setError(""); };
  async function save(e) {
    e.preventDefault();
    const res = await saveCategory(form);
    if (!res.ok) return setError(res.error);
    setForm(null);
  }
  async function remove() {
    const res = await deleteCategory(form.id);
    if (!res.ok) return setError(res.error);
    setForm(null);
  }

  return (
    <>
      <TopBar title="Categories" back="/admin" backLabel="Dashboard" sub={`Table Tennis ${db.settings.season}`} />
      <Page>
        <Btn className="w-full" onClick={() => open(null)}>
          <Plus size={18} aria-hidden="true" /> Add category
        </Btn>

        <div className="mt-5">
          {cats.length === 0 ? (
            <Empty
              title="No categories yet"
              action={<Btn variant="soft" onClick={async () => { const res = await addStarterCategories(); if (!res.ok) alert(res.error); }}>Add starter set</Btn>}
            >
              The starter set adds Under 10, 10–17, 18–45, 46–60 and Above 60 for men and women. You can edit or delete each one.
            </Empty>
          ) : (
            <ul className="space-y-2.5">
              {cats.map((c) => {
                const n = entryCount(db, c.id);
                return (
                  <li key={c.id}>
                    <button onClick={() => open(c)} className="w-full text-left">
                      <Card className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{categoryLabel(c)}</p>
                          <p className="mt-0.5 text-[13px] text-soft">Ages {c.minAge}–{c.maxAge} · {n} {n === 1 ? "entry" : "entries"}</p>
                        </div>
                        <Chip>{formatMoney(c.fee)}</Chip>
                      </Card>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="mt-4 text-xs text-muted">Ages are inclusive and counted on {new Date(db.settings.ageCutoff).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Tap a category to edit it.</p>
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
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save category</Btn>
            {form.id && <Btn variant="danger" className="w-full" onClick={remove}>Delete category</Btn>}
          </form>
        )}
      </Sheet>
    </>
  );
}
