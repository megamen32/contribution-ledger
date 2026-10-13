import { projectMembers } from "@/lib/project-membership"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const users = await projectMembers(user.workspaceId)
  return NextResponse.json({ users })
}
export async function POST() { return NextResponse.json({ error: "Use an invitation to create an account" }, { status: 405 }) }
