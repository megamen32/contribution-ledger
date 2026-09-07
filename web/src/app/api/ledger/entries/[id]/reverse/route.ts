import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { postEntry, LedgerConflict, LedgerValidationError } from "@/lib/ledger"

// POST /api/ledger/entries/{id}/reverse — create a full corrective reversal (spec §13)
// Idempotent: one reversal per target (enforced by partial unique index).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const { note } = await req.json().catch(() => ({ note: "Корректировка" }))

  const original = await db.ledgerEntry.findUnique({ where: { id } })
  if (!original) return NextResponse.json({ error: "entry not found" }, { status: 404 })

  try {
    const reversal = await postEntry({
      userId: original.userId,
      kind: "reversal",
      currency: original.currency,
      amountMinor: Math.abs(original.amountMinor), // must match original
      taskId: original.taskId,
      businessKey: `reverse:${original.id}`,
      sourceId: `reverse:${original.id}`,
      policyId: original.policyId,
      targetEntryId: original.id,
      reason: note ?? `Отмена записи ${original.id.slice(-8)}`,
      basis: `Корректировка записи ${original.id} (${original.kind})`,
    })
    const full = await db.ledgerEntry.findUnique({
      where: { id: reversal.id },
      include: {
        user: { select: { id: true, displayName: true, color: true } },
        task: { select: { id: true, title: true } },
      },
    })
    return NextResponse.json({ entry: full })
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
