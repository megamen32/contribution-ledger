import { NextResponse } from "next/server"
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
