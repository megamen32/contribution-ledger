import type { NextAuthOptions } from "next-auth"
import { readFileSync } from "node:fs"
import CredentialsProvider from "next-auth/providers/credentials"
import * as argon2 from "argon2"
import { db } from "./db"
import { validatePassword } from "./account"

const authSecret = process.env.NEXTAUTH_SECRET || (process.env.NEXTAUTH_SECRET_FILE ? readFileSync(process.env.NEXTAUTH_SECRET_FILE, "utf8").trim() : "")
if (!authSecret) throw new Error("NEXTAUTH_SECRET is not configured")
export const authOptions: NextAuthOptions = {
  secret: authSecret,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [CredentialsProvider({
    name: "Vklad account",
    credentials: { login: { label: "Логин", type: "text" }, password: { label: "Пароль", type: "password" } },
    async authorize(credentials) {
      const login = credentials?.login?.trim().toLowerCase() ?? ""
      const password = credentials?.password ?? ""
      if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(login) || !validatePassword(password)) return null
      const credential = await db.userCredential.findUnique({ where: { login }, include: { user: true } })
      if (!credential || !credential.user.active) { await argon2.verify("$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpamtsbW5vcA$AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", password).catch(() => false); return null }
      if (credential.lockedUntil && credential.lockedUntil > new Date()) return null
      const ok = await argon2.verify(credential.passwordHash, password).catch(() => false)
      if (!ok) {
        const failed = credential.failedAttempts + 1
        await db.userCredential.update({ where: { userId: credential.userId }, data: { failedAttempts: failed >= 5 ? 0 : failed, lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null } })
        return null
      }
      await db.userCredential.update({ where: { userId: credential.userId }, data: { failedAttempts: 0, lockedUntil: null } })
      return { id: credential.user.id, name: credential.user.displayName, role: credential.user.role, sessionVersion: credential.sessionVersion }
    },
  })],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.uid = user.id; token.role = (user as any).role; token.sv = (user as any).sessionVersion }
      if (token.uid) {
        const current = await db.userCredential.findUnique({ where: { userId: String(token.uid) }, include: { user: true } })
        if (!current || !current.user.active || current.sessionVersion !== token.sv) { token.uid = undefined; token.role = undefined }
      }
      return token
    },
    async session({ session, token }) {
      if (!token.uid) return { ...session, user: undefined } as any
      if (session.user) { (session.user as any).id = token.uid; (session.user as any).role = token.role }
      return session
    },
  },
}
