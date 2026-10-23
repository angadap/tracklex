import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Check } from "lucide-react";
import { useDb, me, isStaffAccount, myPlayers, tournamentsOf, activeTournament, categoriesIn, isEligible, categoryLabel, formatMoney, register, ageOn, dateText } from "../lib/db.js";
import { TopBar, Page, Btn, Card, Empty, Chip, ErrorText, inputCls } from "../components/ui.jsx";

export default function Register() {
  const db = useDb();
  const loc = useLocation();
  const account = me(db);
  const players = myPlayers(db);
  const [params, setParams] = useSearchParams();
  const [chosenId, setPlayerId] = useState(loc.state?.playerId || "");
  const [picked, setPicked] = useState({}); // categoryId -> partnerName
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  const back = params.get("t") ? `/sport/table-tennis/t/${params.get("t")}` : "/sport/table-tennis";
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

  // The first player added is selected unless the person picks another.
  const playerId = players.some((p) => p.id === chosenId) ? chosenId : players[0]?.id || "";
  const player = players.find((p) => p.id === playerId);
  const tournaments = tournamentsOf(db, "table-tennis");
  const tour = tournaments.find((t) => t.id === params.get("t")) || activeTournament(db, "table-tennis");
  const all = tour ? categoriesIn(db, tour.id) : [];
  const eligible = player && tour ? all.filter((c) => isEligible(player, c)) : [];
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
            <p className="mt-3 text-lg font-bold">{done.name} is entered in {done.count} {done.count === 1 ? "category" : "categories"}</p>
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

  const Step = ({ n, title, note }) => (
    <div className="mb-3 mt-7 flex items-start gap-3 first:mt-0">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-sm font-extrabold text-void">{n}</span>
      <div>
        <p className="font-bold leading-7">{title}</p>
        {note && <p className="text-[13px] text-soft">{note}</p>}
      </div>
    </div>
  );

  return (
    <>
      <TopBar title="Register" back={back} backLabel="Table Tennis" sub="Three quick steps" />
      <Page>
        <Step n={1} title="Choose the tournament" note={tournaments.length > 1 ? "Tap the tournament you want to play in." : undefined} />
        {tournaments.length === 0 ? (
          <Empty title="No tournaments yet">The organiser has not set up a tournament. Check back soon.</Empty>
        ) : (
          <ul className="space-y-2.5">
            {tournaments.map((t) => {
              const on = tour?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => { setParams({ t: t.id }, { replace: true }); setPicked({}); setError(""); }}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-2xl p-4 text-left ${on ? "bg-white text-void" : "bg-surface"}`}
                  >
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${on ? "bg-void text-white" : "bg-surface-2"}`}>
                      {on && <Check size={14} aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{t.name}</span>
                      <span className={`text-[13px] ${on ? "text-void/70" : "text-soft"}`}>
                        {t.startsOn ? `${dateText(t.startsOn)}${t.endsOn ? ` to ${dateText(t.endsOn)}` : ""}` : `Season ${t.season}`}
                      </span>
                    </span>
                    <Chip tone={t.regOpen ? "good" : "neutral"}>{t.regOpen ? "Entries open" : "Closed"}</Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Step n={2} title="Who is playing?" note={players.length > 1 ? "Tap a player. You can enter each player separately." : undefined} />
        <div className="flex flex-wrap gap-2">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPlayerId(p.id); setPicked({}); setError(""); }}
              aria-pressed={playerId === p.id}
              className={`h-11 rounded-full px-5 text-sm font-bold ${playerId === p.id ? "bg-white text-void" : "bg-surface text-soft"}`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {player && tour && (
          <>
            <Step n={3} title="Choose the categories" note={`Showing the categories in ${tour.name} that fit ${player.name} (age ${ageOn(player.dob)}). Tap to select, you can pick more than one.`} />
            {all.length === 0 ? (
              <Empty title="No categories yet">The organiser has not added categories to this tournament.</Empty>
            ) : !tour.regOpen ? (
              <Empty title="Entries are closed">{tour.name} is not taking entries right now.</Empty>
            ) : eligible.length === 0 ? (
              <Empty title="No matching categories">None of this tournament's categories fit {player.name}'s age and gender.</Empty>
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
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${on ? "bg-void text-white" : "bg-surface-2"}`}>
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
                  ? `Enter ${Object.keys(picked).length} ${Object.keys(picked).length === 1 ? "category" : "categories"} · ${formatMoney(total)}`
                  : "Choose at least one category"}
              </Btn>
              <p className="text-center text-xs text-muted">Fees are paid to the organiser directly. Nothing is charged in the app.</p>
            </div>
          </>
        )}
      </Page>
    </>
  );
}
