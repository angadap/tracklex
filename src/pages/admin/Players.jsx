import { useState } from "react";
import { useDb, isAdmin, adminSavePlayer, adminRemovePlayer, tableTennisCategories, categoryLabel, formatMoney, setPaid, withdraw, resetPin, ageOn } from "../../lib/db.js";
import { TopBar, Page, Segmented, Card, Chip, Empty, Btn, Sheet, Field, ErrorText, inputCls } from "../../components/ui.jsx";

export default function Players() {
  const db = useDb();
  const admin = isAdmin(db);
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState("entries");
  const [catId, setCatId] = useState("all");
  const [q, setQ] = useState("");
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const cats = tableTennisCategories(db);
  const rows = db.registrations
    .filter((r) => cats.some((c) => c.id === r.categoryId))
    .filter((r) => catId === "all" || r.categoryId === catId)
    .map((r) => ({ r, p: db.players.find((p) => p.id === r.playerId), c: cats.find((c) => c.id === r.categoryId) }))
    .filter(({ p }) => p && (p.name + " " + p.society).toLowerCase().includes(q.toLowerCase()));

  const people = db.accounts
    .filter((a) => a.role === "player")
    .filter((a) => (a.name + " " + a.mobile).toLowerCase().includes(q.toLowerCase()));

  async function savePin(e) {
    e.preventDefault();
    const res = await resetPin(pinFor.id, pin);
    if (!res.ok) return setError(res.error);
    setPinFor(null);
    setPin("");
  }

  return (
    <>
      <TopBar title="Players" back="/admin" backLabel="Dashboard" sub="Entries and payments" />
      <Page>
        {admin ? (
          <Segmented value={tab} onChange={setTab} options={[{ value: "entries", label: "Entries" }, { value: "people", label: "Accounts" }]} />
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-soft">You can mark payments and withdraw entries. Player profiles and PINs can only be changed by the admin.</p>
        )}
        <div className="mt-3 space-y-3">
          <input className={inputCls} placeholder={tab === "entries" ? "Search player or society" : "Search name or mobile"} value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === "entries" && (
            <select className={inputCls} value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c)}</option>)}
            </select>
          )}
        </div>

        <div className="mt-4">
          {tab === "entries" ? (
            rows.length === 0 ? (
              <Empty title="No entries to show">Entries appear here as players register.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {rows.map(({ r, p, c }) => (
                  <li key={r.id}>
                    <Card>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold">{p.name}{r.partnerName ? ` & ${r.partnerName}` : ""}</p>
                          <p className="mt-0.5 text-[13px] text-soft">{categoryLabel(c)} · age {ageOn(p.dob, db.settings.ageCutoff)}{p.society ? ` · ${p.society}` : ""}</p>
                        </div>
                        <Chip tone={r.paid ? "good" : "warn"}>{r.paid ? "Paid" : "Unpaid"}</Chip>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="flex-1 text-sm font-bold">{formatMoney(c.fee)}</span>
                        <button onClick={async () => { const res = await withdraw(r.id); if (!res.ok) alert(res.error); }} className="px-2 text-xs font-bold text-muted underline">Withdraw</button>
                        <Btn variant={r.paid ? "soft" : "primary"} className="h-10 px-4 text-sm" onClick={async () => { const res = await setPaid(r.id, !r.paid); if (!res.ok) alert(res.error); }}>
                          {r.paid ? "Mark unpaid" : "Mark paid"}
                        </Btn>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )
          ) : people.length === 0 ? (
            <Empty title="No player accounts yet">Accounts appear here when people sign up.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {people.map((a) => {
                const ps = db.players.filter((p) => p.accountId === a.id);
                return (
                  <li key={a.id}>
                    <Card className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{a.name}</p>
                        <p className="mt-0.5 text-[13px] text-soft">+91 {a.mobile} · {ps.length} {ps.length === 1 ? "player" : "players"}</p>
                        {ps.map((p) => (
                          <button key={p.id} onClick={() => { setEdit({ ...p }); setError(""); }} className="mr-2 mt-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-bold">
                            Edit {p.name}
                          </button>
                        ))}
                      </div>
                      <Btn variant="soft" className="h-10 px-4 text-sm" onClick={() => { setPinFor(a); setPin(""); setError(""); }}>Reset PIN</Btn>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Page>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Edit player">
        {edit && (
          <form
            onSubmit={async (e) => { e.preventDefault(); const res = await adminSavePlayer(edit.id, edit); if (!res.ok) return setError(res.error); setEdit(null); setError(""); }}
            className="space-y-4"
          >
            <Field label="Full name"><input className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></Field>
            <Field label="Date of birth"><input className={inputCls} type="date" value={edit.dob} onChange={(e) => setEdit({ ...edit, dob: e.target.value })} required /></Field>
            <Field label="Gender">
              <select className={inputCls} value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })} required>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field label="Society"><input className={inputCls} value={edit.society || ""} onChange={(e) => setEdit({ ...edit, society: e.target.value })} /></Field>
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save player</Btn>
            <Btn variant="danger" className="w-full" onClick={async () => { const res = await adminRemovePlayer(edit.id); if (!res.ok) return setError(res.error); setEdit(null); setError(""); }}>Remove player</Btn>
          </form>
        )}
      </Sheet>

      <Sheet open={!!pinFor} onClose={() => setPinFor(null)} title="Reset PIN">
        {pinFor && (
          <form onSubmit={savePin} className="space-y-4">
            <p className="text-sm text-soft">Set a new PIN for <b className="text-white">{pinFor.name}</b>. Tell them the new PIN in person or by phone.</p>
            <Field label="New PIN" hint="4 to 6 digits">
              <input className={inputCls} inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save new PIN</Btn>
          </form>
        )}
      </Sheet>
    </>
  );
}
