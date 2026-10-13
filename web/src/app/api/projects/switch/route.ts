import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { projectCookie } from "@/lib/project-membership"
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Войдите в аккаунт" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.projectId !== "string") return NextResponse.json({ error: "Выберите проект" }, { status: 422 })
  const membership = await db.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: body.projectId, userId: user.id } }, include: { workspace: true } })
  if (!membership) return NextResponse.json({ error: "У вас нет доступа к этому проекту" }, { status: 403 })
  const response = NextResponse.json({ project: { id: membership.workspaceId, name: membership.workspace.name }, role: membership.role })
  response.cookies.set(projectCookie(user.id, membership.workspaceId))
  return response
}
