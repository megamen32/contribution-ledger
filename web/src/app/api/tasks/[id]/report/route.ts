import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// POST /api/tasks/{id}/report — create a new report version (draft or auto-approved).
// body: { content: {goal, actions[], result, unfinished, constraints, sources[], origins[]}, approve?: boolean }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const task = await db.task.findUnique({ where: { id } })
  if (!task || task.ownerId !== user.id || task.workspaceId !== user.workspaceId) return NextResponse.json({ error: "task not found" }, { status: 404 })

  const body = await req.json().catch(() => ({} as any))
  const content = body.content ?? {
    goal: task.title,
    actions: [],
    result: task.description,
    unfinished: "",
    constraints: "",
    sources: [],
    origins: [],
    completeness: "partial",
  }

  const existing = await db.reportVersion.count({ where: { taskId: id } })
  const version = existing + 1
  const approve = body.approve !== false

  const report = await db.reportVersion.create({
    data: {
      taskId: id,
      version,
      contentJson: JSON.stringify(content),
      sourcesManifest: JSON.stringify(content.sources ?? []),
      status: approve ? "approved" : "draft",
      authorApprovedAt: approve ? new Date() : null,
    },
  })

  if (approve) {
    await db.task.update({ where: { id }, data: { currentReportId: report.id, status: "needs_report" } })
  }

  return NextResponse.json({ report })
}
