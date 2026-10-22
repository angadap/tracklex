import { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import { getSport } from "../data/sports.js";
import { SPORT_ICONS } from "../components/SportIcons.jsx";
import { Btn, Card, Chip, Empty, SectionTitle, inputCls } from "../components/ui.jsx";
import CategoryResults from "../components/CategoryResults.jsx";
import {
  useDb, canManage, tournamentsOf, activeTournament, categoriesIn, categoryLabel, formatMoney, myPlayers, entryCount, dateText, stageMatches, stagesOf, stageSummary,
} from "../lib/db.js";

export default function SportPage() {
  const { slug } = useParams();
  const sport = getSport(slug);
  const db = useDb();
  const [pick, setPick] = useState("");
  if (!sport) return <Navigate to="/" replace />;
  const Icon = SPORT_ICONS[sport.slug];
  const admin = canManage(db, sport.slug);
  const tournaments = tournamentsOf(db, sport.slug);
  const tour = tournaments.find((t) => t.id === pick) || activeTournament(db, sport.slug);

  const header = (
    <>
      <Link to="/" className="inline-flex items-center gap-1.5 px-2 pb-2 pt-7 text-sm font-bold text-soft">
        <ArrowLeft size={18} aria-hidden="true" /> All sports
      </Link>
      <header className="rise relative h-[170px] overflow-hidden rounded-[22px] p-5" style={{ background: sport.gradient }}>
        <Icon className="absolute -right-6 -top-4 h-56 w-56 text-white/25" />
        <div className="absolute bottom-[18px] left-5 right-5">
          <p className="truncate text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">{tour ? tour.name : "Tracklex"}</p>
          <h1 className="mt-1 font-display text-[48px] font-extrabold italic uppercase leading-[0.95]">{sport.name}</h1>
        </div>
      </header>
    </>
  );

  if (!sport.ready) {
    return (
      <div className="mx-auto max-w-md px-4">
        {header}
        <div className="mt-4">
          <Empty title="Setup coming soon">We are setting up Table Tennis first. {sport.name} follows after that.</Empty>
        </div>
      </div>
    );
  }

  const cats = tour ? categoriesIn(db, tour.id) : [];
  const mineRegIds = new Set(db.registrations.filter((r) => myPlayers(db).some((p) => p.id === r.playerId)).map((r) => r.id));
  const withMatches = cats.filter((c) => db.matches.some((m) => m.categoryId === c.id));

  return (
    <div className="mx-auto max-w-md px-4">
      {header}

      {tournaments.length > 1 && (
        <select className={`${inputCls} mt-4`} value={tour?.id || ""} onChange={(e) => setPick(e.target.value)} aria-label="Tournament">
          {tournaments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}

      <div className="rise-2 mt-4 flex gap-3">
        <Btn to="/sport/table-tennis/register" className="flex-1">
          Register
        </Btn>
        {admin && (
          <Btn to={tour ? `/admin/tournaments/${tour.id}` : "/admin/tournaments"} variant="soft" aria-label="Set up Table Tennis">
            <Settings2 size={18} aria-hidden="true" /> Set up
          </Btn>
        )}
      </div>

      {tour && (
        <p className="mt-3 text-sm text-soft">
          {tour.startsOn ? `${dateText(tour.startsOn)}${tour.endsOn ? ` to ${dateText(tour.endsOn)}` : ""} · ` : ""}
          {tour.regOpen ? "Entries open" : "Entries closed"}
        </p>
      )}

      <SectionTitle>Categories and fees</SectionTitle>
      {cats.length === 0 ? (
        <Empty
          title={tour ? "Categories are not set up yet" : "No tournament yet"}
          action={admin ? <Btn to={tour ? `/admin/tournaments/${tour.id}` : "/admin/tournaments"} variant="soft">{tour ? "Add categories" : "Create the tournament"}</Btn> : null}
        >
          {admin ? "Create the tournament, then add its age and gender groups." : "The organiser is still setting this up."}
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {cats.map((c) => {
            const n = entryCount(db, c.id);
            const stages = stagesOf(db, c.id);
            return (
              <li key={c.id}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{categoryLabel(c)}</p>
                    <p className="mt-0.5 text-[13px] text-soft">
                      Ages {c.minAge}–{c.maxAge} · {n} {n === 1 ? "entry" : "entries"}
                    </p>
                    {stages.length > 0 && (
                      <p className="mt-0.5 text-[12px] text-muted">{stages.map((s) => s.name).join(" → ")}</p>
                    )}
                  </div>
                  <Chip>{formatMoney(c.fee)}</Chip>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <SectionTitle>Matches</SectionTitle>
      {withMatches.length === 0 ? (
        <Empty title="No matches yet">Draws and results appear here once the organiser publishes them.</Empty>
      ) : (
        withMatches.map((c) => (
          <div key={c.id}>
            <p className="mb-2 font-bold">{categoryLabel(c)}</p>
            <CategoryResults db={db} category={c} mineRegIds={mineRegIds} />
          </div>
        ))
      )}
    </div>
  );
}
