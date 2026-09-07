import { NextRequest, NextResponse } from "next/server"
import * as argon2 from "argon2"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { hashPassword, validatePassword } from "@/lib/account"
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!validatePassword(body.password) || !validatePassword(body.oldPassword) || body.password === body.oldPassword) return NextResponse.json({ error: "Новый пароль должен отличаться и содержать не менее 12 символов" }, { status: 422 })
  const credential = await db.userCredential.findUnique({ where: { userId: user.id } })
  const verified = credential ? await argon2.verify(credential.passwordHash, body.oldPassword).catch(() => false) : false
  if (!credential || !verified) return NextResponse.json({ error: "Текущий пароль неверен" }, { status: 403 })
  const nextHash = await hashPassword(body.password)
  await db.userCredential.update({ where: { userId: user.id }, data: { passwordHash: nextHash, sessionVersion: credential.sessionVersion + 1, failedAttempts: 0, lockedUntil: null } })
  return NextResponse.json({ ok: true })
}
