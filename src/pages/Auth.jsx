import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signIn, signUp, staffSignIn, continueAsGuest, useDb, MODE, currentSeason } from "../lib/db.js";
import { Segmented, Field, Btn, ErrorText, Card, inputCls } from "../components/ui.jsx";

const copy = {
  login: ["Sign in", "Use your mobile number and PIN."],
  register: ["Join in", "Create your account to enter events for yourself or your children."],
  admin: ["Staff", "Sign in with your admin or organiser username and password."],
};

export default function Auth({ initialMode = "login" }) {
  const db = useDb();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from;
  const [who, setWho] = useState(from?.startsWith("/admin") ? "admin" : "player");
  const [mode, setMode] = useState(initialMode);
  const [f, setF] = useState({ name: "", mobile: "", pin: "", pin2: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const digits = (k) => (e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, "") });
  const text = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const key = who === "admin" ? "admin" : mode;

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (key === "register" && f.pin !== f.pin2) return setError("The two PINs do not match.");
    setBusy(true);
    const res = who === "admin" ? await staffSignIn(f) : mode === "register" ? await signUp(f) : await signIn(f);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const target = who === "admin" ? (from?.startsWith("/admin") ? from : "/admin") : mode === "register" ? "/profile" : from || "/";
    nav(target, { replace: true });
  }

  return (
    <div className="mx-auto max-w-md px-6 pb-12 pt-10">
      <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-soft">Tracklex · Warje Olympics {currentSeason(db)}</p>
      <h1 className="mt-2 font-display text-[64px] font-extrabold italic uppercase leading-[0.9]">{copy[key][0]}</h1>
      <p className="mt-3 text-sm leading-relaxed text-soft">{copy[key][1]}</p>

      <div className="mt-6 space-y-3">
        <Segmented
          value={who}
          onChange={(v) => { setWho(v); setError(""); }}
          options={[{ value: "player", label: "Player" }, { value: "admin", label: "Admin / Organiser" }]}
        />
        {who === "player" && (
          <Segmented
            value={mode}
            onChange={(v) => { setMode(v); setError(""); }}
            options={[{ value: "login", label: "Sign in" }, { value: "register", label: "New registration" }]}
          />
        )}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        {who === "admin" ? (
          <>
            <Field label="Username">
              <input className={inputCls} value={f.username} onChange={text("username")} autoComplete="username" autoCapitalize="none" required />
            </Field>
            <Field label="Password">
              <input className={inputCls} type="password" value={f.password} onChange={text("password")} autoComplete="current-password" required />
            </Field>
          </>
        ) : (
          <>
            {mode === "register" && (
              <Field label="Full name">
                <input className={inputCls} value={f.name} onChange={text("name")} autoComplete="name" required />
              </Field>
            )}
            <Field label="Mobile number" hint={mode === "register" ? "This is your username. Each mobile number can have one account." : undefined}>
              <input className={inputCls} value={f.mobile} onChange={digits("mobile")} inputMode="numeric" maxLength={10} autoComplete="tel-national" placeholder="10-digit number" required />
            </Field>
            <Field label="PIN" hint={mode === "register" ? "Choose 4 to 6 digits." : undefined}>
              <input className={inputCls} type="password" value={f.pin} onChange={digits("pin")} inputMode="numeric" maxLength={6} autoComplete={mode === "register" ? "new-password" : "current-password"} required />
            </Field>
            {mode === "register" && (
              <Field label="Confirm PIN">
                <input className={inputCls} type="password" value={f.pin2} onChange={digits("pin2")} inputMode="numeric" maxLength={6} autoComplete="new-password" required />
              </Field>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Btn type="submit" className="w-full" disabled={busy}>
          {busy ? "Please wait" : who === "admin" ? "Sign in" : mode === "register" ? "Create account" : "Sign in"}
        </Btn>
      </form>

      {who === "player" && mode === "login" && (
        <p className="mt-4 text-center text-xs text-muted">Forgot your PIN? Ask the admin to reset it.</p>
      )}

      {who === "admin" && MODE === "demo" && (
        <Card className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Demo mode</p>
          <p className="mt-1 text-sm text-soft">
            Username <b className="text-white">admin</b>, password <b className="text-white">admin123</b>. Data stays on this device only.
          </p>
        </Card>
      )}

      <button
        onClick={() => { continueAsGuest(); nav("/", { replace: true }); }}
        className="mx-auto mt-8 block text-sm font-bold text-soft underline"
      >
        Continue without signing in
      </button>
    </div>
  );
}
