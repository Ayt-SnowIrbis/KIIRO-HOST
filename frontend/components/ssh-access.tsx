"use client";
import { useEffect, useState } from "react";
import { resetRootPassword, getManagedSshKeys, manageSshKey } from "@/lib/ssh-access";

export function SshAccess({id, admin, enabled}: {id:string; admin:boolean; enabled:boolean}) {
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [keys,setKeys] = useState<string[]>([]);
  const [newKey,setNewKey] = useState("");
  const [keyStatus,setKeyStatus] = useState("");
  const [keyBusy,setKeyBusy] = useState(false);
  useEffect(() => { let live=true; void getManagedSshKeys(id,admin).then(result => {if(live){setKeys(result.keys);if(result.error)setKeyStatus(result.error);}}); return ()=>{live=false}; },[id,admin]);
  async function changeKey(key:string,action:"add"|"remove") {
    if(keyBusy || !enabled || queued) return;
    if(!window.confirm(action==="add"?"Queue adding this SSH public key?":"Queue removing this SSH public key?")) return;
    setKeyBusy(true);setKeyStatus("");
    try {
      const result=await manageSshKey(id,admin,key,action);
      if(result.accepted){setKeyStatus("Task queued. Wait for the SSH_KEY task to succeed, then refresh the page.");setQueued(true);setNewKey("");}
      else setKeyStatus(result.error ?? "Request rejected");
    } catch {setKeyStatus("Request status uncertain. Inspect task history.");}
    finally{setKeyBusy(false);}
  }
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
    <div className="space-y-3 border-t border-slate-500/30 pt-4">
      <h4 className="font-semibold">Managed SSH public keys</h4>
      <p className="text-sm">Only keys added through this panel are listed. Manually installed keys are preserved.</p>
      {keys.length === 0 && <p className="text-sm">No managed public keys recorded.</p>}
      {keys.map((key,i)=><div key={i} className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs">{key}</code><button type="button" disabled={!enabled || queued || keyBusy} onClick={()=>void changeKey(key,"remove")} className="rounded border px-3 py-1 disabled:opacity-40">Remove</button></div>)}
      <label className="block text-sm">Public key<textarea rows={3} maxLength={9000} value={newKey} onChange={e=>setNewKey(e.target.value)} placeholder="ssh-ed25519 AAAA... user@host" className="mt-1 block w-full rounded border border-slate-500 bg-transparent p-2 text-sm"/></label>
      <button type="button" disabled={!enabled || queued || keyBusy || !newKey.trim()} onClick={()=>void changeKey(newKey.trim(),"add")} className="rounded border border-amber-500 px-3 py-2 disabled:opacity-40">Add public key</button>
      {keyStatus && <p role="status" className="text-sm">{keyStatus}</p>}
    </div>
  </section>;
}
