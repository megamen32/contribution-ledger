import { PrismaClient } from "@prisma/client"
import { hashPassword, LOGIN_RE, normalizeLogin, validatePassword } from "../web/src/lib/account"
const db = new PrismaClient()
const login = normalizeLogin(process.env.VKLAD_BOOTSTRAP_LOGIN)
const password = process.env.VKLAD_BOOTSTRAP_PASSWORD
const name = process.env.VKLAD_BOOTSTRAP_NAME?.trim() || "Администратор"
if (!LOGIN_RE.test(login) || !validatePassword(password)) throw new Error("Set a valid login and a non-empty password")
if (await db.userCredential.count()) throw new Error("Bootstrap is disabled after the first account exists")
const passwordHash = await hashPassword(password)
const user = await db.$transaction(async tx => {
  await tx.workspace.upsert({where:{id:"legacy"},update:{},create:{id:"legacy",name:"Команда Вклада"}})
  const user = await tx.user.create({data:{displayName:name,email:`${crypto.randomUUID()}@vklad.invalid`,role:"admin",credential:{create:{login,passwordHash}}}})
  await tx.workspaceMembership.create({data:{workspaceId:user.workspaceId,userId:user.id,role:"admin"}})
  return user
})
console.log(`Created Vklad admin ${user.id}`)
await db.$disconnect()
