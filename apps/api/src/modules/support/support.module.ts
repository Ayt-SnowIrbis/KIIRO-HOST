import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaModule, PrismaService } from "../database/prisma.module";

type Actor={userId:string;role:"admin"|"user";customerId:string|null};
@Controller()
class SupportController {
  constructor(private readonly db:PrismaService,private readonly sessions:SessionService){}
  private async actor(req:Request):Promise<Actor>{
    const token=(req.headers.cookie??"").split(";").map(v=>v.trim()).find(v=>v.startsWith("kiiro_session="))?.slice(14);
    if(!token||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new UnauthorizedException();
    const s=await this.sessions.validate(token);if(!s)throw new UnauthorizedException();
    const role=s.user.role as "admin"|"user";
    const c=role==="user"?await this.db.customer.findUnique({where:{userId:s.userId},select:{id:true}}):null;
    if(role==="user"&&!c)throw new ForbiddenException("Customer profile required");
    return {userId:s.userId,role,customerId:c?.id??null};
  }
  private admin(a:Actor){if(a.role!=="admin")throw new ForbiddenException("Administrator required");}
  private obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw new BadRequestException("JSON object required");return v as Record<string,unknown>;}
  private str(v:unknown,n:string,max:number){if(typeof v!=="string"||!v.trim()||v.trim().length>max)throw new BadRequestException("Invalid "+n);return v.trim();}
  private id(v:string){if(!/^[A-Za-z0-9_-]{1,128}$/.test(v))throw new BadRequestException("Invalid ticket ID");}
  @Get("support/tickets")
  async customerList(@Req()r:Request){const a=await this.actor(r);if(a.role!=="user"||!a.customerId)throw new ForbiddenException();return this.db.supportTicket.findMany({where:{customerId:a.customerId},orderBy:{updatedAt:"desc"},take:100,select:{id:true,subject:true,category:true,status:true,priority:true,createdAt:true,updatedAt:true,messages:{where:{internalNote:false},orderBy:{createdAt:"desc"},take:1,select:{body:true,createdAt:true}}}});}
  @Post("support/tickets")
  async create(@Req()r:Request,@Body()raw:unknown){const a=await this.actor(r);if(a.role!=="user"||!a.customerId)throw new ForbiddenException();const b=this.obj(raw),subject=this.str(b.subject,"subject",200),message=this.str(b.message,"message",10000),category=typeof b.category==="string"&&/^[A-Z_]{2,32}$/.test(b.category)?b.category:"GENERAL";
    return this.db.$transaction(async tx=>{const t=await tx.supportTicket.create({data:{customerId:a.customerId!,subject,category,status:"OPEN",priority:"NORMAL",messages:{create:{authorId:a.userId,body:message}}},include:{messages:{orderBy:{createdAt:"asc"}}}});await tx.outboxEvent.create({data:{eventType:"SUPPORT_TICKET_CREATED",aggregateId:t.id,payload:{ticketId:t.id,customerId:a.customerId,subject}}});await tx.auditLog.create({data:{userId:a.userId,action:"SUPPORT_TICKET_CREATED",entityType:"SUPPORT_TICKET",entityId:t.id,ipAddress:r.ip}});return t;});}
  @Get("support/tickets/:id")
  async customerGet(@Req()r:Request,@Param("id")id:string){const a=await this.actor(r);if(a.role!=="user"||!a.customerId)throw new ForbiddenException();this.id(id);const t=await this.db.supportTicket.findFirst({where:{id,customerId:a.customerId},include:{messages:{where:{internalNote:false},orderBy:{createdAt:"asc"},select:{id:true,body:true,authorId:true,createdAt:true}}}});if(!t)throw new NotFoundException();return t;}
  @Post("support/tickets/:id/messages")
  async customerReply(@Req()r:Request,@Param("id")id:string,@Body()raw:unknown){const a=await this.actor(r);if(a.role!=="user"||!a.customerId)throw new ForbiddenException();const customerId=a.customerId;this.id(id);const message=this.str(this.obj(raw).message,"message",10000);return this.db.$transaction(async tx=>{const t=await tx.supportTicket.findFirst({where:{id,customerId}});if(!t)throw new NotFoundException();if(t.status==="CLOSED")throw new ConflictException("Ticket is closed");const m=await tx.supportMessage.create({data:{ticketId:id,authorId:a.userId,body:message}});await tx.supportTicket.update({where:{id},data:{status:"OPEN"}});await tx.outboxEvent.create({data:{eventType:"SUPPORT_CUSTOMER_REPLIED",aggregateId:id,payload:{ticketId:id,messageId:m.id}}});await tx.auditLog.create({data:{userId:a.userId,action:"SUPPORT_CUSTOMER_REPLIED",entityType:"SUPPORT_TICKET",entityId:id,ipAddress:r.ip}});return m;});}
  @Get("compute/admin/support/tickets")
  async adminList(@Req()r:Request,@Query("status")status?:string){const a=await this.actor(r);this.admin(a);const states=["OPEN","IN_PROGRESS","WAITING_CUSTOMER","RESOLVED","CLOSED"];if(status&&!states.includes(status))throw new BadRequestException("Invalid status");return this.db.supportTicket.findMany({where:status?{status}:undefined,orderBy:{updatedAt:"desc"},take:200,select:{id:true,subject:true,category:true,status:true,priority:true,updatedAt:true,assignedToId:true,customer:{select:{id:true,displayName:true,user:{select:{email:true}}}},messages:{orderBy:{createdAt:"desc"},take:1,select:{body:true,internalNote:true}}}});}
  @Get("compute/admin/support/tickets/:id")
  async adminGet(@Req()r:Request,@Param("id")id:string){const a=await this.actor(r);this.admin(a);this.id(id);const t=await this.db.supportTicket.findUnique({where:{id},include:{customer:{select:{id:true,displayName:true,user:{select:{email:true}}}},assignedTo:{select:{id:true,email:true}},messages:{orderBy:{createdAt:"asc"},select:{id:true,body:true,authorId:true,internalNote:true,createdAt:true,author:{select:{email:true,role:true}}}}}});if(!t)throw new NotFoundException();return t;}
  @Patch("compute/admin/support/tickets/:id")
  async adminUpdate(@Req()r:Request,@Param("id")id:string,@Body()raw:unknown){const a=await this.actor(r);this.admin(a);this.id(id);const b=this.obj(raw),d:{status?:string;priority?:string;assignedToId?:string|null}={};if("status"in b){d.status=this.str(b.status,"status",32);if(!["OPEN","IN_PROGRESS","WAITING_CUSTOMER","RESOLVED","CLOSED"].includes(d.status))throw new BadRequestException("Invalid status");}if("priority"in b){d.priority=this.str(b.priority,"priority",24);if(!["LOW","NORMAL","HIGH","URGENT"].includes(d.priority))throw new BadRequestException("Invalid priority");}if("assignedToId"in b){if(b.assignedToId===null||b.assignedToId==="")d.assignedToId=null;else{const uid=this.str(b.assignedToId,"assignee",128),u=await this.db.user.findFirst({where:{id:uid,role:"ADMIN",status:"ACTIVE"},select:{id:true}});if(!u)throw new BadRequestException("Assignee must be an active administrator");d.assignedToId=u.id;}}if(!Object.keys(d).length)throw new BadRequestException("No fields supplied");return this.db.$transaction(async tx=>{const before=await tx.supportTicket.findUnique({where:{id}});if(!before)throw new NotFoundException();const after=await tx.supportTicket.update({where:{id},data:d});await tx.auditLog.create({data:{userId:a.userId,action:"SUPPORT_TICKET_UPDATED",entityType:"SUPPORT_TICKET",entityId:id,metadata:{before:{status:before.status,priority:before.priority,assignedToId:before.assignedToId},after:d}}});return after;});}
  @Post("compute/admin/support/tickets/:id/messages")
  async adminReply(@Req()r:Request,@Param("id")id:string,@Body()raw:unknown){const a=await this.actor(r);this.admin(a);this.id(id);const b=this.obj(raw),message=this.str(b.message,"message",10000),internalNote=b.internalNote===true;return this.db.$transaction(async tx=>{const t=await tx.supportTicket.findUnique({where:{id},select:{id:true,status:true}});if(!t)throw new NotFoundException();if(t.status==="CLOSED"&&!internalNote)throw new ConflictException("Reopen before replying");const m=await tx.supportMessage.create({data:{ticketId:id,authorId:a.userId,body:message,internalNote}});if(!internalNote){await tx.supportTicket.update({where:{id},data:{status:"WAITING_CUSTOMER"}});await tx.outboxEvent.create({data:{eventType:"SUPPORT_ADMIN_REPLIED",aggregateId:id,payload:{ticketId:id,messageId:m.id}}});}await tx.auditLog.create({data:{userId:a.userId,action:internalNote?"SUPPORT_INTERNAL_NOTE_ADDED":"SUPPORT_ADMIN_REPLIED",entityType:"SUPPORT_TICKET",entityId:id,metadata:{messageId:m.id}}});return m;});}
}
@Module({imports:[AuthModule,PrismaModule],controllers:[SupportController]})
export class SupportModule {}
