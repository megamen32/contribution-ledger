import { getServerSession } from "next-auth"
import { authOptions } from "./auth-options"
import { db } from "./db"

export async function getCurrentUser() {
  const session = await getServerSession(authOptions)
  const uid = (session?.user as any)?.id
  if (!uid) return null
  const user = await db.user.findUnique({ where: { id: String(uid) } })
  return user && user.active ? user : null
}
