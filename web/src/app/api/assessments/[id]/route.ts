import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { aggregateConsortium, type JudgeResponse } from "@/lib/aggregate"

// GET /api/assessments/{id} — full assessment round with all 9 judge runs + aggregate
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const round = await db.assessmentRound.findUnique({
    where: { id },
    include: {
      task: { select: { id: true, title: true, category: true } },
      report: { select: { id: true, version: true } },
      judgeRuns: { orderBy: [{ modelKey: "asc" }, { sampleIndex: "asc" }] },
    },
  })
  if (!round) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ round })
}
