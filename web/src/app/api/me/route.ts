import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null, members: [] }, { status: 401 })
  const members = await db.user.findMany({ where: { active: true }, select: { id: true, displayName: true, role: true, color: true, timezone: true }, orderBy: { displayName: "asc" } })
  return NextResponse.json({ user, members })
}
export async function POST() { return NextResponse.json({ error: "Identity switching is disabled" }, { status: 405 }) }
export async function DELETE() { return NextResponse.json({ error: "Use /api/auth/signout" }, { status: 405 }) }
