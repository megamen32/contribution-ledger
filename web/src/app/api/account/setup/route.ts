import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hashPassword, LOGIN_RE, normalizeLogin, tokenHash, validatePassword } from "@/lib/account"

// The bearer setup invitation is issued on the server, not to anonymous website visitors.
// The owner chooses their password here; no temporary password is ever generated or emailed.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const login = normalizeLogin(body.login)
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : ""
  const invite = typeof body.invite === "string" ? body.invite.trim() : ""
  if (!LOGIN_RE.test(login) || !displayName || displayName.length > 100 || !validatePassword(body.password) || !invite || invite.length > 64) {
    return NextResponse.json({ error: "Заполните имя, логин и пароль" }, { status: 422 })
  }
  const now = new Date()
  const invitation = await db.ownerSetup.findUnique({ where: { id: "first-owner" } })
  if (!invitation || invitation.usedAt || invitation.expiresAt <= now || invitation.tokenHash !== tokenHash(invite)) {
    return NextResponse.json({ error: "Ссылка создания владельца недействительна или уже использована" }, { status: 403 })
  }
  if (await db.userCredential.count()) return NextResponse.json({ error: "Владелец уже создан. Войдите в аккаунт." }, { status: 409 })
  const passwordHash = await hashPassword(body.password)
  try {
    const user = await db.$transaction(async tx => {
      // Claim the singleton before checking/creating a credential. Concurrent claims cannot both win.
      const claimed = await tx.ownerSetup.updateMany({ where: { id: "first-owner", tokenHash: invitation.tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
      if (claimed.count !== 1 || await tx.userCredential.count()) throw new Error("owner-exists")
      await tx.workspace.upsert({ where: { id: "legacy" }, update: {}, create: { id: "legacy", name: "Команда Вклада" } })
      return tx.user.create({ data: {
        displayName, email: `${crypto.randomUUID()}@vklad.invalid`, role: "admin",
        credential: { create: { login, passwordHash } },
      } })
    })
    return NextResponse.json({ user: { id: user.id, displayName: user.displayName } }, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002" || error?.message === "owner-exists") return NextResponse.json({ error: "Аккаунт уже создан. Войдите с вашим логином и паролем." }, { status: 409 })
    return NextResponse.json({ error: "Не удалось создать аккаунт. Повторите попытку." }, { status: 500 })
  }
}
