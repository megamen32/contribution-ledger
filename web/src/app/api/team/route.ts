import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/team — shared owners dashboard aggregate.
// Per spec §13: contribution = cash_contribution + unreimbursed_expense + labor + bonus - reversals.
// "Доля в учтённом вкладе" — share of recognized contribution (NOT company share).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const users = await db.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, color: true, role: true },
    orderBy: { displayName: "asc" },
  })

  const entries = await db.ledgerEntry.findMany({
    where: { status: "confirmed" },
    select: {
      id: true,
      userId: true,
      kind: true,
      currency: true,
      amountMinor: true,
      taskId: true,
      targetEntryId: true,
      note: true,
      createdAt: true,
    },
  })

  // per-member breakdown
  const members = users.map((u) => {
    const mine = entries.filter((e) => e.userId === u.id)
    const sum = (kinds: string[]) =>
      mine.filter((e) => kinds.includes(e.kind)).reduce((a, e) => a + e.amountMinor, 0)
    const cash = sum(["cash_contribution"])
    const expense = sum(["unreimbursed_expense"])
    const labor = sum(["labor"])
    const bonus = sum(["bonus"])
    const reversal = sum(["reversal"])
    const settlement = sum(["settlement"]) // negative — reduces outstanding labor
    // recognized contribution = cash + expense + labor + bonus + settlements - reversals
    // (settlements are negative and represent payments against prior positive entries;
    //  reversals fully cancel an entry. Both reduce the recognized total.)
    const contribution = mine.reduce((total, entry) => total + entry.amountMinor, 0)
    const hours = mine
      .filter((e) => e.kind === "labor")
      .reduce((acc, e) => {
        // parse confirmed_seconds from basis if present
        const m = e.note.match(/\((\d+)ч/)
        return acc + (m ? Number(m[1]) * 3600 : 0)
      }, 0)
    // outstanding (unpaid) labor = gross labor − active settlements against labor entries
    const reversedIds = new Set(mine.filter(e => e.kind === "reversal").map(e => e.targetEntryId))
    const laborEntries = mine.filter((e) => e.kind === "labor" && !reversedIds.has(e.id))
    let paidLabor = 0
    for (const le of laborEntries) {
      const settles = mine.filter((e) => e.targetEntryId === le.id && e.kind === "settlement" && !reversedIds.has(e.id))
      paidLabor += settles.reduce((a, s) => a + Math.abs(s.amountMinor), 0)
    }
    const outstandingLabor = laborEntries.reduce((total, e) => total + e.amountMinor, 0) - paidLabor
    return {
      ...u,
      cash,
      expense,
      labor,
      bonus,
      reversal,
      settlement,
      contribution,
      outstandingLabor,
      entryCount: mine.length,
      hoursSeconds: hours,
    }
  })

  const totalContribution = members.reduce((a, m) => a + m.contribution, 0)
  const totalCash = members.reduce((a, m) => a + m.cash, 0)
  const totalExpense = members.reduce((a, m) => a + m.expense, 0)
  const totalLabor = members.reduce((a, m) => a + m.labor, 0)
  const totalReversal = members.reduce((a, m) => a + m.reversal, 0)

  // Shared board contains only explicitly published task cards. Detailed activity remains private.
  const tasks = await db.task.findMany({
    where: { sharedWithTeam: true },
    select: { id: true, title: true, status: true, category: true, complexity: true, ownerId: true, updatedAt: true, owner: { select: { id: true, displayName: true, color: true } } },
    orderBy: { updatedAt: "desc" }, take: 100,
  })
  const tasksByStatus = groupCount(tasks, (t) => t.status)
  const tasksByCategory = groupCount(tasks, (t) => t.category ?? "без категории")
  const tasksByOwner = groupCount(tasks, (t) => t.ownerId)
  const recent: never[] = []
  const hoursByDay: Record<string, number> = {}

  const totalSettlement = members.reduce((a, m) => a + m.settlement, 0)
  const totalOutstandingLabor = members.reduce((a, m) => a + m.outstandingLabor, 0)

  return NextResponse.json({
    members,
    totals: {
      contribution: totalContribution,
      cash: totalCash,
      expense: totalExpense,
      labor: totalLabor,
      reversal: totalReversal,
      settlement: totalSettlement,
      outstandingLabor: totalOutstandingLabor,
    },
    // EXPLICIT INVARIANT (spec §13): AI assessment never touches the ledger.
    invariants: {
      aiNeverTouchesLedger: true,
      financialEffectMinor: 0,
      currency: "RUB",
      note: "ИИ-оценка носит справочный характер и не влияет на признанный вклад. Стоимость труда — по согласованной ставке × подтверждённые часы.",
    },
    tasks: {
      total: tasks.length,
      byStatus: tasksByStatus,
      byCategory: tasksByCategory,
      byOwner: tasksByOwner,
      published: tasks,
    },
    recent,
    hoursByDay,
  })
}

function groupCount<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const m: Record<string, number> = {}
  for (const x of arr) {
    const k = key(x)
    m[k] = (m[k] ?? 0) + 1
  }
  return m
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}
