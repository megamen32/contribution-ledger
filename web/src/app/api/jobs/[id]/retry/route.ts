import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// POST /api/jobs/{id}/retry — requeue a failed job
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const job = await db.job.findUnique({ where: { id } })
  if (!job || job.actorId !== user.id || job.workspaceId !== user.workspaceId) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (job.state !== "failed" && job.state !== "cancelled") {
    return NextResponse.json({ error: "job not in failed/cancelled state" }, { status: 409 })
  }
  const updated = await db.job.update({
    where: { id },
    data: { state: "queued", attempts: 0, lastError: "", nextAttemptAt: new Date(), actorId: user.id },
  })
  return NextResponse.json({ job: updated })
}
