import { useState } from "react";
import { useDb, me, changeStaffPassword } from "../../lib/db.js";
import { TopBar, Page, Field, Btn, ErrorText, inputCls } from "../../components/ui.jsx";

export default function Password() {
  const db = useDb();
  const account = me(db);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState({ type: "", text: "" });

  async function save(e) {
    e.preventDefault();
    const res = await changeStaffPassword(pw);
    if (res.ok) {
      setPw({ current: "", next: "" });
      setMsg({ type: "ok", text: "Password changed." });
    } else setMsg({ type: "err", text: res.error });
  }

  return (
    <>
      <TopBar title="Password" back="/admin" backLabel="Dashboard" sub={`@${account?.username}`} />
      <Page>
        <form onSubmit={save} className="space-y-4">
          <Field label="Current password"><input className={inputCls} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
          <Field label="New password" hint="At least 8 characters."><input className={inputCls} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></Field>
          <ErrorText>{msg.type === "err" ? msg.text : ""}</ErrorText>
          {msg.type === "ok" && <p className="text-sm font-bold text-live">{msg.text}</p>}
          <Btn type="submit" className="w-full">Change password</Btn>
        </form>
      </Page>
    </>
  );
}
