import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { aggregateConsortium, migrateLegacyResponse, type JudgeResponse } from "@/lib/aggregate"

// POST /api/assessments/{id}/recalculate — re-aggregate stored responses WITHOUT calling LLM (spec §11)
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const round = await db.assessmentRound.findUnique({
    where: { id, task: { ownerId: user.id, workspaceId: user.workspaceId } },
    include: { judgeRuns: true },
  })
  if (!round) return NextResponse.json({ error: "not found" }, { status: 404 })

  const responses: JudgeResponse[] = round.judgeRuns
    .filter((r) => r.status === "done")
    .map((r) => {
      const v = JSON.parse(r.responseJson || "{}")
      return migrateLegacyResponse({ ...v, modelKey: r.modelKey, sampleIndex: r.sampleIndex })
    })

  const agg = aggregateConsortium(responses, round.visualReviewRequired)
  const updated = await db.assessmentRound.update({
    where: { id, task: { ownerId: user.id, workspaceId: user.workspaceId } },
    data: { aggregateJson: JSON.stringify(agg) },
  })
  return NextResponse.json({ round: updated, aggregate: agg })
}
