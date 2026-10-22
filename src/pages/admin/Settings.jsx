import { useState } from "react";
import { useDb, saveSettings, resetAllData } from "../../lib/db.js";
import { TopBar, Page, Field, Btn, ErrorText, Card, inputCls } from "../../components/ui.jsx";

export default function Settings() {
  const db = useDb();
  const [form, setForm] = useState(db.settings);
  const [msg, setMsg] = useState({ type: "", text: "" });
  async function save(e) {
    e.preventDefault();
    const res = await saveSettings(form);
    setMsg(res.ok ? { type: "ok", text: "Settings saved." } : { type: "err", text: res.error });
  }
  async function reset() {
    if (confirm("Delete every player account, entry, category and match? Admin and organiser accounts are kept. This cannot be undone.")) {
      const res = await resetAllData();
      setMsg(res.ok ? { type: "ok", text: "All players, entries, categories and matches were deleted." } : { type: "err", text: res.error });
    }
  }

  return (
    <>
      <TopBar title="Settings" back="/admin" backLabel="Dashboard" sub="Season" />
      <Page>
        <form onSubmit={save} className="space-y-4">
          <Field label="Season year"><input className={inputCls} inputMode="numeric" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></Field>
          <Field label="Count ages on" hint="A player's age on this date decides which category they can enter.">
            <input className={inputCls} type="date" value={form.ageCutoff} onChange={(e) => setForm({ ...form, ageCutoff: e.target.value })} />
          </Field>
          <ErrorText>{msg.type === "err" ? msg.text : ""}</ErrorText>
          {msg.type === "ok" && <p className="text-sm font-bold text-live">{msg.text}</p>}
          <Btn type="submit" className="w-full">Save settings</Btn>
        </form>

        <Card className="mt-8">
          <p className="font-bold">Clear test data</p>
          <p className="mt-1 text-sm text-soft">Use this to wipe the practice players and matches before the real season starts.</p>
          <Btn variant="danger" className="mt-3 w-full" onClick={reset}>Delete all players and matches</Btn>
        </Card>
      </Page>
    </>
  );
}
