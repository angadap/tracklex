import { NavLink } from "react-router-dom";
import { Home, User, ClipboardPen, ShieldCheck } from "lucide-react";
import { useDb, isAdmin, isStaff, isStaffAccount } from "../lib/db.js";

// Floating pill: only the active tab shows its label.
export default function BottomNav() {
  const db = useDb();
  const staff = isStaff(db);
  const staffLabel = isAdmin(db) ? "Admin" : "Organiser";
  const tabs = [
    { to: "/", label: "Home", Icon: Home, end: true },
    ...(isStaffAccount(db) ? [] : [{ to: "/sport/table-tennis/register", label: "Register", Icon: ClipboardPen }]),
    ...(staff ? [{ to: "/admin", label: staffLabel, Icon: ShieldCheck }] : []),
    { to: "/profile", label: "Profile", Icon: User },
  ];
  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-6"
      style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
    >
      <ul className="pointer-events-auto mx-auto flex h-[60px] max-w-md items-center justify-around rounded-full bg-surface px-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        {tabs.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              aria-label={label}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-full text-[13px] font-bold ${
                  isActive ? "bg-white px-4 py-2.5 text-void" : "p-3 text-muted"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} strokeWidth={2} aria-hidden="true" />
                  {isActive && label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
