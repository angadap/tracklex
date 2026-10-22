import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav.jsx";
import Home from "./pages/Home.jsx";
import SportPage from "./pages/SportPage.jsx";
import Register from "./pages/Register.jsx";
import Auth from "./pages/Auth.jsx";
import Profile from "./pages/Profile.jsx";
import AdminHome from "./pages/admin/AdminHome.jsx";
import Categories from "./pages/admin/Categories.jsx";
import Players from "./pages/admin/Players.jsx";
import Matches from "./pages/admin/Matches.jsx";
import Settings from "./pages/admin/Settings.jsx";
import Organisers from "./pages/admin/Organisers.jsx";
import Password from "./pages/admin/Password.jsx";
import Placeholder from "./pages/Placeholder.jsx";
import { useDb, me, isAdmin, isStaff, isStaffAccount, can, canManage } from "./lib/db.js";

const AUTH_PATHS = ["/login", "/signup"];

// The app opens on the sign-in screen. Visitors who choose "Continue without signing in" can browse read-only.
function Gate({ children }) {
  const db = useDb();
  const loc = useLocation();
  const signedIn = !!me(db);
  const onAuth = AUTH_PATHS.includes(loc.pathname);
  if (!signedIn && !db.guest && !onAuth) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (signedIn && onAuth) return <Navigate to={isStaffAccount(db) ? "/admin" : "/"} replace />;
  return children;
}

// Staff = admin or organiser. adminOnly pages send organisers back to their dashboard.
function StaffOnly({ children, adminOnly = false, need = null, accountOnly = false }) {
  const db = useDb();
  const loc = useLocation();
  if (!me(db)) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (!isStaff(db)) return <Navigate to="/" replace />;
  if (accountOnly && !isStaffAccount(db)) return <Navigate to="/admin" replace />;
  if (adminOnly && !isAdmin(db)) return <Navigate to="/admin" replace />;
  // need: one permission key, or a list of which any one is enough
  const needs = need ? [].concat(need) : [];
  if (needs.length && !needs.some((k) => can(db, "table-tennis", k))) return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  const loc = useLocation();
  const db = useDb();
  return (
    <div className="min-h-screen pb-32">
      {db.error && (
        <p role="alert" className="bg-[#33270f] px-4 py-2 text-center text-xs font-bold text-[#fbbf24]">{db.error}</p>
      )}
      <Gate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sport/table-tennis/register" element={<Register />} />
          <Route path="/sport/:slug" element={<SportPage />} />
          <Route path="/register" element={<Navigate to="/sport/table-tennis/register" replace />} />
          <Route path="/login" element={<Auth initialMode="login" />} />
          <Route path="/signup" element={<Auth initialMode="register" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<StaffOnly><AdminHome /></StaffOnly>} />
          <Route path="/admin/categories" element={<StaffOnly need="categories"><Categories /></StaffOnly>} />
          <Route path="/admin/players" element={<StaffOnly need="entries"><Players /></StaffOnly>} />
          <Route path="/admin/matches" element={<StaffOnly need={["draws", "scores"]}><Matches /></StaffOnly>} />
          <Route path="/admin/settings" element={<StaffOnly adminOnly><Settings /></StaffOnly>} />
          <Route path="/admin/organisers" element={<StaffOnly adminOnly><Organisers /></StaffOnly>} />
          <Route path="/admin/password" element={<StaffOnly accountOnly><Password /></StaffOnly>} />
          <Route path="*" element={<Placeholder title="Not found" note="Use the tabs below to get back on track." />} />
        </Routes>
      </Gate>
      {!AUTH_PATHS.includes(loc.pathname) && <BottomNav />}
    </div>
  );
}
