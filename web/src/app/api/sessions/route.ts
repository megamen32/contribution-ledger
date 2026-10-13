import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/sessions?scope=mine|all  — list sessions
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const scope = req.nextUrl.searchParams.get("scope") ?? "mine"
  const where = { userId: user.id }
  const sessions = await db.session.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 200,
    include: {
      task: { select: { id: true, title: true, status: true } },
      user: { select: { id: true, displayName: true, color: true } },
    },
  })
  return NextResponse.json({ sessions })
}

// POST /api/sessions — start a new session. body: { project, taskId?, note? }
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const { project, taskId, note } = await req.json().catch(() => ({} as any))
  if (!project) return NextResponse.json({ error: "project required" }, { status: 400 })

  if (taskId && !(await db.task.findFirst({ where: { id: taskId, ownerId: user.id } }))) return NextResponse.json({ error: "task not found" }, { status: 404 })

  // invariant: one active session per user per device
  const active = await db.session.findFirst({
    where: { userId: user.id, status: { in: ["recording", "paused"] } },
  })
  if (active) {
    return NextResponse.json(
      { error: "У вас уже есть активная сессия. Остановите её сначала.", session: active },
      { status: 409 },
    )
  }

  const now = new Date()
  const session = await db.session.create({
    data: {
      userId: user.id,
      project,
      taskId: taskId || null,
      status: "recording",
      startedAt: now,
      intervalsJson: JSON.stringify([{ start: now.toISOString(), end: null, kind: "work" }]),
      note: note ?? "",
    },
    include: { task: { select: { id: true, title: true } } },
  })
  return NextResponse.json({ session })
}
