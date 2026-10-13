import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword, LOGIN_RE, normalizeLogin, tokenHash, validatePassword } from "@/lib/account"
import { createWorkspace } from "@/lib/workspace"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const login = normalizeLogin(body.login)
  const name = typeof body.displayName === "string" ? body.displayName.trim() : ""
  const password = body.password
  const invite = typeof body.invite === "string" ? body.invite.trim() : ""
  const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "Мой проект"
  if (!LOGIN_RE.test(login) || !name || name.length > 100 || !validatePassword(password) || invite.length > 64 || (!invite && (!projectName || projectName.length > 100))) return NextResponse.json({ error: "Проверьте имя, название проекта, логин и пароль" }, { status: 422 })
  const passwordHash = await hashPassword(password)
  try {
    const result = await db.$transaction(async tx => {
      let project
      if (invite) {
        const now = new Date()
        const invitation = await tx.inviteToken.findUnique({ where: { tokenHash: tokenHash(invite) }, include: { createdBy: true } })
        if (!invitation || invitation.usedAt || invitation.expiresAt <= now || !invitation.createdBy.active || invitation.createdBy.role !== "admin" || invitation.createdBy.workspaceId !== invitation.workspaceId) throw new Error("invite-invalid")
        project = await tx.workspace.findUnique({ where: { id: invitation.workspaceId } })
        if (!project) throw new Error("invite-invalid")
        const fresh = await tx.inviteToken.updateMany({ where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
        if (fresh.count !== 1) throw new Error("invite-invalid")
      } else {
        project = await createWorkspace(tx, projectName)
      }
      const user = await tx.user.create({ data: { workspaceId: project.id, displayName: name, email: `${crypto.randomUUID()}@vklad.invalid`, role: invite ? "member" : "admin" } })
      await tx.userCredential.create({ data: { userId: user.id, login, passwordHash } })
      return { user: { id: user.id, displayName: user.displayName }, project }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 })
    if (error?.message === "invite-invalid") return NextResponse.json({ error: "Приглашение недействительно или уже использовано" }, { status: 403 })
    return NextResponse.json({ error: "Не удалось создать аккаунт" }, { status: 500 })
  }
}
