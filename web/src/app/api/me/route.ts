import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser, setCurrentUser, clearCurrentUser } from "@/lib/auth"

// GET /api/me — current user profile + capabilities
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ user: null, members: await membersList() })
  }
  return NextResponse.json({ user, members: await membersList() })
}

// POST /api/me — switch current user (internal trusted team). body: { userId }
export async function POST(req: Request) {
  const { userId } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })
  const u = await db.user.findUnique({ where: { id: userId } })
  if (!u || !u.active) return NextResponse.json({ error: "unknown user" }, { status: 404 })
  await setCurrentUser(u.id)
  return NextResponse.json({ user: u })
}

// DELETE /api/me — logout
export async function DELETE() {
  await clearCurrentUser()
  return NextResponse.json({ ok: true })
}

async function membersList() {
  return db.user.findMany({
    where: { active: true },
    select: { id: true, displayName: true, email: true, role: true, color: true, timezone: true },
    orderBy: { displayName: "asc" },
  })
}
