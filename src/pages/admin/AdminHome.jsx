import { Link } from "react-router-dom";
import { ChevronRight, Layers, Users, Swords, Settings2, UserCog, KeyRound } from "lucide-react";
import { useDb, me, isAdmin, can, presetName, sportName, tableTennisCategories, formatMoney } from "../../lib/db.js";
import { TopBar, Page, Card } from "../../components/ui.jsx";

export default function AdminHome() {
  const db = useDb();
  const admin = isAdmin(db);
  const account = me(db);
  const organisers = db.accounts.filter((a) => a.role === "organiser" || (a.role === "player" && a.perms?.length)).length;
  const cats = tableTennisCategories(db);
  const feeOf = (r) => cats.find((c) => c.id === r.categoryId)?.fee || 0;
  const regs = db.registrations.filter((r) => cats.some((c) => c.id === r.categoryId));
  const collected = regs.filter((r) => r.paid).reduce((s, r) => s + feeOf(r), 0);
  const pending = regs.filter((r) => !r.paid).reduce((s, r) => s + feeOf(r), 0);
  const players = new Set(regs.map((r) => r.playerId)).size;
  const played = db.matches.filter((m) => m.status === "done" && !m.bye).length;

  const ok = (perm) => can(db, "table-tennis", perm);
  // Entries and fees are only visible to people who may see entries; showing zeros to others would be wrong.
  const stats = ok("entries")
    ? [
        ["Players entered", players],
        ["Entries", regs.length],
        ["Fees collected", collected ? formatMoney(collected) : "₹0"],
        ["Fees pending", pending ? formatMoney(pending) : "₹0"],
      ]
    : [["Matches played", played]];
  const links = [
    ...(ok("categories") ? [{ to: "/admin/categories", Icon: Layers, title: "Categories and fees", note: `${cats.length} set up` }] : []),
    ...(ok("entries") ? [{ to: "/admin/players", Icon: Users, title: "Players and payments", note: `${regs.length} entries` }] : []),
    ...(ok("draws") || ok("scores") ? [{ to: "/admin/matches", Icon: Swords, title: "Matches and scores", note: `${played} played` }] : []),
    ...(admin
      ? [
          { to: "/admin/organisers", Icon: UserCog, title: "Organisers", note: organisers ? `${organisers} assigned` : "None yet" },
          { to: "/admin/settings", Icon: Settings2, title: "Season settings", note: `Season ${db.settings.season}` },
        ]
      : []),
    ...(account.username ? [{ to: "/admin/password", Icon: KeyRound, title: "Change password", note: `@${account.username}` }] : []),
  ];

  return (
    <>
      <TopBar title={admin ? "Admin" : "Organiser"} sub={admin ? `Table Tennis ${db.settings.season}` : `${sportName(account.sport)} ${db.settings.season} · ${presetName(account.perms)}`} />
      <Page>
        <div className="grid grid-cols-2 gap-3">
          {stats.map(([label, value]) => (
            <Card key={label}>
              <p className="font-display text-[40px] font-extrabold italic leading-none tabular-nums">{value}</p>
              <p className="mt-1.5 text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
            </Card>
          ))}
        </div>
        <ul className="mt-5 space-y-2.5">
          {links.map(({ to, Icon, title, note }) => (
            <li key={to}>
              <Link to={to} className="flex items-center gap-4 rounded-2xl bg-surface px-4 py-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2"><Icon size={19} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold leading-tight">{title}</span>
                  <span className="mt-0.5 block text-[13px] text-soft">{note}</span>
                </span>
                <ChevronRight size={20} className="text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Page>
    </>
  );
}
