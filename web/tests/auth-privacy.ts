import * as argon2 from "argon2"
import { PrismaClient } from "@prisma/client"
import { authOptions } from "../src/lib/auth-options"
import { hashPassword, newInviteToken, tokenHash } from "../src/lib/account"
const db = new PrismaClient(); const authorize:any=(authOptions.providers[0] as any).options.authorize; const suffix=crypto.randomUUID().slice(0,8); const pa="Synthetic-A-Password-123!", pb="Synthetic-B-Password-123!"
const a=await db.user.create({data:{displayName:"Synthetic A",email:`a-${suffix}@test.invalid`,role:"admin"}}); await db.userCredential.create({data:{userId:a.id,login:`a-${suffix}`,passwordHash:await hashPassword(pa)}})
const b=await db.user.create({data:{displayName:"Synthetic B",email:`b-${suffix}@test.invalid`}}); await db.userCredential.create({data:{userId:b.id,login:`b-${suffix}`,passwordHash:await hashPassword(pb)}})
if((await authorize({login:`a-${suffix}`,password:pa},{}))?.id!==a.id || await authorize({login:`a-${suffix}`,password:"Wrong-Password-123!"},{})!==null) throw new Error("credential check failed")
const ta=await db.task.create({data:{title:"Private A",ownerId:a.id}}), tb=await db.task.create({data:{title:"Private B",ownerId:b.id,sharedWithTeam:true}}); const mine=await db.task.findMany({where:{ownerId:a.id}}), team=await db.task.findMany({where:{sharedWithTeam:true}}); if(mine.some(t=>t.id===tb.id)||team.some(t=>t.id===ta.id)||!team.some(t=>t.id===tb.id)) throw new Error("privacy query failed")
const token=newInviteToken(), invitation=await db.inviteToken.create({data:{tokenHash:tokenHash(token),createdById:a.id,expiresAt:new Date(Date.now()+10000)}}); if((await db.inviteToken.findUnique({where:{tokenHash:tokenHash(token)}}))?.id!==invitation.id) throw new Error("invite hash failed"); const hash=await hashPassword("Another-Synthetic-Password-123!"); if(!(await argon2.verify(hash,"Another-Synthetic-Password-123!"))) throw new Error("argon2 verify failed")
console.log(JSON.stringify({passed:true,checks:["argon2id credentials","wrong password rejected","private task query","explicit team publication","invite stored by hash"]})); await db.$disconnect()
