import type { Prisma } from "@prisma/client"
import { tokenHash } from "./account"

export async function invitationProject(tx: Prisma.TransactionClient, token: string) {
  const invitation = await tx.inviteToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { createdBy: true } })
  if (!invitation || !invitation.createdBy.active) throw new Error("invite-invalid")
  const creator = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: invitation.createdById } } })
  const project = await tx.workspace.findUnique({ where: { id: invitation.workspaceId } })
  if (creator?.role !== "admin" || !project) throw new Error("invite-invalid")
  return { invitation, project }
}
export async function joinByInvitation(tx: Prisma.TransactionClient, token: string, userId: string) {
  const { invitation, project } = await invitationProject(tx, token)
  const existing = await tx.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: project.id, userId } } })
  // A confirmed receipt for this same account is non-replayable but can be read again.
  if (invitation.usedAt) {
    if (invitation.usedById === userId && existing) return { project, alreadyJoined: true }
    throw new Error("invite-invalid")
  }
  const now = new Date()
  if (invitation.expiresAt <= now) throw new Error("invite-invalid")
  // Do not waste a fresh one-use invitation on someone who already belongs here.
  if (existing) return { project, alreadyJoined: true }
  const claimed = await tx.inviteToken.updateMany({ where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, usedById: userId } })
  if (claimed.count !== 1) throw new Error("invite-invalid")
  await tx.workspaceMembership.create({ data: { workspaceId: project.id, userId, role: "member" } })
  return { project, alreadyJoined: false }
}
