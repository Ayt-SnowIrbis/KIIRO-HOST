"use server";
import { cookies } from "next/headers";
import { getApiBaseUrl } from "@/lib/config";
import { requireAdminSession, requireUserSession } from "@/lib/auth/server-session";

export async function resetRootPassword(id: string, admin: boolean): Promise<{password?: string; error?: string}> {
  try {
    if (admin) await requireAdminSession(); else await requireUserSession();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error();
    const token = (await cookies()).get("kiiro_session")?.value;
    if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error();
    const path = admin ? "compute/instances" : "compute/customer/instances";
    const response = await fetch(`${getApiBaseUrl()}/${path}/${id}/password`, {
      method: "POST", headers: { Cookie: `kiiro_session=${token}` }, cache: "no-store",
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (typeof data.password !== "string" || !data.accepted) throw new Error();
    return {password: data.password};
  } catch { return {error: "Reset not confirmed. Check task history before retrying."}; }
}

async function authenticatedRequest(id:string,admin:boolean,method:"GET"|"POST",suffix:string,body?:unknown) {
  if(admin) await requireAdminSession(); else await requireUserSession();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid ID");
  const token=(await cookies()).get("kiiro_session")?.value;
  if(!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error("Session unavailable");
  const path=admin?"compute/instances":"compute/customer/instances";
  const response=await fetch(`${getApiBaseUrl()}/${path}/${id}/${suffix}`,{
    method,headers:{Cookie:`kiiro_session=${token}`,...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"
  });
  if(!response.ok) throw new Error("SSH key operation rejected");
  return response.json() as Promise<unknown>;
}
export async function getManagedSshKeys(id:string,admin:boolean):Promise<{keys:string[];error?:string}> {
  try {
    const data=await authenticatedRequest(id,admin,"GET","ssh-keys") as {keys:unknown};
    return {keys:Array.isArray(data.keys)?data.keys.filter((k):k is string=>typeof k==="string"):[]};
  } catch {return {keys:[],error:"Could not load managed SSH keys."};}
}
export async function manageSshKey(id:string,admin:boolean,key:string,action:"add"|"remove"):Promise<{accepted:boolean;error?:string}> {
  try {
    if(typeof key!=="string" || key.length>9000) throw new Error("Invalid key");
    const data=await authenticatedRequest(id,admin,"POST",action==="add"?"ssh-keys":"ssh-keys/remove",{publicKey:key}) as {accepted?:boolean};
    if(data.accepted!==true) throw new Error("Request rejected");
    return {accepted:true};
  } catch {return {accepted:false,error:"SSH key change not confirmed. Check task history before retrying."};}
}
