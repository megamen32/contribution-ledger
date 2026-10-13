import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { postEntry, LedgerConflict, LedgerValidationError, type LedgerKind } from "@/lib/ledger"

const VALID_KINDS: LedgerKind[] = [
  "cash_contribution",
  "unreimbursed_expense",
  "labor",
  "bonus",
  "settlement",
  "reversal",
]

// GET /api/ledger?scope=team|mine&kind=...
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const scope = sp.get("scope") ?? "mine"
  const kind = sp.get("kind")
  if (scope !== "mine") return NextResponse.json({ error: "Detailed ledger entries are private; use the team totals endpoint" }, { status: 403 })
  const where: any = { status: "confirmed", userId: user.id }
  if (kind) where.kind = kind
  const entries = await db.ledgerEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      user: { select: { id: true, displayName: true, color: true } },
      task: { select: { id: true, title: true } },
    },
  })
  return NextResponse.json({ entries })
}

// POST /api/ledger — add a money/labor/expense/bonus/settlement entry via postEntry (idempotent)
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const { userId, kind, amountMinor, currency, taskId, targetEntryId, reason, note, businessKey } = body
  if (!kind) return NextResponse.json({ error: "kind required" }, { status: 400 })
  if (!VALID_KINDS.includes(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 })
  const amt = Number(amountMinor)
  if (!Number.isSafeInteger(amt) || amt <= 0) return NextResponse.json({ error: "amountMinor must be positive" }, { status: 400 })

  const recipientId = user.role === "admin" && userId ? userId : user.id
  if (!(await db.user.findFirst({ where: { id: recipientId, workspaceId: user.workspaceId, active: true } }))) return NextResponse.json({ error: "member not found" }, { status: 404 })
  if (taskId && !(await db.task.findFirst({ where: { id: taskId, ownerId: user.id } }))) return NextResponse.json({ error: "task not found" }, { status: 404 })
  // Preserve already accepted commands from the single-team release on retry.
  const previous = businessKey ? await db.ledgerEntry.findUnique({ where: { businessKey } }) : null
  const ownsPrevious = previous && (user.role === "admin" || previous.userId === user.id) && await db.user.findFirst({ where: { id: previous.userId, workspaceId: user.workspaceId } })
  const key = ownsPrevious ? businessKey : `manual:${user.workspaceId}:${user.id}:${businessKey || crypto.randomUUID()}`
  try {
    const entry = await postEntry({
      userId: recipientId,
      kind,
      currency: currency || "RUB",
      amountMinor: Math.round(amt),
      taskId: taskId || null,
      businessKey: key,
      sourceId: key,
      policyId: "honest-v1",
      targetEntryId: targetEntryId ?? null,
      reason: reason ?? "",
      note: note ?? "",
      basis: "Внесено вручную",
    })
    const full = await db.ledgerEntry.findUnique({
      where: { id: entry.id },
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
