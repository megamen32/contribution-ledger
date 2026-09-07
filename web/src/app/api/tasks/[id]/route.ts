import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/tasks/{id} — full task detail with allocations, reports, assessments, ledger
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const task = await db.task.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, displayName: true, color: true } },
      allocations: {
        include: { session: { select: { id: true, project: true, startedAt: true } } },
        orderBy: { id: "asc" },
      },
      reportVersions: { orderBy: { version: "desc" } },
      assessmentRounds: {
        orderBy: { number: "desc" },
        include: { _count: { select: { judgeRuns: true } } },
      },
      ledgerEntries: { orderBy: { createdAt: "desc" } },
      sessions: { orderBy: { startedAt: "desc" }, take: 50 },
    },
  })
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ task })
}

// PATCH /api/tasks/{id} — update status/category/etc. with revision check
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const task = await db.task.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (body.revision !== undefined && body.revision !== task.revision) {
    return NextResponse.json(
      { error: "revision mismatch", current: task },
      { status: 409 },
    )
  }
  const data: any = { revision: { increment: 1 } }
  if (body.title) data.title = body.title
  if (body.description !== undefined) data.description = body.description
  if (body.status) data.status = body.status
  if (body.category !== undefined) data.category = body.category
  if (body.complexity !== undefined) data.complexity = body.complexity ? Number(body.complexity) : null
  const updated = await db.task.update({ where: { id }, data })
  return NextResponse.json({ task: updated })
}
