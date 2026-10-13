import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { postEntry } from "@/lib/ledger"
import { grossMinor } from "@/lib/money"

// GET /api/tasks?scope=mine|all&status=...
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const scope = sp.get("scope") ?? "mine"
  const status = sp.get("status")
  const where: any = scope === "team" ? { sharedWithTeam: true, workspaceId: user.workspaceId } : { ownerId: user.id, workspaceId: user.workspaceId }
  if (status) where.status = status

  const tasks = await db.task.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { owner: { select: { id: true, displayName: true, color: true } }, _count: { select: { sessions: true, assessmentRounds: true, ledgerEntries: true } } },
    take: 200,
  })
  if (scope === "team") return NextResponse.json({ tasks: tasks.map(task => ({ id: task.id, title: task.title, status: task.status, category: task.category, complexity: task.complexity, sharedWithTeam: true, updatedAt: task.updatedAt, owner: task.owner })) })
  return NextResponse.json({ tasks })
}

// POST /api/tasks — create task (manual work entry allowed)
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const { title, description, category, complexity, manualSeconds } = await req
    .json()
    .catch(() => ({} as any))
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 })

  const task = await db.task.create({
    data: {
      workspaceId: user.workspaceId,
      title,
      description: description ?? "",
      ownerId: user.id,
      status: "open",
      category: category ?? null,
      complexity: complexity ? Number(complexity) : null,
    },
    include: { owner: { select: { id: true, displayName: true, color: true } } },
  })

  // optional manual work entry -> allocation + labor ledger
  if (manualSeconds && Number(manualSeconds) > 0) {
    const secs = Math.floor(Number(manualSeconds))
    let rate: Awaited<ReturnType<typeof db.agreedLaborRate.findFirst>> = null
    if (task.category) {
      rate = await db.agreedLaborRate.findFirst({ orderBy: { effectiveFrom: "desc" }, where: { workspaceId: user.workspaceId, userId: user.id, category: task.category } })
    }
    if (!rate) rate = await db.agreedLaborRate.findFirst({ orderBy: { effectiveFrom: "desc" }, where: { workspaceId: user.workspaceId, userId: user.id } })
    const rateMinor = rate?.ratePerHourMinor ?? 0
    const laborMinor = Math.round((secs * rateMinor) / 3600)
    await db.taskAllocation.create({
      data: { taskId: task.id, userId: user.id, confirmedSeconds: secs, source: "manual" },
    })
    if (laborMinor > 0) {
      await postEntry({
        workspaceId: user.workspaceId,
        userId: user.id,
        kind: "labor",
        currency: rate?.currency ?? "RUB",
        amountMinor: grossMinor(secs, rateMinor),
        taskId: task.id,
        sourceId: `task-manual:${task.id}`,
        businessKey: `task-manual:${task.id}`,
        policyId: "honest-v1",
        targetEntryId: null,
        reason: `Ручной учёт труда по задаче «${title}»`,
        basis: `manual_seconds=${secs}; rate=${rateMinor}/h; rule_v1`,
      })
    }
    await db.task.update({ where: { id: task.id }, data: { status: "in_progress" } })
  }

  return NextResponse.json({ task })
}
