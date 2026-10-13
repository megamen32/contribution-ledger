import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { db } from "@/lib/db"
import { joinByInvitation } from "@/lib/project-invitation"
import { projectCookie } from "@/lib/project-membership"
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Войдите в свой аккаунт, чтобы принять приглашение" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (typeof body.invite !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.invite)) return NextResponse.json({ error: "Некорректное приглашение" }, { status: 422 })
  try {
    const result = await db.$transaction(tx => joinByInvitation(tx, body.invite, user.id))
    const response = NextResponse.json(result)
    response.cookies.set(projectCookie(user.id, result.project.id))
    return response
  } catch (error: any) {
    return NextResponse.json({ error: error?.message === "invite-invalid" ? "Приглашение недействительно или уже использовано" : "Не удалось принять приглашение" }, { status: error?.message === "invite-invalid" ? 403 : 500 })
  }
}
