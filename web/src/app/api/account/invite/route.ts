import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { newInviteToken, tokenHash } from "@/lib/account"
export async function POST() {
  const user = await getCurrentUser()
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Только администратор команды может создавать приглашения" }, { status: 403 })
  const token = newInviteToken()
  await db.inviteToken.create({ data: { tokenHash: tokenHash(token), createdById: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) } })
  // Fragment is not sent to the server in HTTP requests or access logs.
  return NextResponse.json({ url: `${process.env.NEXTAUTH_URL || "https://vklad.bezrabotnyi.com"}/login#invite=${encodeURIComponent(token)}` })
}
