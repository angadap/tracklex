import { Link, useParams, Navigate } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import { getSport } from "../data/sports.js";
import { SPORT_ICONS } from "../components/SportIcons.jsx";
import { Btn, Card, Chip, Empty, SectionTitle } from "../components/ui.jsx";
import MatchRow from "../components/MatchRow.jsx";
import { useDb, canManage, tableTennisCategories, categoryLabel, formatMoney, myPlayers, champion, entryName, entryCount } from "../lib/db.js";

export default function SportPage() {
  const { slug } = useParams();
  const sport = getSport(slug);
  const db = useDb();
  if (!sport) return <Navigate to="/" replace />;
  const Icon = SPORT_ICONS[sport.slug];
  const admin = canManage(db, sport.slug);

  const header = (
    <>
      <Link to="/" className="inline-flex items-center gap-1.5 px-2 pb-2 pt-7 text-sm font-bold text-soft">
        <ArrowLeft size={18} aria-hidden="true" /> All sports
      </Link>
      <header className="rise relative h-[170px] overflow-hidden rounded-[22px] p-5" style={{ background: sport.gradient }}>
        <Icon className="absolute -right-6 -top-4 h-56 w-56 text-white/25" />
        <div className="absolute bottom-[18px] left-5 right-5">
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">Warje Olympics {db.settings.season}</p>
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

  const cats = tableTennisCategories(db);
  const mineRegIds = new Set(
    db.registrations.filter((r) => myPlayers(db).some((p) => p.id === r.playerId)).map((r) => r.id)
  );
  const withMatches = cats.filter((c) => db.matches.some((m) => m.categoryId === c.id));

  return (
    <div className="mx-auto max-w-md px-4">
      {header}

      <div className="rise-2 mt-4 flex gap-3">
        <Btn to="/sport/table-tennis/register" className="flex-1">
          Register
        </Btn>
        {admin && (
          <Btn to="/admin/categories" variant="soft" aria-label="Set up Table Tennis">
            <Settings2 size={18} aria-hidden="true" /> Set up
          </Btn>
        )}
      </div>

      <SectionTitle>Categories and fees</SectionTitle>
      {cats.length === 0 ? (
        <Empty
          title="Categories are not set up yet"
          action={admin ? <Btn to="/admin/categories" variant="soft">Add categories</Btn> : null}
        >
          {admin ? "Add the age and gender groups for this season." : "The organiser is still setting up this season."}
        </Empty>
      ) : (
        <ul className="space-y-2.5">
          {cats.map((c) => {
            const n = entryCount(db, c.id);
            return (
              <li key={c.id}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{categoryLabel(c)}</p>
                    <p className="mt-0.5 text-[13px] text-soft">
                      Ages {c.minAge}–{c.maxAge} · {n} {n === 1 ? "entry" : "entries"}
                    </p>
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
        withMatches.map((c) => {
          const ms = db.matches.filter((m) => m.categoryId === c.id).sort((a, b) => a.round - b.round || a.seq - b.seq);
          const rounds = [...new Set(ms.map((m) => m.round))];
          const champ = champion(db, c.id);
          return (
            <div key={c.id} className="mb-6">
              <p className="mb-2 font-bold">{categoryLabel(c)}</p>
              {champ && (
                <p className="mb-2 rounded-xl bg-[#33270f] px-4 py-2.5 text-sm font-bold text-[#fbbf24]">Champion: {entryName(db, champ)}</p>
              )}
              {rounds.map((r) => (
                <div key={r} className="mb-3">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.14em] text-muted">{ms.find((m) => m.round === r).roundLabel}</p>
                  <div className="space-y-2">
                    {ms.filter((m) => m.round === r).map((m) => (
                      <MatchRow key={m.id} m={m} db={db} mine={mineRegIds.has(m.p1RegId) || mineRegIds.has(m.p2RegId)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
