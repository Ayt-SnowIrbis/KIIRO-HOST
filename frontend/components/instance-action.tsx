"use client";
import { useState } from "react";

export function InstanceAction({ action, name, enabled }: { action: "start" | "stop" | "reboot"; name: string; enabled: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!confirmed ? (
        <button type="button" disabled={!enabled || pending} onClick={() => setConfirmed(true)} className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40">{action.toUpperCase()}</button>
      ) : (
        <>
          <span className="text-xs text-slate-300">Confirm {action} for {name}?</span>
          <button type="submit" name="action" value={action} disabled={pending} onClick={() => setPending(true)} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">Confirm</button>
          <button type="button" onClick={() => setConfirmed(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Cancel</button>
        </>
      )}
    </div>
  );
}
