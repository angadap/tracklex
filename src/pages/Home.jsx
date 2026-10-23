import { Link } from "react-router-dom";
import { ArrowRight, User } from "lucide-react";
import { SPORTS } from "../data/sports.js";
import { SPORT_ICONS } from "../components/SportIcons.jsx";
import { useDb, me, currentSeason } from "../lib/db.js";

export default function Home() {
  const db = useDb();
  const account = me(db);
  const first = account?.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-md">
      <div className="flex items-center justify-between px-6 pt-7">
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-soft">Tracklex - Tournaments Tracker</p>
        <Link
          to="/profile"
          aria-label="My profile"
          className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-soft"
        >
          <User size={17} aria-hidden="true" />
        </Link>
      </div>

      <header className="rise px-6 pt-6">
        <p className="text-[15px] font-bold uppercase tracking-[0.14em] text-muted">
          {first ? `Hi, ${first} · Season` : "Season"}
        </p>
        <h1 className="font-display text-[76px] font-extrabold italic uppercase leading-[0.9] tabular-nums">
          {currentSeason(db)}
        </h1>
        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-bold text-soft">
          <span className="h-[7px] w-[7px] rounded-full bg-live" aria-hidden="true" />
          Registration open
        </span>
      </header>

      <section className="rise-2 mt-6 space-y-3.5 px-4" aria-label="Sports">
        {SPORTS.map((sport) => {
          const Icon = SPORT_ICONS[sport.slug];
          return (
            <Link
              key={sport.slug}
              to={`/sport/${sport.slug}`}
              className="card-press relative block h-[158px] overflow-hidden rounded-[22px] p-5"
              style={{ background: sport.gradient }}
            >
              <Icon className="absolute -right-6 -top-4 h-56 w-56 text-white/25" />
              {!sport.ready && (
                <span className="absolute left-5 top-5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-bold">
                  Setup coming soon
                </span>
              )}
              <div className="absolute bottom-[18px] left-5 right-20">
                <span className="block font-display text-[44px] font-extrabold italic uppercase leading-[0.95]">
                  {sport.name}
                </span>
                <span className="mt-1 block text-[13px] font-medium text-white/85">{sport.tagline}</span>
              </div>
              <span className="absolute bottom-[18px] right-[18px] grid h-[42px] w-[42px] place-items-center rounded-full bg-white text-void">
                <ArrowRight size={20} strokeWidth={2.4} aria-hidden="true" />
              </span>
            </Link>
          );
        })}
        <p className="px-2 pt-1 text-xs text-muted">More sports will be added in future seasons.</p>
      </section>
    </div>
  );
}
