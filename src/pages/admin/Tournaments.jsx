import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ChevronRight } from "lucide-react";
import { useDb, isAdmin, can, grantOf, tournamentsOf, sportName, saveTournament, dateText } from "../../lib/db.js";
import { SPORTS } from "../../data/sports.js";
import { TopBar, Page, Card, Chip, Empty, Btn, Sheet, Field, ErrorText, inputCls } from "../../components/ui.jsx";

const ready = SPORTS.filter((s) => s.ready);

export function TournamentForm({ db, form, setForm, onDone, sport }) {
  const [error, setError] = useState("");
  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const res = await saveTournament({ ...form, sport: form.sport || sport });
    if (!res.ok) return setError(res.error);
    setError("");
    onDone(res.id);
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Tournament name"><input className={inputCls} value={form.name} onChange={change("name")} placeholder="For example, Warje Olympics 2026" required /></Field>
      <Field label="Season year" hint="Ages are counted on today's date."><input className={inputCls} inputMode="numeric" value={form.season} onChange={change("season")} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts"><input className={inputCls} type="date" value={form.startsOn || ""} onChange={change("startsOn")} /></Field>
        <Field label="Ends"><input className={inputCls} type="date" value={form.endsOn || ""} onChange={change("endsOn")} /></Field>
      </div>
      <label className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
        <input type="checkbox" className="h-4 w-4 accent-white" checked={form.regOpen !== false} onChange={(e) => setForm({ ...form, regOpen: e.target.checked })} />
        <span>
          <span className="block text-sm font-bold">Entries are open</span>
          <span className="block text-[13px] text-soft">Players can enter categories while this is on.</span>
        </span>
      </label>
      <ErrorText>{error}</ErrorText>
      <Btn type="submit" className="w-full">Save tournament</Btn>
    </form>
  );
}

export const blankTournament = (db, sport) => ({
  name: "", season: String(new Date().getFullYear()), ageCutoff: `${new Date().getFullYear()}-10-01`, startsOn: "", endsOn: "", regOpen: true, sport,
});

export default function Tournaments() {
  const db = useDb();
  const admin = isAdmin(db);
  const sports = admin ? ready.map((s) => s.slug) : [grantOf(db)?.sport].filter(Boolean);
  const list = sports.flatMap((sp) => tournamentsOf(db, sp));
  const [form, setForm] = useState(null);
  const mayCreate = (sp) => can(db, sp, "categories");
  const createSport = sports.find(mayCreate);

  return (
    <>
      <TopBar title="Tournaments" back="/admin" backLabel="Dashboard" sub="Categories, rounds and matches live inside each one" />
      <Page>
        {createSport && (
          <Btn className="w-full" onClick={() => setForm(blankTournament(db, createSport))}>
            <Plus size={18} aria-hidden="true" /> New tournament
          </Btn>
        )}
        <div className="mt-4">
          {list.length === 0 ? (
            <Empty title="No tournament yet">
              {createSport ? "Create the first one. Then add its age categories, set up the rounds and make the match slots." : "Ask the admin to create the tournament."}
            </Empty>
          ) : (
            <ul className="space-y-2.5">
              {list.map((t) => {
                const cats = db.categories.filter((c) => c.tournamentId === t.id);
                const entries = db.registrations.filter((r) => cats.some((c) => c.id === r.categoryId)).length;
                return (
                  <li key={t.id}>
                    <Link to={`/admin/tournaments/${t.id}`}>
                      <Card className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{t.name}</p>
                          <p className="mt-0.5 text-[13px] text-soft">
                            {sportName(t.sport)} · {cats.length} {cats.length === 1 ? "category" : "categories"}
                            {can(db, t.sport, "entries") ? ` · ${entries} entries` : ""}
                            {t.startsOn ? ` · ${dateText(t.startsOn)}` : ""}
                          </p>
                        </div>
                        <Chip tone={t.regOpen ? "good" : "neutral"}>{t.regOpen ? "Entries open" : "Entries closed"}</Chip>
                        <ChevronRight size={20} className="text-muted" aria-hidden="true" />
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Page>
      <Sheet open={!!form} onClose={() => setForm(null)} title="New tournament">
        {form && (
          <>
            {admin && ready.length > 1 && (
              <div className="mb-4">
                <Field label="Sport">
                  <select className={inputCls} value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })}>
                    {ready.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <TournamentForm db={db} form={form} setForm={setForm} sport={form.sport} onDone={() => setForm(null)} />
          </>
        )}
      </Sheet>
    </>
  );
}
