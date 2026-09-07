import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/rules — rule versions
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const rules = await db.ruleVersion.findMany({ orderBy: { version: "desc" } })
  return NextResponse.json({
    rules: rules.map((r) => ({
      ...r,
      content: JSON.parse(r.contentJson),
      acceptedBy: JSON.parse(r.acceptedByJson),
    })),
  })
}
