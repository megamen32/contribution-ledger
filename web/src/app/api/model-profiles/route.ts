import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { JUDGE_MODELS } from "@/lib/omniroute"
import { subscriptionEnabled } from "@/lib/subscription"

// GET /api/model-profiles — list consortium profiles (active first)
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const profiles = await db.modelProfile.findMany({
    where: { workspaceId: user.workspaceId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  })
  return NextResponse.json({
    profiles: profiles.map((p) => ({
      ...p,
      models: p.active ? JUDGE_MODELS.map(key => ({ key, family: key.startsWith("glm") ? "GLM" : key.startsWith("MiniMax") ? "MiniMax" : "GPT", tag: key })) : JSON.parse(p.modelsJson),
      providerLabel: p.active && subscriptionEnabled() ? "Подписки GLM и MiniMax" : "OmniRoute",
      seeds: JSON.parse(p.seedsJson),
    })),
  })
}
