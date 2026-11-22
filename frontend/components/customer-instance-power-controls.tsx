"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type Action = "start" | "stop" | "reboot";

function ActionButton({ action, disabled, onChoose }: {
  action: Action;
  disabled: boolean;
  onChoose: (action: Action) => void;
}) {
  const { pending } = useFormStatus();
  const styles: Record<Action, string> = {
    start: "border-emerald-300 text-emerald-800 hover:bg-emerald-50",
    stop: "border-rose-300 text-rose-800 hover:bg-rose-50",
    reboot: "border-slate-300 text-slate-800 hover:bg-slate-50",
  };
  return (
    <button type="button" disabled={disabled || pending} onClick={() => onChoose(action)}
      className={`rounded-lg border px-4 py-2 text-sm font-semibold capitalize disabled:cursor-not-allowed disabled:opacity-40 ${styles[action]}`}>
      {pending ? "Submitting…" : action}
    </button>
  );
}

export function CustomerInstancePowerControls({ name, canStart, canStop, canReboot }: {
  name: string;
  canStart: boolean;
  canStop: boolean;
  canReboot: boolean;
}) {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const { pending } = useFormStatus();
  const enabled: Record<Action, boolean> = { start: canStart, stop: canStop, reboot: canReboot };

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap gap-3">
        {(["start", "stop", "reboot"] as const).map((action) => (
          <ActionButton key={action} action={action} disabled={!enabled[action] || pending} onChoose={setConfirming} />
        ))}
      </div>
      {confirming && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="group" aria-label="Confirm VPS operation">
          <p className="text-sm text-amber-950">Confirm {confirming} for <strong>{name}</strong>?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" name="action" value={confirming} disabled={pending}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {pending ? "Submitting…" : `Confirm ${confirming}`}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
