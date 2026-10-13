import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { postEntry, LedgerConflict, LedgerValidationError, outstandingFor } from "@/lib/ledger"

// POST /api/ledger/entries/{id}/settle — create a settlement (partial payment) against a
// positive entry. Reduces outstanding labor/cash. Cannot exceed outstanding amount.
// body: { amountMinor, reason? }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const { amountMinor, reason } = await req.json().catch(() => ({} as any))
  const amt = Number(amountMinor)
  if (!Number.isFinite(amt) || amt <= 0) {
    return NextResponse.json({ error: "amountMinor must be positive" }, { status: 400 })
  }

  const target = await db.ledgerEntry.findUnique({ where: { id, projectScope: { workspaceId: user.workspaceId }, ...(user.role === "admin" ? {} : { userId: user.id }) } })
  if (!target) return NextResponse.json({ error: "entry not found" }, { status: 404 })

  const outstanding = await outstandingFor(id)
  if (amt > outstanding) {
    return NextResponse.json(
      { error: `Сумма погашения превышает непогашенный остаток (${outstanding} minor)` },
      { status: 422 },
    )
  }

  try {
    const settlement = await postEntry({
        workspaceId: user.workspaceId,
      userId: target.userId,
      kind: "settlement",
      currency: target.currency,
      amountMinor: Math.round(amt),
      taskId: target.taskId,
      businessKey: `settle:${target.id}:${amt}`,
      sourceId: `settle:${target.id}`,
      policyId: "honest-v1",
      targetEntryId: target.id,
      reason: reason ?? `Погашение ${amt / 100} ${target.currency} по записи ${target.id.slice(-8)}`,
      basis: `Частичная оплата; остаток уменьшен с ${outstanding} до ${outstanding - Math.round(amt)}`,
    })
    const full = await db.ledgerEntry.findUnique({
      where: { id: settlement.id },
      include: {
        user: { select: { id: true, displayName: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    })
    return NextResponse.json({ entry: full, outstanding: outstanding - Math.round(amt) })
  } catch (e: any) {
    if (e instanceof LedgerConflict) {
      return NextResponse.json({ error: e.message, current: e.current }, { status: 409 })
    }
    if (e instanceof LedgerValidationError) {
      return NextResponse.json({ error: e.message }, { status: 422 })
    }
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}
