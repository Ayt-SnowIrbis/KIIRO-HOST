"use client";
import { useState, type FormEvent } from "react";
import { createIncusInstanceWithCredentials } from "@/lib/admin/provisioning-actions";
type Option = {id:string;name:string;enabled?:boolean};
type User = {id:string;email:string;customer:{id:string;displayName:string|null}|null};
type Plan = Option & {vcpu:number;memoryMb:number;diskGb:number};
type Image = Option & {mode:string};
type Region = Option & {code:string};
export function ProvisionWithCredentials({users,regions,plans,images}:{users:User[];regions:Region[];plans:Plan[];images:Image[]}) {
  const [result,setResult]=useState<{password?:string;instanceId?:string;address?:string;error?:string}>({});
  const [busy,setBusy]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy || submitted) return;
    const data=new FormData(event.currentTarget);
    setBusy(true);setResult({});
    try {
      const response=await createIncusInstanceWithCredentials(data);
      setResult(response);
      if(response.password) setSubmitted(true);
    } catch {setResult({error:"Request status uncertain. Verify instance list before retrying."});}
    finally {setBusy(false);}
  }
  const input="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white";
  return <div className="space-y-4">
    <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
      <label className="text-xs">Customer<select required name="customerId" className={input}><option value="">Select customer</option>{users.filter(u=>u.customer).map(u=><option key={u.id} value={u.customer!.id}>{u.email}</option>)}</select></label>
      <label className="text-xs">Region<select required name="regionId" className={input}><option value="">Select region</option>{regions.filter(r=>r.enabled).map(r=><option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
      <label className="text-xs">Plan<select required name="planId" className={input}><option value="">Select plan</option>{plans.filter(p=>p.enabled).map(p=><option key={p.id} value={p.id}>{p.name} ({p.vcpu} vCPU, {p.memoryMb} MB)</option>)}</select></label>
      <label className="text-xs">Image<select required name="imageId" className={input}><option value="">Select image</option>{images.filter(i=>i.enabled&&i.mode==="REAL").map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <button disabled={busy||submitted} className="rounded bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy?"Creating...":"Queue provisioning"}</button>
    </form>
    {result.error && <p role="alert" className="text-rose-300">{result.error}</p>}
    {result.instanceId && <p role="status" className="text-sm">VPS queued: {result.instanceId} · IP: {result.address}. Check PROVISION status before SSH login.</p>}
    {result.password && <div className="space-y-2 rounded border border-amber-500/50 p-4">
      <p className="font-semibold">One-time root password. Save it now; this page cannot retrieve it again.</p>
      <code className="block select-all break-all">{result.password}</code>
      <button type="button" onClick={()=>setResult(({instanceId,address})=>({instanceId,address}))} className="underline">Hide password permanently</button>
    </div>}
  </div>;
}
