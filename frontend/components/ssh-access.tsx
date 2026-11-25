"use client";
import { useState } from "react";
import { resetRootPassword } from "@/lib/ssh-access";

export function SshAccess({id, admin, enabled}: {id:string; admin:boolean; enabled:boolean}) {
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [queued,setQueued] = useState(false);
  async function reset() {
    if (busy || queued || !enabled || !window.confirm("Generate a new root password and enable SSH password login?")) return;
    setBusy(true); setError(""); setPassword("");
    try {
      const result = await resetRootPassword(id,admin);
      if (result.password) {setPassword(result.password); setQueued(true);}
      else setError(result.error ?? "Request not confirmed.");
    } catch {setError("Request not confirmed. Check task history.");}
    finally {setBusy(false);}
  }
  return <section className="rounded-2xl border border-slate-500/40 p-6 space-y-3">
    <h3 className="text-lg font-semibold">SSH access</h3>
    <p className="text-sm">Username: root. Password reset requires a running managed Incus container.</p>
    <button type="button" disabled={!enabled || busy || queued} onClick={reset} className="rounded-lg bg-amber-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">{busy ? "Requesting..." : "Generate root password"}</button>
    {error && <p role="alert">{error}</p>}
    {queued && <p role="status">Reset queued. Wait for CHANGE_PASSWORD to succeed before logging in. Save the password now; it cannot be retrieved later.</p>}
    {password && <div className="space-y-2"><code className="block break-all select-all">{password}</code><button type="button" onClick={()=>setPassword("")} className="underline">Hide permanently</button></div>}
  </section>;
}
