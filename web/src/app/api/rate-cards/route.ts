import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const amount = body.ratePerHourMinor
  const category = body.category || "all"
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000 || !["all","dev","research","design","ops","learning","sales","org"].includes(category)) {
    return NextResponse.json({ error: "Укажите положительную ставку в копейках и категорию работы" }, { status: 422 })
  }
  const rate = await db.agreedLaborRate.create({ data: { userId: user.id, role: "agreed", category, currency: "RUB", ratePerHourMinor: amount } })
  return NextResponse.json({ rate }, { status: 201 })
}
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/rate-cards — market + agreed rates
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })

  const [market, agreed] = await Promise.all([
    db.rateCardVersion.findMany({
      where: { kind: "market" },
      orderBy: { version: "desc" },
    }),
    db.agreedLaborRate.findMany({
      include: { user: { select: { id: true, displayName: true, color: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ])

  return NextResponse.json({
    market: market.map((m) => ({ ...m, content: JSON.parse(m.contentJson) })),
    agreed,
  })
}
