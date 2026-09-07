import { PrismaClient } from "@prisma/client"
import { hashPassword, LOGIN_RE, normalizeLogin, validatePassword } from "../web/src/lib/account"
const db = new PrismaClient()
const login = normalizeLogin(process.env.VKLAD_BOOTSTRAP_LOGIN)
const password = process.env.VKLAD_BOOTSTRAP_PASSWORD
const name = process.env.VKLAD_BOOTSTRAP_NAME?.trim() || "Администратор"
if (!LOGIN_RE.test(login) || !validatePassword(password)) throw new Error("Set a valid login and a 12+ character password")
if (await db.userCredential.count()) throw new Error("Bootstrap is disabled after the first account exists")
const user = await db.user.create({ data: { displayName: name, email: `${crypto.randomUUID()}@vklad.invalid`, role: "admin", credential: { create: { login, passwordHash: await hashPassword(password) } } } })
console.log(`Created Vklad admin ${user.id}`)
await db.$disconnect()
