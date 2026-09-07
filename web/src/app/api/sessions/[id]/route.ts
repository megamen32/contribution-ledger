import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { grossMinor, bucketDelta } from "@/lib/money"
import { postEntry } from "@/lib/ledger"

type Interval = { start: string; end: string | null; kind: "work" | "pause" }

function sumWorkSeconds(intervals: Interval[]): number {
  let s = 0
  const now = new Date()
  for (const iv of intervals) {
    if (iv.kind !== "work") continue
    const start = new Date(iv.start).getTime()
    const endTs = iv.end ? new Date(iv.end).getTime() : now.getTime()
    s += Math.max(0, Math.floor((endTs - start) / 1000))
  }
  return s
}

function closeLastInterval(intervals: Interval[], kind: "work" | "pause", now = new Date()): Interval[] {
  const out = [...intervals]
  // close the trailing interval if open
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].end === null) {
      out[i] = { ...out[i], end: now.toISOString() }
      break
    }
  }
  return out
}

// PATCH /api/sessions/{id} — pause | resume | stop | finalize
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const { action } = await req.json().catch(() => ({} as any))

  const session = await db.session.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (session.userId !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 })

  const now = new Date()
  let intervals: Interval[] = JSON.parse(session.intervalsJson || "[]")

  if (action === "pause") {
    if (session.status !== "recording") return NextResponse.json({ error: "not recording" }, { status: 409 })
    intervals = closeLastInterval(intervals, "work", now)
    intervals.push({ start: now.toISOString(), end: null, kind: "pause" })
    const confirmedSeconds = sumWorkSeconds(intervals)
    const updated = await db.session.update({
      where: { id },
      data: { status: "paused", intervalsJson: JSON.stringify(intervals), confirmedSeconds },
    })
    return NextResponse.json({ session: updated })
  }

  if (action === "resume") {
    if (session.status !== "paused") return NextResponse.json({ error: "not paused" }, { status: 409 })
    intervals = closeLastInterval(intervals, "pause", now)
    intervals.push({ start: now.toISOString(), end: null, kind: "work" })
    const updated = await db.session.update({
      where: { id },
      data: { status: "recording", intervalsJson: JSON.stringify(intervals) },
    })
    return NextResponse.json({ session: updated })
  }

  if (action === "stop") {
    if (session.status !== "recording" && session.status !== "paused") {
      return NextResponse.json({ error: "already stopped" }, { status: 409 })
    }
    // close any open interval
    intervals = closeLastInterval(intervals, "work", now)
    const confirmedSeconds = sumWorkSeconds(intervals)
    const updated = await db.session.update({
      where: { id },
      data: {
        status: "stopped",
        endedAt: now,
        intervalsJson: JSON.stringify(intervals),
        confirmedSeconds,
        revision: { increment: 1 },
      },
    })
    return NextResponse.json({ session: updated })
  }

  if (action === "finalize") {
    // finalize: mark uploaded, create task allocation + labor ledger entry (idempotent by sourceId)
    if (session.status === "uploaded") {
      return NextResponse.json({ session, alreadyFinalized: true })
    }
    intervals = closeLastInterval(intervals, "work", now)
    const confirmedSeconds = session.confirmedSeconds || sumWorkSeconds(intervals)
    const updated = await db.session.update({
      where: { id },
      data: {
        status: "uploaded",
        endedAt: session.endedAt ?? now,
        confirmedSeconds,
        revision: { increment: 1 },
      },
    })

    // create allocation if task linked
    if (session.taskId) {
      const existingAlloc = await db.taskAllocation.findFirst({
        where: { sessionId: session.id },
      })
      if (!existingAlloc) {
        await db.taskAllocation.create({
          data: {
            taskId: session.taskId,
            sessionId: session.id,
            userId: session.userId,
            confirmedSeconds,
            source: "measured",
          },
        })
      }
    }

    // create labor ledger entry via postEntry (idempotent by businessKey, transactional)
    const businessKey = `session:${session.id}`
    const existing = await db.ledgerEntry.findUnique({ where: { businessKey } })
    if (!existing) {
      // find agreed rate: by user + category of task; fallback to user's first rate
      const task = session.taskId ? await db.task.findUnique({ where: { id: session.taskId } }) : null
      let rate: Awaited<ReturnType<typeof db.agreedLaborRate.findFirst>> = null
      if (task?.category) {
        rate = await db.agreedLaborRate.findFirst({ orderBy: { effectiveFrom: "desc" },
          where: { userId: session.userId, category: task.category },
        })
      }
      if (!rate) {
        rate = await db.agreedLaborRate.findFirst({ orderBy: { effectiveFrom: "desc" }, where: { userId: session.userId } })
      }
      const rateMinor = rate?.ratePerHourMinor ?? 0

      // effort-credit mode: true = time × rate (bucketed); false = explicit resultMinor
      let laborMinor = 0
      let basis = ""
      if (session.effortCredit === false && session.resultMinor != null) {
        // opt-out: agreed cost of the result (no time×rate)
        laborMinor = session.resultMinor
        basis = `effort_credit=false; result_minor=${session.resultMinor}; rule_v1`
      } else {
        // effort-credit: bucketed cumulative rounding for split-invariance.
        // Sum prior confirmed seconds for this user on the same calendar day (server-local)
        // at the same rate, then compute the delta.
        const startOfDay = new Date(session.startedAt)
        startOfDay.setHours(0, 0, 0, 0)
        const endOfDay = new Date(startOfDay)
        endOfDay.setDate(endOfDay.getDate() + 1)
        const prevSessions = await db.session.findMany({
          where: {
            userId: session.userId,
            status: "uploaded",
            id: { not: session.id },
            startedAt: { gte: startOfDay, lt: endOfDay },
          },
          select: { confirmedSeconds: true },
        })
        const prevSeconds = prevSessions.reduce((a, s) => a + (s.confirmedSeconds ?? 0), 0)
        laborMinor = bucketDelta(prevSeconds, confirmedSeconds, rateMinor)
        basis = `effort_credit=true; bucket_delta(prev_today=${prevSeconds}s, added=${confirmedSeconds}s, rate=${rateMinor}/h)=${laborMinor}; gross_total=${grossMinor(prevSeconds + confirmedSeconds, rateMinor)}; rule_v1`
      }

      if (laborMinor > 0) {
        await postEntry({
          userId: session.userId,
          kind: "labor",
          currency: rate?.currency ?? "RUB",
          amountMinor: laborMinor,
          taskId: session.taskId ?? null,
          businessKey,
          sourceId: businessKey,
          policyId: "honest-v1",
          targetEntryId: null,
          reason: `Труд по сессии «${session.project}»`,
          note: `${Math.round(confirmedSeconds / 3600)}ч ${Math.floor((confirmedSeconds % 3600) / 60)}м`,
          basis,
        })
      }
    }
    return NextResponse.json({ session: updated, finalized: true })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}

// GET /api/sessions/{id}
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const session = await db.session.findUnique({
    where: { id },
    include: { task: true, user: { select: { id: true, displayName: true, color: true } } },
  })
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (session.userId !== user.id) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ session })
}
