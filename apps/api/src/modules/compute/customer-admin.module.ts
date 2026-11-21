import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Patch, Req, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import type { Request } from "express";
import { AuthModule } from "../auth/auth.module";
import { SessionService } from "../auth/services/session.service";
import { PrismaService } from "../database/prisma.module";
import type { Prisma } from "@prisma/client";

@Controller("compute/admin/customers")
class CustomerAdminController {
  constructor(private readonly prisma: PrismaService, private readonly sessions: SessionService) {}
  private async actor(req: Request) {
    const token=(req.headers.cookie??"").split(";").map(x=>x.trim()).find(x=>x.startsWith("kiiro_session="))?.slice(14);
    if(!token||!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new UnauthorizedException();
    const session=await this.sessions.validate(token);
    if(!session) throw new UnauthorizedException();
    if(session.user.role!=="admin") throw new ForbiddenException();
    return session.userId;
  }
  @Get(":userId")
  async detail(@Req() req:Request,@Param("userId") userId:string) {
    await this.actor(req);
    const user=await this.prisma.user.findUnique({where:{id:userId},select:{
      id:true,email:true,role:true,status:true,emailVerifiedAt:true,lastLoginAt:true,createdAt:true,
      customer:{select:{id:true,displayName:true,companyName:true,countryCode:true,timezone:true,phone:true,billingEmail:true,addressLine1:true,addressLine2:true,city:true,state:true,postalCode:true,taxId:true,adminNotes:true,createdAt:true,updatedAt:true,
        instances:{where:{deletedAt:null},orderBy:{createdAt:"desc"},take:50,select:{id:true,name:true,status:true,vcpu:true,memoryMb:true,diskGb:true,createdAt:true,provider:{select:{name:true}},node:{select:{name:true}},region:{select:{name:true,code:true}}}},
        wallet:{select:{id:true,currency:true,createdAt:true,entries:{orderBy:{createdAt:"desc"},take:50,select:{id:true,amountMinor:true,currency:true,createdAt:true,transaction:{select:{description:true,referenceType:true,referenceId:true}}}}}},
        invoices:{orderBy:{createdAt:"desc"},take:25,select:{id:true,number:true,status:true,currency:true,totalMinor:true,dueAt:true,paidAt:true,createdAt:true}},
        subscriptions:{orderBy:{createdAt:"desc"},take:25,select:{id:true,status:true,currency:true,amountMinor:true,interval:true,currentPeriodStart:true,currentPeriodEnd:true,cancelAtPeriodEnd:true}},
        tickets:{orderBy:{updatedAt:"desc"},take:25,select:{id:true,subject:true,status:true,priority:true,createdAt:true,updatedAt:true}}
      }},
      sessions:{orderBy:{createdAt:"desc"},take:30,select:{id:true,ipAddress:true,userAgent:true,createdAt:true,expiresAt:true,revokedAt:true,mfaVerifiedAt:true}}
    }});
    if(!user) throw new NotFoundException("User not found");
    const entries=user.customer?.wallet?.entries??[];
    const balanceMinor=entries.reduce((sum,e)=>sum+e.amountMinor,0n);
    return {...user,customer:user.customer?{...user.customer,wallet:user.customer.wallet?{...user.customer.wallet,entries:entries.map(e=>({...e,amountMinor:e.amountMinor.toString()})),balanceMinor:balanceMinor.toString()}:null,invoices:user.customer.invoices.map(x=>({...x,totalMinor:x.totalMinor.toString()})),subscriptions:user.customer.subscriptions.map(x=>({...x,amountMinor:x.amountMinor.toString()}))}:null};
  }
  @Patch(":customerId")
  async update(@Req() req:Request,@Param("customerId") customerId:string,@Body() body:unknown) {
    const actor=await this.actor(req);
    if(!body||typeof body!=="object"||Array.isArray(body)) throw new BadRequestException("JSON object required");
    const input=body as Record<string,unknown>;
    const fields=["displayName","companyName","countryCode","timezone","phone","billingEmail","addressLine1","addressLine2","city","state","postalCode","taxId","adminNotes"] as const;
    const data = {} as Prisma.CustomerUpdateInput;
    for(const key of fields) if(key in input) {
      const value=input[key];
      if(key==="timezone"&&(value===null||typeof value!=="string"||!value.trim())) throw new BadRequestException("Timezone is required");\n      if(value!==null&&(typeof value!=="string"||value.length>(key==="addressLine1"||key==="addressLine2"?200:key==="displayName"?160:key==="adminNotes"?10000:320))) throw new BadRequestException("Invalid "+key);
      if(key==="countryCode"&&value!==null&&!/^[A-Za-z]{2}$/.test(String(value))) throw new BadRequestException("Country code must be ISO alpha-2");
      Object.assign(data,{[key]:typeof value==="string"?value.trim()||null:value});
    }
    if(!Object.keys(data).length) throw new BadRequestException("No editable customer fields supplied");
    return this.prisma.$transaction(async tx=>{
      const before=await tx.customer.findUnique({where:{id:customerId},select:{id:true,displayName:true,companyName:true,countryCode:true,timezone:true,phone:true,billingEmail:true,addressLine1:true,addressLine2:true,city:true,state:true,postalCode:true,taxId:true,adminNotes:true}});
      if(!before) throw new NotFoundException("Customer not found");
      const after=await tx.customer.update({where:{id:customerId},data,select:{id:true,displayName:true,companyName:true,countryCode:true,timezone:true,phone:true,billingEmail:true,addressLine1:true,addressLine2:true,city:true,state:true,postalCode:true,taxId:true}});
      await tx.auditLog.create({data:{userId:actor,action:"CUSTOMER_PROFILE_UPDATED",entityType:"CUSTOMER",entityId:customerId,metadata:{before,after}}});
      return after;
    });
  }
}
@Module({imports:[AuthModule],controllers:[CustomerAdminController]})
export class CustomerAdminModule {}
