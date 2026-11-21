"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getApiBaseUrl } from "@/lib/config";
export async function updateCustomerProfile(formData:FormData){
 const customerId=String(formData.get("customerId")??"");
 const userId=String(formData.get("userId")??"");
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(customerId)||!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) throw new Error("Invalid customer");
 const allowed=["displayName","companyName","countryCode","timezone","phone","billingEmail","addressLine1","addressLine2","city","state","postalCode","taxId","adminNotes"];
 const body:Record<string,string|null>={};
 for(const key of allowed){const v=formData.get(key);if(typeof v==="string"){if(key==="timezone"&&!v.trim())continue;body[key]=v.trim()||null;}}
 const cookie=(await cookies()).get("kiiro_session")?.value;
 if(!cookie) throw new Error("Administrator session unavailable");
 const response=await fetch(`${getApiBaseUrl().replace(/\/$/,"")}/compute/admin/customers/${customerId}`,{method:"PATCH",headers:{Cookie:`kiiro_session=${cookie}`,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
 if(!response.ok){const p=await response.json().catch(()=>null);throw new Error(p&&typeof p.message==="string"?p.message:`Profile update failed (${response.status})`);}
 revalidatePath("/admin/users"); revalidatePath(`/admin/users/${userId}`);
}
