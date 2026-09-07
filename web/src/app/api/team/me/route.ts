import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { formatDuration } from "@/lib/money"

// GET /api/team/me — personal private summary: my sessions, tasks, contributions, activity.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const [sessions, tasks, entries, activeSession, rateCards] = await Promise.all([
    db.session.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { task: { select: { id: true, title: true, status: true } } },
    }),
    db.task.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { _count: { select: { sessions: true, assessmentRounds: true } } },
    }),
    db.ledgerEntry.findMany({
      where: { userId: user.id, status: "confirmed" },
      orderBy: { createdAt: "desc" },
      // Totals include the whole ledger history, not the latest page.
      include: { task: { select: { id: true, title: true } } },
    }),
    db.session.findFirst({
      where: { userId: user.id, status: { in: ["recording", "paused"] } },
      include: { task: { select: { id: true, title: true } } },
    }),
    db.agreedLaborRate.findMany({ where: { userId: user.id } }),
  ])

  const sum = (kinds: string[]) =>
    entries.filter((e) => kinds.includes(e.kind)).reduce((a, e) => a + e.amountMinor, 0)
  const cash = sum(["cash_contribution"])
  const expense = sum(["unreimbursed_expense"])
  const labor = sum(["labor"])
  const bonus = sum(["bonus"])
  const reversal = sum(["reversal"])
  const reimbursement = sum(["reimbursement"])
  const contribution = entries.reduce((total, entry) => total + entry.amountMinor, 0)

  const totalSeconds = sessions
    .filter((s) => s.status === "uploaded")
    .reduce((a, s) => a + (s.confirmedSeconds ?? 0), 0)

  // total team contribution for share calculation
  const allEntries = await db.ledgerEntry.findMany({
    where: { status: "confirmed" },
    select: { userId: true, kind: true, amountMinor: true },
  })
  const teamByUser: Record<string, number> = {}
  for (const e of allEntries) {
    teamByUser[e.userId] = (teamByUser[e.userId] ?? 0) + e.amountMinor
  }
  const teamTotal = Object.values(teamByUser).reduce((a, b) => a + b, 0)
  const share = teamTotal > 0 ? (contribution / teamTotal) * 100 : 0

  return NextResponse.json({
    user,
    activeSession,
    sessions,
    tasks,
    entries,
    rateCards,
    summary: {
      cash,
      expense,
      labor,
      bonus,
      reversal,
      reimbursement,
      contribution,
      totalSeconds,
      totalHoursLabel: formatDuration(totalSeconds),
      teamTotal,
      share,
      sessionCount: sessions.length,
      taskCount: tasks.length,
    },
  })
}
