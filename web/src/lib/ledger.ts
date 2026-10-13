// Transactional ledger posting — port of B's contribution_spec.store.post_entry.
// Enforces: business_key idempotency, request_hash conflict detection, settlement
// outstanding-amount check, reversal-of-reversal block, one-reversal-per-target,
// and signed amounts. Immutability of confirmed entries is enforced by SQL triggers
// (see prisma migration) — this lib doesn't update/delete, only inserts.

import { db } from "./db"
import { digest } from "./canonical"
import { grossMinor } from "./money"
import type { LedgerEntry, Prisma } from "@prisma/client"

export type LedgerKind =
  | "cash_contribution"
  | "unreimbursed_expense"
  | "labor"
  | "bonus"
  | "reimbursement"
  | "settlement"
  | "reversal"

/** Kinds that post a POSITIVE amount and cannot target another entry. */
const POSITIVE_KINDS: LedgerKind[] = [
  "cash_contribution",
  "unreimbursed_expense",
  "labor",
  "bonus",
]

export interface LedgerCommand {
  workspaceId?: string
  userId: string
  kind: LedgerKind
  /** Positive amount in minor units. Signed internally (settlement/reversal become negative). */
  amountMinor: number
  currency: string
  /** Idempotency key. Same key + same payload = return existing; same key + diff payload = 409. */
  businessKey: string
  /** Links to the session/task/manual source that produced this entry. */
  sourceId: string
  /** Rule version reference (e.g. "honest-v1"). */
  policyId: string
  /** Required for settlement & reversal; null otherwise. */
  targetEntryId: string | null
  reason: string
  taskId?: string | null
  note?: string
  basis?: string
}

export class LedgerConflict extends Error {
  status = 409
  constructor(message: string, public current?: unknown) {
    super(message)
    this.name = "LedgerConflict"
  }
}
export class LedgerValidationError extends Error {
  status = 422
  constructor(message: string) {
    super(message)
    this.name = "LedgerValidationError"
  }
}

/** Idempotent, transactional ledger post. Mirrors B's store.post_entry.
 *  - business_key collision + same requestHash → return existing (idempotent)
 *  - business_key collision + diff requestHash → 409
 *  - settlement: target must be a positive unreversed entry; amount ≤ outstanding; signed negative
 *  - reversal: target must not be a reversal; amount must equal abs(target); no active settlements; signed negative
 *  - positive kinds: amount > 0, no target
 */
export async function postEntry(cmd: LedgerCommand): Promise<LedgerEntry> {
  // validate command shape
  if (!Number.isSafeInteger(cmd.amountMinor) || cmd.amountMinor <= 0) {
    throw new LedgerValidationError("amount must be positive")
  }
  if (cmd.currency !== "RUB") throw new LedgerValidationError("This team ledger currently uses RUB only")
  if (!cmd.businessKey) throw new LedgerValidationError("businessKey required")
  if (!cmd.sourceId) throw new LedgerValidationError("sourceId required")

  const requiresTarget = cmd.kind === "settlement" || cmd.kind === "reversal"
  if (requiresTarget !== (cmd.targetEntryId !== null)) {
    throw new LedgerValidationError(
      "only a settlement or full reversal must target an entry",
    )
  }
  if (POSITIVE_KINDS.includes(cmd.kind) && cmd.targetEntryId !== null) {
    throw new LedgerValidationError("positive kinds cannot target an entry")
  }

  // Keep old accepted-command hashes stable through the additive project upgrade.
  const requestHash = digest(Object.fromEntries(Object.entries(cmd).filter(([key, value]) => key !== "workspaceId" && value !== undefined)))

  // Run inside a transaction. Prisma's $transaction with interactive mode.
  return await db.$transaction(async (tx) => {
    const member = await tx.user.findUnique({ where: { id: cmd.userId } })
    if (!member) throw new LedgerValidationError("member not found")
    const workspaceId = cmd.workspaceId ?? member.workspaceId
    if (cmd.workspaceId && !(await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: cmd.userId } } }))) throw new LedgerValidationError("member not in project")
    // 1. idempotency check
    const existing = await tx.ledgerEntry.findUnique({
      where: { businessKey: cmd.businessKey },
      include: { projectScope: true },
    })
    if (existing) {
      if (existing.projectScope?.workspaceId !== workspaceId) throw new LedgerConflict("command belongs to another project")
      if (existing.requestHash !== requestHash) {
        throw new LedgerConflict(
          "same business key, different command",
          existing,
        )
      }
      return existing
    }

    // 2. determine signed amount + validate target if present
    let signedAmount = cmd.amountMinor
    if (cmd.targetEntryId) {
      const target = await tx.ledgerEntry.findUnique({
        where: { id: cmd.targetEntryId },
        include: { projectScope: true },
      })
      if (!target) throw new LedgerValidationError("target not found")
      if (target.projectScope?.workspaceId !== workspaceId) throw new LedgerValidationError("target not found in project")
      if (target.userId !== cmd.userId || target.currency !== cmd.currency) {
        throw new LedgerValidationError("target has a different member or currency")
      }
      // one reversal per target
      const alreadyReversed = await tx.ledgerEntry.findFirst({
        where: { targetEntryId: cmd.targetEntryId, kind: "reversal" },
        select: { id: true },
      })
      if (alreadyReversed) {
        throw new LedgerConflict("target already reversed")
      }

      if (cmd.kind === "settlement") {
        if (!POSITIVE_KINDS.includes(target.kind as LedgerKind)) {
          throw new LedgerValidationError(
            "settlement requires an unreversed positive entry",
          )
        }
        // outstanding = target.amountMinor − sum(active settlements)
        const settlements = await tx.ledgerEntry.findMany({
          where: { targetEntryId: cmd.targetEntryId, kind: "settlement" },
          select: { id: true, amountMinor: true },
        })
        const reversed = await tx.ledgerEntry.findMany({ where: { kind: "reversal", targetEntryId: { in: settlements.map(s => s.id) } }, select: { targetEntryId: true } })
        const reversedIds = new Set(reversed.map(e => e.targetEntryId))
        const paid = settlements.filter(e => !reversedIds.has(e.id)).reduce((a, e) => a + Math.abs(e.amountMinor), 0)
        const outstanding = target.amountMinor - paid
        if (cmd.amountMinor > outstanding) {
          throw new LedgerValidationError(
            `settlement exceeds outstanding amount (${outstanding} minor)`,
          )
        }
        signedAmount = -cmd.amountMinor
      } else {
        // reversal
        if (target.kind === "reversal") {
          throw new LedgerValidationError(
            "do not reverse a reversal; post a new explicitly sourced entry",
          )
        }
        if (cmd.amountMinor !== Math.abs(target.amountMinor)) {
          throw new LedgerValidationError(
            "a full reversal must match the original amount",
          )
        }
        // must reverse active settlements first
        const settlements = await tx.ledgerEntry.findMany({
          where: { targetEntryId: cmd.targetEntryId, kind: "settlement" },
          select: { id: true },
        })
        const reversedSettlements = await tx.ledgerEntry.findMany({ where: { kind: "reversal", targetEntryId: { in: settlements.map(s => s.id) } }, select: { targetEntryId: true } })
        const reversedIds = new Set(reversedSettlements.map(e => e.targetEntryId))
        if (settlements.some(s => !reversedIds.has(s.id))) {
          throw new LedgerValidationError(
            "reverse active settlements before correcting their parent",
          )
        }
        signedAmount = -target.amountMinor
      }
    }

    // 3. insert
    const data: Prisma.LedgerEntryCreateInput = {
      user: { connect: { id: cmd.userId } },
      projectScope: { create: { workspaceId } },
      kind: cmd.kind,
      currency: cmd.currency,
      amountMinor: signedAmount,
      businessKey: cmd.businessKey,
      requestHash,
      sourceId: cmd.sourceId,
      policyId: cmd.policyId,
      targetEntryId: cmd.targetEntryId,
      reason: cmd.reason,
      note: cmd.note ?? "",
      basis: cmd.basis ?? "",
      status: "confirmed",
      ruleVersion: 1,
      ...(cmd.taskId ? { task: { connect: { id: cmd.taskId } } } : {}),
    }
    const entry = await tx.ledgerEntry.create({ data })
    return entry
  })
}

/** Compute the outstanding (unpaid) amount for a positive entry: gross − active settlements.
 *  Active = not itself reversed. */
export async function outstandingFor(entryId: string): Promise<number> {
  const target = await db.ledgerEntry.findUnique({ where: { id: entryId } })
  if (!target) return 0
  const settlements = await db.ledgerEntry.findMany({
    where: { targetEntryId: entryId, kind: "settlement", status: "confirmed" },
    select: { id: true, amountMinor: true },
  })
  // exclude reversed settlements
  let paid = 0
  for (const s of settlements) {
    const reversed = await db.ledgerEntry.findFirst({
      where: { targetEntryId: s.id, kind: "reversal" },
      select: { id: true },
    })
    if (!reversed) paid += Math.abs(s.amountMinor)
  }
  return Math.max(0, target.amountMinor - paid)
}
