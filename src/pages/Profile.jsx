import { useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, ShieldCheck, LogOut } from "lucide-react";
import { useDb, me, isAdmin, isStaff, isStaffAccount, grantOf, presetName, sportName, myPlayers, ageOn, savePlayer, removePlayer, withdraw, signOut, categoryLabel, formatMoney } from "../lib/db.js";
import { TopBar, Page, Btn, Card, Chip, Empty, SectionTitle, Sheet, Field, ErrorText, inputCls } from "../components/ui.jsx";

const blank = { name: "", dob: "", gender: "", society: "", relation: "self" };

export default function Profile() {
  const db = useDb();
  const account = me(db);
  const [form, setForm] = useState(null); // null = closed
  const [error, setError] = useState("");

  if (!account) {
    return (
      <>
        <TopBar title="Profile" />
        <Page>
          <Empty
            title="Sign in to see your profile"
            action={
              <div className="flex gap-3">
                <Btn to="/login" state={{ from: "/profile" }}>Sign in</Btn>
                <Btn to="/signup" variant="soft">Create account</Btn>
              </div>
            }
          >
            Add yourself or your children, then enter Table Tennis.
          </Empty>
        </Page>
      </>
    );
  }

  if (isStaffAccount(db)) {
    const admin = isAdmin(db);
    return (
      <>
        <TopBar title="Profile" sub={admin ? "Admin" : `Organiser · ${sportName(account.sport)} · ${presetName(account.perms)}`} />
        <Page>
          <Card className="flex items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-2xl font-extrabold italic">
              {account.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">{account.name}</p>
              <p className="text-sm text-soft">@{account.username}</p>
            </div>
          </Card>
          <Btn to="/admin" className="mt-3 w-full">
            <ShieldCheck size={18} aria-hidden="true" /> {admin ? "Open admin console" : "Open tournament console"}
          </Btn>
          <Btn to="/admin/password" variant="soft" className="mt-3 w-full">Change password</Btn>
          <Btn variant="ghost" className="mt-8 w-full" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </Btn>
        </Page>
      </>
    );
  }

  const players = myPlayers(db);
  const societies = [...new Set(db.players.map((p) => p.society).filter(Boolean))];
  const myRegs = db.registrations.filter((r) => players.some((p) => p.id === r.playerId));
  const due = myRegs.filter((r) => !r.paid).reduce((s, r) => s + (db.categories.find((c) => c.id === r.categoryId)?.fee || 0), 0);

  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    const res = await savePlayer(form);
    if (!res.ok) return setError(res.error);
    setForm(null);
    setError("");
  }
  async function remove() {
    const res = await removePlayer(form.id);
    if (!res.ok) return setError(res.error);
    setForm(null);
    setError("");
  }

  return (
    <>
      <TopBar title="Profile" sub={isStaff(db) ? `Player · Organiser (${sportName(account.sport)})` : "Player account"} />
      <Page>
        <Card className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface-2 font-display text-2xl font-extrabold italic">
            {account.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{account.name}</p>
            <p className="text-sm text-soft">+91 {account.mobile}</p>
          </div>
        </Card>
        {isStaff(db) && (
          <Btn to="/admin" className="mt-3 w-full">
            <ShieldCheck size={18} aria-hidden="true" /> Open tournament console · {presetName(account.perms)}
          </Btn>
        )}


        {due > 0 && (
          <div className="mt-3 rounded-2xl bg-[#33270f] px-4 py-3 text-sm text-[#fbbf24]">
            <b>{formatMoney(due)}</b> in entry fees is unpaid. Pay the organiser directly and they will mark it paid.
          </div>
        )}

        <SectionTitle
          right={
            <button
              onClick={() => { setForm({ ...blank, relation: players.length ? "child" : "self" }); setError(""); }}
              className="inline-flex items-center gap-1 text-sm font-bold text-white"
            >
              <Plus size={16} aria-hidden="true" /> Add player
            </button>
          }
        >
          Players
        </SectionTitle>

        {players.length === 0 ? (
          <Empty title="No players yet">Add yourself or your child to enter events.</Empty>
        ) : (
          <ul className="space-y-3">
            {players.map((p) => {
              const regs = db.registrations.filter((r) => r.playerId === p.id);
              return (
                <li key={p.id}>
                  <Card>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{p.name}</p>
                        <p className="mt-0.5 text-[13px] text-soft">
                          {p.relation === "child" ? "Child" : "Me"} · {p.gender === "M" ? "Male" : "Female"} · Age {ageOn(p.dob, db.settings.ageCutoff)}
                          {p.society ? ` · ${p.society}` : ""}
                        </p>
                      </div>
                      <button
                        aria-label={`Edit ${p.name}`}
                        onClick={() => { setForm({ ...p }); setError(""); }}
                        className="grid h-9 w-9 place-items-center rounded-full bg-surface-2"
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </div>
                    {regs.length > 0 && (
                      <ul className="mt-3 space-y-2 border-t border-hair pt-3">
                        {regs.map((r) => {
                          const c = db.categories.find((x) => x.id === r.categoryId);
                          return (
                            <li key={r.id} className="flex items-center gap-2 text-sm">
                              <span className="min-w-0 flex-1 truncate">
                                {c ? categoryLabel(c) : "Category"}
                                {r.partnerName ? ` with ${r.partnerName}` : ""}
                              </span>
                              <Chip tone={r.paid ? "good" : "warn"}>{r.paid ? "Paid" : `Due ${formatMoney(c?.fee)}`}</Chip>
                              <button
                                onClick={async () => { const res = await withdraw(r.id); if (!res.ok) alert(res.error); }}
                                className="text-xs font-bold text-muted underline"
                              >
                                Withdraw
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <Btn to="/sport/table-tennis/register" variant="soft" className="mt-3 h-10 w-full text-sm" state={{ playerId: p.id }}>
                      Enter Table Tennis
                    </Btn>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <Btn variant="ghost" className="mt-8 w-full" onClick={signOut}>
          <LogOut size={18} aria-hidden="true" /> Sign out
        </Btn>
      </Page>

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit player" : "Add player"}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Who is this?">
              <select className={inputCls} value={form.relation} onChange={change("relation")}>
                <option value="self">Me</option>
                <option value="child">My child</option>
              </select>
            </Field>
            <Field label="Full name">
              <input className={inputCls} value={form.name} onChange={change("name")} required />
            </Field>
            <Field label="Date of birth">
              <input className={inputCls} type="date" value={form.dob} max={new Date().toISOString().slice(0, 10)} onChange={change("dob")} required />
            </Field>
            <Field label="Gender">
              <select className={inputCls} value={form.gender} onChange={change("gender")} required>
                <option value="">Choose</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field label="Society">
              <input className={inputCls} list="societies" value={form.society} onChange={change("society")} placeholder="Name of your society" />
              <datalist id="societies">{societies.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save player</Btn>
            {form.id && (
              <Btn variant="danger" className="w-full" onClick={remove}>Remove player</Btn>
            )}
          </form>
        )}
      </Sheet>
    </>
  );
}
