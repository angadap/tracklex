import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { useDb, me, isStaffAccount, myPlayers, tableTennisCategories, isEligible, categoryLabel, formatMoney, register, ageOn } from "../lib/db.js";
import { TopBar, Page, Btn, Card, Empty, Chip, ErrorText, inputCls } from "../components/ui.jsx";

export default function Register() {
  const db = useDb();
  const loc = useLocation();
  const account = me(db);
  const players = myPlayers(db);
  const [playerId, setPlayerId] = useState(loc.state?.playerId || "");
  const [picked, setPicked] = useState({}); // categoryId -> partnerName
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  const back = "/sport/table-tennis";
  if (!account) {
    return (
      <>
        <TopBar title="Register" back={back} backLabel="Table Tennis" />
        <Page>
          <Empty
            title="Sign in to register"
            action={<div className="flex gap-3"><Btn to="/login" state={{ from: "/sport/table-tennis/register" }}>Sign in</Btn><Btn to="/signup" variant="soft" state={{ from: "/sport/table-tennis/register" }}>Create account</Btn></div>}
          >
            Your mobile number and PIN keep your entries together.
          </Empty>
        </Page>
      </>
    );
  }
  if (isStaffAccount(db)) {
    return (
      <>
        <TopBar title="Register" back={back} backLabel="Table Tennis" />
        <Page>
          <Empty title="You are signed in as staff" action={<Btn to="/admin/players">Open players and payments</Btn>}>
            Players register from their own accounts. You can see and manage their entries in the console.
          </Empty>
        </Page>
      </>
    );
  }
  if (players.length === 0) {
    return (
      <>
        <TopBar title="Register" back={back} backLabel="Table Tennis" />
        <Page>
          <Empty title="Add a player first" action={<Btn to="/profile">Go to profile</Btn>}>
            Add yourself or your child on your profile, then come back to enter events.
          </Empty>
        </Page>
      </>
    );
  }

  const player = players.find((p) => p.id === playerId);
  const all = tableTennisCategories(db);
  const eligible = player ? all.filter((c) => isEligible(player, c, db.settings.ageCutoff)) : [];
  const entered = new Set(db.registrations.filter((r) => r.playerId === playerId).map((r) => r.categoryId));
  const locked = (c) => db.matches.some((m) => m.categoryId === c.id);
  const total = Object.keys(picked).reduce((s, id) => s + (all.find((c) => c.id === id)?.fee || 0), 0);

  function toggle(c) {
    const next = { ...picked };
    if (c.id in next) delete next[c.id];
    else next[c.id] = "";
    setPicked(next);
  }

  async function submit() {
    setError("");
    setBusy(true);
    const ids = Object.keys(picked);
    for (const id of ids) {
      const res = await register({ playerId, categoryId: id, partnerName: picked[id] });
      if (!res.ok) {
        setBusy(false);
        return setError(res.error);
      }
    }
    setBusy(false);
    setDone({ count: ids.length, total, name: player.name });
    setPicked({});
  }

  if (done) {
    return (
      <>
        <TopBar title="You're in" back={back} backLabel="Table Tennis" />
        <Page>
          <Card className="text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#12301f] text-live"><Check size={28} aria-hidden="true" /></span>
            <p className="mt-3 text-lg font-bold">{done.name} is entered in {done.count} {done.count === 1 ? "event" : "events"}</p>
            <p className="mt-1 text-sm text-soft">
              {done.total > 0 ? `Pay ${formatMoney(done.total)} to the organiser. They will mark it paid in the app.` : "There is nothing to pay for these events."}
            </p>
          </Card>
          <div className="mt-4 flex gap-3">
            <Btn to="/profile" className="flex-1">View my entries</Btn>
            <Btn variant="soft" onClick={() => setDone(null)}>Enter more</Btn>
          </div>
        </Page>
      </>
    );
  }

  return (
    <>
      <TopBar title="Register" back={back} backLabel="Table Tennis" sub={`Table Tennis ${db.settings.season}`} />
      <Page>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted">Who is playing?</p>
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPlayerId(p.id); setPicked({}); setError(""); }}
              className={`h-11 rounded-full px-5 text-sm font-bold ${playerId === p.id ? "bg-white text-void" : "bg-surface text-soft"}`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {player && (
          <>
            <p className="mb-2 mt-6 text-xs font-bold uppercase tracking-[0.14em] text-muted">
              Events for {player.name} · age {ageOn(player.dob, db.settings.ageCutoff)}
            </p>
            {all.length === 0 ? (
              <Empty title="No categories yet">The organiser has not set up Table Tennis categories.</Empty>
            ) : eligible.length === 0 ? (
              <Empty title="No matching events">None of the categories fit this player's age and gender.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {eligible.map((c) => {
                  const already = entered.has(c.id);
                  const closed = !already && locked(c);
                  const on = c.id in picked;
                  return (
                    <li key={c.id}>
                      <button
                        disabled={already || closed}
                        onClick={() => toggle(c)}
                        aria-pressed={on}
                        className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left ${on ? "bg-white text-void" : "bg-surface"} disabled:opacity-50`}
                      >
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${on ? "bg-void text-white" : "bg-surface-2"}`}>
                          {(on || already) && <Check size={14} aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{categoryLabel(c)}</span>
                          <span className={`text-[13px] ${on ? "text-void/70" : "text-soft"}`}>Ages {c.minAge}–{c.maxAge}</span>
                        </span>
                        {already ? <Chip tone="good">Entered</Chip> : closed ? <Chip>Closed</Chip> : <Chip>{formatMoney(c.fee)}</Chip>}
                      </button>
                      {on && c.format === "doubles" && (
                        <input
                          className={`${inputCls} mt-2`}
                          placeholder="Doubles partner's full name"
                          value={picked[c.id]}
                          onChange={(e) => setPicked({ ...picked, [c.id]: e.target.value })}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-5 space-y-3">
              <ErrorText>{error}</ErrorText>
              <Btn className="w-full" disabled={busy || !Object.keys(picked).length} onClick={submit}>
                {Object.keys(picked).length
                  ? `Enter ${Object.keys(picked).length} ${Object.keys(picked).length === 1 ? "event" : "events"} · ${formatMoney(total)}`
                  : "Choose at least one event"}
              </Btn>
              <p className="text-center text-xs text-muted">Fees are paid to the organiser directly. Nothing is charged in the app.</p>
            </div>
          </>
        )}
      </Page>
    </>
  );
}
