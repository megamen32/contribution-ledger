// Focused integration: SQLite + real handlers and membership resolver. Expected 10s, max 30s.
// Detects stale global roles, mixed scopes after switching, invitation replays, and duplicate postings.
import assert from "node:assert/strict"
import { mock } from "bun:test"
import { NextRequest } from "next/server"
import { PrismaClient } from "@prisma/client"
assert.ok(process.env.DATABASE_URL?.includes("test-multi-projects"), "Isolated database required")
const db = new PrismaClient()
const { resolveProjectUser, selectedProject, availableProjects } = await import("../src/lib/project-membership")
let uid = ""; let active: string | undefined
mock.module("@/lib/auth", () => ({ getCurrentUser: async () => uid ? resolveProjectUser(uid,active) : null }))
const reg=await import("../src/app/api/account/register/route")
const invite=await import("../src/app/api/account/invite/route")
const accept=await import("../src/app/api/account/invite/accept/route")
const switcher=await import("../src/app/api/projects/switch/route")
const tasks=await import("../src/app/api/tasks/route")
const task=await import("../src/app/api/tasks/[id]/route")
const ledger=await import("../src/app/api/ledger/route")
const reverse=await import("../src/app/api/ledger/entries/[id]/reverse/route")
const rates=await import("../src/app/api/rate-cards/route")
const sessions=await import("../src/app/api/sessions/route")
const session=await import("../src/app/api/sessions/[id]/route")
const team=await import("../src/app/api/team/route")
const personal=await import("../src/app/api/team/me/route")
const req=(body:any={})=>new NextRequest("http://test.invalid/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
const get=(url="/")=>new NextRequest("http://test.invalid"+url)
const ctx=(id:string)=>({params:Promise.resolve({id})})
try {
 assert.equal((await accept.POST(req({invite:"x"}))).status,401)
 const account=async(login:string)=>{const r=await reg.POST(req({login,displayName:login,password:"synthetic-multi-project-check",projectName:login})); assert.equal(r.status,201);return r.json()}
 const a=await account("owner_a"),b=await account("owner_b"),c=await account("owner_c")
 uid=b.user.id;active=b.project.id
 assert.equal((await rates.POST(req({ratePerHourMinor:100000}))).status,201)
 const ownTask=(await (await tasks.POST(req({title:"Home B work"}))).json()).task
 const cash=(await (await ledger.POST(req({kind:"cash_contribution",amountMinor:10000,businessKey:"same"}))).json()).entry
 const started=(await (await sessions.POST(req({project:"Home B timer"}))).json()).session
 assert.equal((await session.PATCH(req({action:"stop"}),ctx(started.id))).status,200)
 uid=a.user.id;active=a.project.id
 const link=(await (await invite.POST()).json()).url
 const token=new URLSearchParams(new URL(link).hash.slice(1)).get("invite")!
 uid=b.user.id;active=b.project.id
 const joined=await accept.POST(req({invite:token}));assert.equal(joined.status,200)
 assert.equal((await joined.json()).project.id,a.project.id)
 assert.ok(joined.headers.get("set-cookie")?.includes("HttpOnly"))
 active=a.project.id
 assert.equal((await resolveProjectUser(uid,active))?.role,"member")
 assert.equal((await invite.POST()).status,403,"Home-project owner must not become admin of the invited project")
 assert.equal((await availableProjects(uid)).length,2)
 assert.equal((await task.GET(get(),ctx(ownTask.id))).status,404)
 assert.equal((await session.GET(get(),ctx(started.id))).status,404)
 assert.equal((await session.PATCH(req({action:"finalize"}),ctx(started.id))).status,404)
 assert.equal((await reverse.POST(req(),ctx(cash.id))).status,404)
 assert.equal((await (await rates.GET()).json()).agreed.length,0)
 assert.equal((await (await personal.GET()).json()).sessions.length,0)
 assert.equal((await (await tasks.GET(get())).json()).tasks.length,0)
 assert.equal((await (await team.GET()).json()).members.length,2)
 assert.equal((await ledger.POST(req({kind:"cash_contribution",amountMinor:20000,businessKey:"same"}))).status,200)
 assert.equal((await rates.POST(req({ratePerHourMinor:200000}))).status,201)
 const foreignWork=await tasks.POST(req({title:"B work in A",manualSeconds:3600}));assert.equal(foreignWork.status,200)
 assert.equal((await (await ledger.GET(get())).json()).entries.reduce((s:number,e:any)=>s+e.amountMinor,0),220000)
 const claimed=await db.inviteToken.findUniqueOrThrow({where:{tokenHash:(await import("../src/lib/account")).tokenHash(token)}})
 assert.equal(claimed.usedById,uid)
 assert.equal((await accept.POST(req({invite:token}))).status,200,"Same accepted receipt can be confirmed again")
 assert.equal((await db.inviteToken.findUniqueOrThrow({where:{id:claimed.id}})).usedAt?.getTime(),claimed.usedAt?.getTime())
 assert.equal((await switcher.POST(req({projectId:c.project.id}))).status,403)
 assert.equal(selectedProject(JSON.stringify({userId:a.user.id,projectId:a.project.id}),uid),undefined,"Cookie must belong to this account")
 assert.equal((await switcher.POST(req({projectId:b.project.id}))).status,200)
 active=b.project.id
 assert.equal((await resolveProjectUser(uid,active))?.role,"admin")
 assert.equal((await (await ledger.GET(get())).json()).entries.length,1)
 assert.equal((await (await team.GET()).json()).totals.contribution,10000)
 assert.equal((await (await rates.GET()).json()).agreed[0].ratePerHourMinor,100000)
 assert.equal((await (await tasks.GET(get())).json()).tasks[0].id,ownTask.id)
 assert.equal((await (await sessions.GET(get())).json()).sessions[0].id,started.id)
 uid=c.user.id;active=c.project.id
 assert.equal((await accept.POST(req({invite:token}))).status,403)
 assert.equal((await availableProjects(uid)).length,1)
 console.log("PASS: existing-account joining, per-project roles, switch permissions, scoped work/rates/ledger/timers and idempotent invitation receipt")
} finally { await db.$disconnect() }
