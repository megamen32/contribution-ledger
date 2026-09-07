import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/model-profiles — list consortium profiles (active first)
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const profiles = await db.modelProfile.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  })
  return NextResponse.json({
    profiles: profiles.map((p) => ({
      ...p,
      models: JSON.parse(p.modelsJson),
      seeds: JSON.parse(p.seedsJson),
    })),
  })
}
