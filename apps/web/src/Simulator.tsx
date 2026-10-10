import { useState } from "react";
import { api } from "./client";
export default function Simulator({
  treeId,
  sessionId,
  onChange,
  onError,
}: {
  treeId: string;
  sessionId?: string;
  onChange: () => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run(action: string, moisture?: number) {
    setBusy(true);
    try {
      await api.call("simulator", {
        action,
        tree_id: treeId,
        session_id: sessionId,
        moisture,
      });
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="simulator">
      <summary>Developer simulator · simulated hardware</summary>
      <p>Illustrative measurements; never send these to a real device.</p>
      <div className="button-grid">
        <button disabled={busy} onClick={() => run("reading", 22)}>
          Make thirsty / refresh
        </button>
        <button disabled={busy} onClick={() => run("reading", 60)}>
          Recover without evidence
        </button>
        <button disabled={busy || !sessionId} onClick={() => run("partial")}>
          Partial watering
        </button>
        <button disabled={busy || !sessionId} onClick={() => run("complete")}>
          Verified recovery
        </button>
        <button disabled={busy} onClick={() => run("death")}>
          Confirm death
        </button>
        <button disabled={busy} onClick={() => run("deliver")}>
          Deliver history now
        </button>
        <button disabled={busy} onClick={() => run("reset")}>
          Reset game state
        </button>
      </div>
    </details>
  );
}
