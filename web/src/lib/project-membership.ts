import { db } from "./db"

export const PROJECT_COOKIE = "vklad.project"
export function selectedProject(value: string | undefined, userId: string) {
  try { const parsed = JSON.parse(value || "null"); return parsed?.userId === userId && typeof parsed.projectId === "string" ? parsed.projectId : undefined } catch { return undefined }
}
export function projectCookie(userId: string, projectId: string) {
  return { name: PROJECT_COOKIE, value: JSON.stringify({ userId, projectId }), httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 30 * 24 * 3600 }
}
export async function resolveProjectUser(userId: string, projectId?: string) {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user?.active) return null
  const memberships = await db.workspaceMembership.findMany({ where: { userId }, include: { workspace: true }, orderBy: { joinedAt: "asc" } })
  const membership = memberships.find(m => m.workspaceId === projectId) || memberships.find(m => m.workspaceId === user.workspaceId) || memberships[0]
  if (!membership) return null
  return { ...user, homeWorkspaceId: user.workspaceId, workspaceId: membership.workspaceId, role: membership.role, project: { id: membership.workspaceId, name: membership.workspace.name } }
}
export async function projectMembers(workspaceId: string) {
  const memberships = await db.workspaceMembership.findMany({ where: { workspaceId, user: { active: true } }, include: { user: { select: { id: true, displayName: true, color: true, timezone: true, createdAt: true } } }, orderBy: { user: { displayName: "asc" } } })
  return memberships.map(m => ({ ...m.user, role: m.role }))
}
export async function availableProjects(userId: string) {
  const memberships = await db.workspaceMembership.findMany({ where: { userId }, include: { workspace: true }, orderBy: { joinedAt: "asc" } })
  return memberships.map(m => ({ id: m.workspaceId, name: m.workspace.name, role: m.role }))
}
