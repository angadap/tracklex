import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { useDb, saveOrganiser, grantOrganiser, deleteOrganiser, sportName, PERMS, PRESETS, presetName } from "../../lib/db.js";
import { SPORTS } from "../../data/sports.js";
import { TopBar, Page, Card, Chip, Empty, Btn, Sheet, Field, ErrorText, inputCls } from "../../components/ui.jsx";

const ready = SPORTS.filter((s) => s.ready);
const FULL = PRESETS[0].perms;

// Preset buttons for the usual levels, then ticks to fine-tune.
function PermPicker({ value, onChange }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">What can they do?</legend>
      <div className="mb-3 flex flex-wrap gap-2">
        {PRESETS.map((p) => {
          const on = presetName(value) === p.name;
          return (
            <button
              key={p.name}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.perms)}
              className={`rounded-full px-3.5 py-2 text-[13px] font-bold ${on ? "bg-white text-void" : "bg-surface-2 text-soft"}`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
      <ul className="space-y-1.5">
        {PERMS.map((p) => (
          <li key={p.key}>
            <label className="flex items-start gap-3 rounded-xl bg-surface-2 px-3.5 py-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-white" checked={value.includes(p.key)} onChange={() => toggle(p.key)} />
              <span>
                <span className="block text-sm font-bold">{p.label}</span>
                <span className="block text-[13px] text-soft">{p.note}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export default function Organisers() {
  const db = useDb();
  // form.kind: "staff" (own username + password) or "player" (an existing player account gets organiser access)
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const list = db.accounts.filter((a) => a.role === "organiser" || (a.role === "player" && a.perms?.length));
  const candidates = db.accounts.filter((a) => a.role === "player" && !a.perms?.length);
  const change = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const open = (f) => { setForm(f); setError(""); };

  async function save(e) {
    e.preventDefault();
    const res =
      form.kind === "player"
        ? await grantOrganiser({ accountId: form.accountId, sport: form.sport, perms: form.perms })
        : await saveOrganiser(form);
    if (!res.ok) return setError(res.error);
    setForm(null);
    setError("");
  }
  async function remove() {
    const msg =
      form.kind === "player"
        ? `Remove organiser access from ${form.name}? They stay a player and keep their entries.`
        : `Remove ${form.name}? They will no longer be able to sign in.`;
    if (!confirm(msg)) return;
    const res = await deleteOrganiser(form.id || form.accountId);
    if (!res.ok) return setError(res.error);
    setForm(null);
  }

  return (
    <>
      <TopBar title="Organisers" back="/admin" backLabel="Dashboard" sub="Who runs what" />
      <Page>
        <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-soft">
          Give someone a sport and choose what they can do there: full organiser, registration desk (entries and payments), scorer, or your own mix.
          Organisers never change player profiles, PINs or season settings. A player can be made an organiser and keeps signing in with their mobile and PIN.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Btn onClick={() => open({ kind: "player", accountId: "", name: "", sport: ready[0]?.slug || "", perms: FULL })} disabled={candidates.length === 0}>
            <UserPlus size={18} aria-hidden="true" /> From a player
          </Btn>
          <Btn variant="soft" onClick={() => open({ kind: "staff", name: "", username: "", password: "", sport: ready[0]?.slug || "", perms: FULL })}>
            <Plus size={18} aria-hidden="true" /> New account
          </Btn>
        </div>
        <div className="mt-4">
          {list.length === 0 ? (
            <Empty title="No organisers yet">Pick a player who signed up, or create an organiser account with a username and password.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {list.map((a) => (
                <li key={a.id}>
                  <Card className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{a.name}</p>
                      <p className="mt-0.5 text-[13px] text-soft">{a.role === "player" ? `Player · +91 ${a.mobile}` : `@${a.username}`}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip>{sportName(a.sport)}</Chip>
                        <Chip tone="good">{presetName(a.perms)}</Chip>
                      </div>
                    </div>
                    <Btn
                      variant="soft"
                      className="h-10 px-4 text-sm"
                      onClick={() =>
                        open(
                          a.role === "player"
                            ? { kind: "player", id: a.id, accountId: a.id, name: a.name, sport: a.sport, perms: a.perms }
                            : { kind: "staff", id: a.id, name: a.name, username: a.username, password: "", sport: a.sport, perms: a.perms }
                        )
                      }
                    >
                      Edit
                    </Btn>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Page>

      <Sheet open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit organiser" : form?.kind === "player" ? "Make a player an organiser" : "New organiser account"}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            {form.kind === "player" ? (
              form.id ? (
                <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm"><b>{form.name}</b> signs in with their mobile number and PIN.</p>
              ) : (
                <Field label="Player account">
                  <select className={inputCls} value={form.accountId} onChange={change("accountId")} required>
                    <option value="">Choose a player…</option>
                    {candidates.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.mobile}</option>)}
                  </select>
                </Field>
              )
            ) : (
              <>
                <Field label="Full name"><input className={inputCls} value={form.name} onChange={change("name")} required /></Field>
                <Field label="Username" hint="3 to 20 letters, numbers, dot, dash or underscore. Cannot be changed later.">
                  <input className={inputCls} value={form.username} onChange={change("username")} readOnly={!!form.id} autoCapitalize="none" required />
                </Field>
                <Field label={form.id ? "New password" : "Password"} hint={form.id ? "Leave blank to keep the current password." : "At least 8 characters."}>
                  <input className={inputCls} type="password" autoComplete="new-password" value={form.password} onChange={change("password")} required={!form.id} />
                </Field>
              </>
            )}
            <Field label="Sport">
              <select className={inputCls} value={form.sport} onChange={change("sport")} required>
                {ready.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            </Field>
            <PermPicker value={form.perms} onChange={(perms) => setForm({ ...form, perms })} />
            <ErrorText>{error}</ErrorText>
            <Btn type="submit" className="w-full">Save organiser</Btn>
            {form.id && <Btn variant="danger" className="w-full" onClick={remove}>{form.kind === "player" ? "Remove organiser access" : "Remove organiser"}</Btn>}
          </form>
        )}
      </Sheet>
    </>
  );
}
