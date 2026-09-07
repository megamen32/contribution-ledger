import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword, LOGIN_RE, normalizeLogin, tokenHash, validatePassword } from "@/lib/account"

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const login = normalizeLogin(body.login)
  const name = typeof body.displayName === "string" ? body.displayName.trim() : ""
  const password = body.password
  const invite = typeof body.invite === "string" ? body.invite.trim() : ""
  if (!LOGIN_RE.test(login) || !name || name.length > 100 || !validatePassword(password) || !invite) return NextResponse.json({ error: "Проверьте имя, логин, пароль (12+ символов) и приглашение" }, { status: 422 })
  const now = new Date()
  const invitation = await db.inviteToken.findUnique({ where: { tokenHash: tokenHash(invite) } })
  if (!invitation || invitation.usedAt || invitation.expiresAt <= now) return NextResponse.json({ error: "Приглашение недействительно или уже использовано" }, { status: 403 })
  const passwordHash = await hashPassword(password)
  try {
    const user = await db.$transaction(async tx => {
      const fresh = await tx.inviteToken.updateMany({ where: { id: invitation.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
      if (fresh.count !== 1) throw new Error("invite-used")
      const user = await tx.user.create({ data: { displayName: name, email: `${crypto.randomUUID()}@vklad.invalid`, role: "member" } })
      await tx.userCredential.create({ data: { userId: user.id, login, passwordHash } })
      return user
    })
    return NextResponse.json({ user: { id: user.id, displayName: user.displayName } }, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 })
    if (String(error?.message).includes("invite-used")) return NextResponse.json({ error: "Приглашение уже использовано" }, { status: 409 })
    return NextResponse.json({ error: "Не удалось создать аккаунт" }, { status: 500 })
  }
}
