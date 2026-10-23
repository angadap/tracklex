import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Settings2 } from "lucide-react";
import { getSport } from "../data/sports.js";
import { SPORT_ICONS } from "../components/SportIcons.jsx";
import { Btn, Card, Chip, Empty, SectionTitle } from "../components/ui.jsx";
import CategoryResults from "../components/CategoryResults.jsx";
import {
  useDb, canManage, tournamentsOf, activeTournament, categoriesIn, categoryLabel, formatMoney, myPlayers, entryCount, dateText, stageMatches, stagesOf, stageSummary,
} from "../lib/db.js";

export default function SportPage() {
  const { slug, tid } = useParams();
  const sport = getSport(slug);
  const db = useDb();
  if (!sport) return <Navigate to="/" replace />;
  const Icon = SPORT_ICONS[sport.slug];
  const admin = canManage(db, sport.slug);
  const tournaments = tournamentsOf(db, sport.slug);
  const tour = tid ? tournaments.find((t) => t.id === tid) : null;

  const header = (
    <>
      <Link to={tour ? `/sport/${sport.slug}` : "/"} className="inline-flex items-center gap-1.5 px-2 pb-2 pt-7 text-sm font-bold text-soft">
        <ArrowLeft size={18} aria-hidden="true" /> {tour ? "All tournaments" : "All sports"}
      </Link>
      <header className="rise relative h-[170px] overflow-hidden rounded-[22px] p-5" style={{ background: sport.gradient }}>
        <Icon className="absolute -right-6 -top-4 h-56 w-56 text-white/25" />
        <div className="absolute bottom-[18px] left-5 right-5">
          <p className="truncate text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">{tour ? tour.name : "Tournaments"}</p>
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

  // Level 1: every tournament of this sport. Tap one to see its categories.
  if (tid && !tour) return <Navigate to={`/sport/${sport.slug}`} replace />;
  if (!tour) {
    return (
      <div className="mx-auto max-w-md px-4">
        {header}
        {admin && (
          <div className="rise-2 mt-4">
            <Btn to="/admin/tournaments" variant="soft" className="w-full" aria-label="Set up tournaments">
              <Settings2 size={18} aria-hidden="true" /> Set up tournaments
            </Btn>
          </div>
        )}
        <SectionTitle>Tournaments</SectionTitle>
        {tournaments.length === 0 ? (
          <Empty title="No tournaments yet">{admin ? "Create the first tournament to get started." : "The organiser is still setting this up."}</Empty>
        ) : (
          <ul className="space-y-2.5">
            {tournaments.map((t) => {
              const tc = categoriesIn(db, t.id);
              const n = tc.reduce((sum, c) => sum + entryCount(db, c.id), 0);
              return (
                <li key={t.id}>
                  <Link to={`/sport/${sport.slug}/t/${t.id}`} className="block">
                    <Card className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold">{t.name}</p>
                        <p className="mt-0.5 text-[13px] text-soft">
                          {t.startsOn ? `${dateText(t.startsOn)}${t.endsOn ? ` to ${dateText(t.endsOn)}` : ""} · ` : `Season ${t.season} · `}
                          {tc.length} {tc.length === 1 ? "category" : "categories"} · {n} {n === 1 ? "entry" : "entries"}
                        </p>
                      </div>
                      <Chip tone={t.regOpen ? "good" : "neutral"}>{t.regOpen ? "Entries open" : "Closed"}</Chip>
                      <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // Level 2: one tournament, with its categories and matches.
  const cats = tour ? categoriesIn(db, tour.id) : [];
  const mineRegIds = new Set(db.registrations.filter((r) => myPlayers(db).some((p) => p.id === r.playerId)).map((r) => r.id));
  const withMatches = cats.filter((c) => db.matches.some((m) => m.categoryId === c.id));

  return (
    <div className="mx-auto max-w-md px-4">
      {header}

      <div className="rise-2 mt-4 flex gap-3">
        <Btn to={`/sport/${sport.slug}/register?t=${tour.id}`} className="flex-1">
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
