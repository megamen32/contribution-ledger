import { projectMembers } from "@/lib/project-membership"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { makeBlindPacket, findKnownIdentifiers, redactPacket } from "@/lib/blind-packet"
import type { MarketRate, ReportContent } from "@/lib/contracts"

// GET /api/tasks/{id}/packet — preview the anonymized blind packet for a task (read-only).
// Uses the latest approved report; if none, synthesizes a minimal packet from the task.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const [task, rateCardVersion, members] = await Promise.all([
    db.task.findUnique({
      where: { id },
      include: { reportVersions: { orderBy: { version: "desc" }, take: 1 } },
    }),
    db.rateCardVersion.findFirst({ where: { kind: "market", workspaceId: user.workspaceId }, orderBy: { version: "desc" } }),
    projectMembers(user.workspaceId),
  ])
  if (!task || task.ownerId !== user.id || task.workspaceId !== user.workspaceId) return NextResponse.json({ error: "task not found" }, { status: 404 })

  const report = task.reportVersions[0]
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

  let reportContent: ReportContent
  if (report) {
    const rc = JSON.parse(report.contentJson || "{}")
    if (rc.excerpts && rc.result && rc.result_status) {
      reportContent = rc as ReportContent
    } else {
      reportContent = {
        goal: rc.goal ?? task.title,
        actions: [],
        result: { text: rc.result ?? task.description ?? "Результат не описан", basis: "participant_statement", evidence_ids: ["e-statement"] },
        result_status: "unknown",
        excerpts: [{ evidence_id: "e-statement", artifact_id: null, locator: null, kind: "participant_statement", text: rc.goal ?? task.title }],
        omitted_material: [],
        limitations: rc.constraints ? [rc.constraints] : [],
        suggested_task_split: [],
      }
    }
  } else {
    reportContent = {
      goal: task.title,
      actions: [],
      result: { text: task.description || "Результат не описан", basis: "participant_statement", evidence_ids: ["e-statement"] },
      result_status: "unknown",
      excerpts: [{ evidence_id: "e-statement", artifact_id: null, locator: null, kind: "participant_statement", text: task.title }],
      omitted_material: [],
      limitations: ["Отчёт ещё не создан; пакет требует проверки"],
      suggested_task_split: [],
    }
  }

  const rawPacket = makeBlindPacket(reportContent, {
    packetId: `preview-${task.id.slice(-8)}`,
    scope: task.title,
    availableTools: ["AI coding assistant", "документация"],
    constraints: ["Бесплатный старт; 5 участников.", "Без обязательных платных подписок."],
    rates: marketRates,
    rateCardId: `rc-${rateCardVersion?.version ?? 1}`,
    visualReviewRequired: false,
  })

  const memberNames = members.map((m) => m.displayName)
  const packet = redactPacket(rawPacket, memberNames)
  const leaked = findKnownIdentifiers(packet, memberNames)

  return NextResponse.json({
    packet,
    leakedNames: leaked,
    reviewPassed: leaked.length === 0,
    note: "Это обезличенный пакет для судей. Структурно запрещены member_id, user_id, actual_hours, personal_rate. Проверьте свободный текст на имена и личные данные.",
  })
}
