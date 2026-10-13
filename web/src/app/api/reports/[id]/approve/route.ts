import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// POST /api/reports/{id}/approve — approve a report draft, create anonymized packet version
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const report = await db.reportVersion.findUnique({ where: { id }, include: { task: true } })
  if (!report || report.task.ownerId !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (report.status === "approved") {
    return NextResponse.json({ report, alreadyApproved: true })
  }

  const updated = await db.reportVersion.update({
    where: { id },
    data: { status: "approved", authorApprovedAt: new Date() },
  })

  // link task currentReportId
  if (report.task) {
    await db.task.update({
      where: { id: report.taskId },
      data: { currentReportId: id, status: "needs_report" },
    })
  }

  return NextResponse.json({ report: updated })
}
