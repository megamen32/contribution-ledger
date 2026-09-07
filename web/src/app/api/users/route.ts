import { NextRequest, NextResponse } from "next/server"
import { setCurrentUser } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/users — all active team members (for switcher / team views)
export async function GET() {
  const users = await db.user.findMany({
    where: { active: true },
    select: {
      id: true,
      displayName: true,
      email: true,
      role: true,
      color: true,
      timezone: true,
      createdAt: true,
    },
    orderBy: { displayName: "asc" },
  })
  return NextResponse.json({ users })
}

// All routes are protected by the shared team password at the HTTPS ingress.
// Inside the trusted team, member selection is deliberate, not individual access control.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const name = typeof body.displayName === "string" ? body.displayName.trim() : ""
  if (!name || name.length > 100) return NextResponse.json({ error: "Имя: от 1 до 100 символов" }, { status: 422 })
  const user = await db.user.create({ data: {
    displayName: name,
    email: `${crypto.randomUUID()}@vklad.invalid`,
    role: await db.user.count() === 0 ? "admin" : "member",
  } })
  await setCurrentUser(user.id)
  return NextResponse.json({ user }, { status: 201 })
}
