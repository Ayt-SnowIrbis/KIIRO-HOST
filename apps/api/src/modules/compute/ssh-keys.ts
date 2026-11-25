import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.module";

const validId = /^[A-Za-z0-9_-]{1,128}$/;
const validKey = /^(ssh-ed25519|ecdsa-sha2-nistp256|rsa-sha2-256|rsa-sha2-512|ssh-rsa) [A-Za-z0-9+/]{32,8192}={0,2}(?: [a-zA-Z0-9@._-]{1,80})?$/;
function obj(v:unknown):Record<string,unknown> {return v && typeof v==="object" && !Array.isArray(v) ? v as Record<string,unknown> : {};}
export function checkedKey(v:unknown):string {
  if(typeof v!=="string" || v.length>9000 || !validKey.test(v)) throw new BadRequestException("Invalid SSH public key");
  return v;
}
export async function listManagedSshKeys(db:PrismaService,id:string,customerId?:string) {
  if (!validId.test(id)) throw new BadRequestException("Invalid instance ID");
  const instance = await db.instance.findFirst({where:{id,deletedAt:null,...(customerId?{customerId}:{})},select:{metadata:true}});
  if(!instance) throw new NotFoundException("Instance not found");
  const keys = obj(instance.metadata).sshPublicKeys;
  return {keys: Array.isArray(keys) ? keys.filter((v):v is string=>typeof v==="string" && validKey.test(v)) : []};
}
export async function queueSshKey(db:PrismaService,id:string,actorId:string,action:"add"|"remove",rawKey:unknown,customerId?:string) {
  if(!validId.test(id)) throw new BadRequestException("Invalid instance ID");
  const key=checkedKey(rawKey);
  const fingerprint=createHash("sha256").update(key).digest("hex").slice(0,16);
  return db.$transaction(async tx=>{
    // Ownership is enforced in SQL BEFORE revealing instance state.
    const locked=customerId ? await tx.$queryRaw<{id:string}[]>`SELECT id FROM instances WHERE id=${id} AND customer_id=${customerId} FOR UPDATE`
                            : await tx.$queryRaw<{id:string}[]>`SELECT id FROM instances WHERE id=${id} FOR UPDATE`;
    if(!locked.length) throw new NotFoundException("Instance not found");
    const i=await tx.instance.findUnique({where:{id},include:{node:true,provider:true}});
    if(!i || i.deletedAt || (customerId && i.customerId!==customerId)) throw new NotFoundException("Instance not found");
    const m=obj(i.metadata);
    const tracked=Array.isArray(m.sshPublicKeys) ? m.sshPublicKeys.filter((v):v is string=>typeof v==="string") : [];
    if(action==="remove" && !tracked.includes(key)) throw new ConflictException("Only panel-managed SSH keys can be removed");
    if(i.status!=="RUNNING" || i.kind!=="CONTAINER" || i.provider.slug!=="INCUS" || !i.externalId?.startsWith("kh-") ||
       m.mode!=="REAL" || m.provisioning!=="INCUS" || i.node.status!=="ONLINE" || !i.node.lastSeenAt ||
       Date.now()-i.node.lastSeenAt.getTime()>180000) throw new ConflictException("SSH keys require a running managed Incus container");
    if(await tx.task.findFirst({where:{instanceId:id,status:{in:["QUEUED","RUNNING"]}}})) throw new ConflictException("Instance already has an active task");
    const task=await tx.task.create({data:{instanceId:id,type:action==="add"?"SSH_KEY_ADD":"SSH_KEY_REMOVE",status:"QUEUED",maxAttempts:1,payload:{mode:"REAL",publicKey:key}},select:{id:true,status:true}});
    await tx.auditLog.create({data:{userId:actorId,action:action==="add"?"INSTANCE_SSH_KEY_ADD_QUEUED":"INSTANCE_SSH_KEY_REMOVE_QUEUED",entityType:"INSTANCE",entityId:id,metadata:{taskId:task.id,keyFingerprint:fingerprint}}});
    return {accepted:true,task};
  });
}
