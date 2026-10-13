import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { runJudgeSlot, JUDGE_MODELS } from "@/lib/llm"
import { aggregateConsortium, type JudgeResponse } from "@/lib/aggregate"
import { makeBlindPacket, findKnownIdentifiers, redactPacket } from "@/lib/blind-packet"
import { digest } from "@/lib/canonical"
import type { BlindPacket, MarketRate, ReportContent } from "@/lib/contracts"

// POST /api/tasks/{id}/assess — create a new assessment round and run the 3×3 consortium.
// body: { reportId? }  (defaults to latest approved report)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const task = await db.task.findUnique({
    where: { id },
    include: { reportVersions: { orderBy: { version: "desc" } }, owner: true },
  })
  if (!task || task.ownerId !== user.id) return NextResponse.json({ error: "task not found" }, { status: 404 })

  const body = await req.json().catch(() => ({} as any))
  const report = body.reportId
    ? task.reportVersions.find((r) => r.id === body.reportId)
    : task.reportVersions[0]
  if (!report || report.status != "approved") {
    return NextResponse.json(
      { error: "Нет утверждённого отчёта для оценки. Сначала создайте отчёт." },
      { status: 400 },
    )
  }

  // fetch latest market rate card + active model profile
  const [rateCardVersion, profile, members] = await Promise.all([
    db.rateCardVersion.findFirst({ where: { kind: "market", workspaceId: user.workspaceId }, orderBy: { version: "desc" } }),
    db.modelProfile.findFirst({ where: { active: true, workspaceId: user.workspaceId } }),
    db.user.findMany({ where: { active: true, workspaceId: user.workspaceId }, select: { displayName: true } }),
  ])

  // build MarketRate[] from the stored rate card version
  const marketRates: MarketRate[] = rateCardVersion
    ? (JSON.parse(rateCardVersion.contentJson).rates ?? []).map((r: any) => ({
        rate_id: r.id,
        category: String(r.role).toLowerCase(),
        grade: String(r.qualification).toLowerCase() as MarketRate["grade"],
        currency: r.currency,
        low_minor_per_hour: r.low,
        high_minor_per_hour: r.high,
        basis: "contractor_hour" as const,
        market: r.market,
        provenance: "team_assumption" as const,
        source: r.source,
        checked_on: new Date(r.sourceDate).toISOString().slice(0, 10),
      }))
    : []

  // build the report content (must conform to ReportContent shape for makeBlindPacket)
  const reportContent: ReportContent = (() => {
    const rc = JSON.parse(report.contentJson || "{}")
    // if the stored report already has the full ReportContent shape, use it;
    // otherwise synthesize a minimal valid ReportContent from the legacy fields.
    if (rc.excerpts && rc.result && rc.result_status) return rc as ReportContent
    return {
      goal: rc.goal ?? task.title,
      actions: [],
      result: { text: rc.result ?? task.description ?? "Результат не описан", basis: "participant_statement", evidence_ids: ["e-statement"] },
      result_status: "unknown",
      excerpts: [
        {
          evidence_id: "e-statement",
          artifact_id: null,
          locator: null,
          kind: "participant_statement",
          text: rc.goal ?? task.title,
        },
      ],
      omitted_material: [],
      limitations: rc.constraints ? [rc.constraints] : [],
      suggested_task_split: [],
    }
  })()

  // allowlist projection → BlindPacket (re-numbers evidence IDs, structurally forbids identity)
  const rawPacket = makeBlindPacket(reportContent, {
    packetId: `pkt-${task.id.slice(-8)}-r${(await db.assessmentRound.count({ where: { taskId: task.id } })) + 1}`,
    scope: task.title,
    availableTools: ["AI coding assistant", "документация"],
    constraints: ["Бесплатный старт; 5 участников.", "Без обязательных платных подписок."],
    rates: marketRates,
    rateCardId: `rc-${rateCardVersion?.version ?? 1}`,
    visualReviewRequired: Boolean(JSON.parse(report.contentJson || "{}").visualReviewRequired),
  })

  // redact known member names from natural-language text + flag any leakage
  const memberNames = members.map((m) => m.displayName)
  const packet = redactPacket(rawPacket, memberNames)
  const leaked = findKnownIdentifiers(packet, memberNames)
  if (leaked.length > 0) {
    return NextResponse.json(
      { error: "В пакете осталось известное имя участника; замените его перед оценкой", leaked },
      { status: 422 },
    )
  }

  const packetJson = JSON.stringify(packet)
  const packetHash = digest(packet)
  const visualReviewRequired = packet.visual_review_required

  // determine round number
  const existingRounds = await db.assessmentRound.count({ where: { taskId: task.id } })
  const number = existingRounds + 1

  const round = await db.assessmentRound.create({
    data: {
      taskId: task.id,
      reportId: report.id,
      number,
      packetJson,
      packetHash,
      rulesVersion: 1,
      rateCardVersion: rateCardVersion?.version ?? 1,
      modelProfileId: profile?.id,
      modelConfigHash: digest(profile ? JSON.parse(profile.modelsJson) : {}),
      status: "running",
      visualReviewRequired,
      simulationMode: false,
    },
  })

  await db.task.update({ where: { id: task.id }, data: { activeAssessmentId: round.id, status: "assessing" } })

  // create 9 slots queued
  const slots: ReturnType<typeof db.judgeRun.create>[] = []
  for (const modelKey of JUDGE_MODELS) {
    for (let s = 1; s <= 3; s++) {
      slots.push(
        db.judgeRun.create({
          data: { assessmentId: round.id, modelKey, sampleIndex: s, attempt: 1, status: "queued" },
        }),
      )
    }
  }
  const created = await Promise.all(slots)

  // Run judges sequentially (one model family at a time, per spec §5).
  const responses: JudgeResponse[] = []
  let validCount = 0
  for (const modelKey of JUDGE_MODELS) {
    for (let s = 1; s <= 3; s++) {
      const slot = created.find((c) => c.modelKey === modelKey && c.sampleIndex === s)!
      try {
        await db.judgeRun.update({ where: { id: slot.id }, data: { status: "running" } })
        const result = await runJudgeSlot(modelKey, s, packet, marketRates)
        const respJson = JSON.stringify({
          ...result.answer,
          priceLow: result.priceLow,
          priceHigh: result.priceHigh,
          parseError: result.parseError, metadata: result.metadata, raw: result.raw,
        })
        await db.judgeRun.update({
          where: { id: slot.id },
          data: { status: "done", responseJson: respJson, error: result.parseError ?? "" },
        })
        responses.push({
          modelKey,
          sampleIndex: s,
          assessable: result.answer.assessment === "assessable",
          workType: result.answer.category,
          qualification: result.answer.grade,
          complexity: result.answer.complexity ?? undefined,
          hoursLow: result.answer.typical_duration ? result.answer.typical_duration.low_seconds / 3600 : undefined,
          hoursHigh: result.answer.typical_duration ? result.answer.typical_duration.high_seconds / 3600 : undefined,
          rateCardRowId: result.answer.rate_id ?? "no_price_data",
          completeness: result.answer.missing_information.length === 0 ? "sufficient" : "insufficient",
          evidenceId: result.answer.evidence_ids[0] ?? "",
          rationale: result.answer.rationale,
          priceLow: result.priceLow,
          priceHigh: result.priceHigh,
          priceStatus: result.answer.price_status,
          rateId: result.answer.rate_id,
        })
        if (result.answer.assessment === "assessable") validCount++
      } catch (e: any) {
        await db.judgeRun.update({
          where: { id: slot.id },
          data: { status: "failed", error: String(e?.message ?? e).slice(0, 500) },
        })
      }
    }
  }

  // aggregate (median-of-medians + invariants; financialEffectMinor always 0)
  const agg = aggregateConsortium(responses, visualReviewRequired)
  const status = responses.length === JUDGE_MODELS.length * 3 ? "done" : validCount > 0 ? "partial" : "failed"
  const updated = await db.assessmentRound.update({
    where: { id: round.id },
    data: { status, aggregateJson: JSON.stringify(agg) },
  })

  // record a job for traceability
  await db.job.create({
    data: {
      kind: "assess",
      businessKey: `task:${task.id}:round:${number}`,
      payloadJson: JSON.stringify({ taskId: task.id, roundId: round.id }),
      state: "done",
      actorId: user.id,
    },
  })

  return NextResponse.json({ round: updated, aggregate: agg, validCount, totalCount: JUDGE_MODELS.length * 3 })
}
