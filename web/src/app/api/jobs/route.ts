import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"

// GET /api/jobs — job queue
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const jobs = await db.job.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { id: true, displayName: true, color: true } } },
  })
  return NextResponse.json({ jobs })
}
