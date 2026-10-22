import { useState } from "react";
import { useDb, resetAllData } from "../../lib/db.js";
import { TopBar, Page, Btn, Card, ErrorText } from "../../components/ui.jsx";

export default function Settings() {
  useDb();
  const [msg, setMsg] = useState({ type: "", text: "" });
  async function reset() {
    if (confirm("Delete every player account, entry, tournament, category and match? Admin and organiser accounts are kept. This cannot be undone.")) {
      const res = await resetAllData();
      setMsg(res.ok ? { type: "ok", text: "All players, entries, tournaments and matches were deleted." } : { type: "err", text: res.error });
    }
  }
  return (
    <>
      <TopBar title="Data tools" back="/admin" backLabel="Dashboard" sub="Admin only" />
      <Page>
        <Card>
          <p className="font-bold">Clear test data</p>
          <p className="mt-1 text-sm text-soft">Use this to wipe the practice players, tournaments and matches before the real season starts. Season dates and age cutoffs are set per tournament.</p>
          <ErrorText>{msg.type === "err" ? msg.text : ""}</ErrorText>
          {msg.type === "ok" && <p className="mt-2 text-sm font-bold text-live">{msg.text}</p>}
          <Btn variant="danger" className="mt-3 w-full" onClick={reset}>Delete all players and tournaments</Btn>
        </Card>
      </Page>
    </>
  );
}
