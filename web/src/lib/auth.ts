// Simple "current user" selector for the internal 5-person team.
// Spec §18: personal random codes; here we simulate with a cookie-set user id.
// This is an internal trusted tool, not a public SaaS.

import { cookies } from "next/headers"
import { db } from "./db"

export const SESSION_COOKIE = "vklad_uid"

export async function getCurrentUser() {
  const store = await cookies()
  const uid = store.get(SESSION_COOKIE)?.value
  if (!uid) return null
  const user = await db.user.findUnique({ where: { id: uid } })
  return user && user.active ? user : null
}

export async function setCurrentUser(uid: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, uid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function clearCurrentUser() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
