// Run locally by the server operator. Never returns a setup invitation over a public API.
import { PrismaClient } from "@prisma/client"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import { newInviteToken, tokenHash } from "../src/lib/account"

const output = process.argv[2]
if (!output || !isAbsolute(output)) throw new Error("Provide an absolute private output file path")
const db = new PrismaClient()
try {
  if (await db.userCredential.count()) throw new Error("An account already exists; owner setup is closed")
  const previous = await db.ownerSetup.findUnique({ where: { id: "first-owner" } })
  if (previous?.usedAt) throw new Error("Owner setup has already been used")
  if (existsSync(output)) {
    const saved = new URL(readFileSync(output, "utf8").trim())
    const token = new URLSearchParams(saved.hash.slice(1)).get("setup")
    if (!token || !previous || previous.tokenHash !== tokenHash(token) || previous.expiresAt <= new Date()) throw new Error("Existing setup file is not valid; review before issuing another")
    console.log("Existing one-use owner invitation remains valid; link not printed")
  } else {
    const token = newInviteToken()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000)
    await db.$transaction(async tx => {
      if (await tx.userCredential.count()) throw new Error("Owner setup is closed")
      await tx.ownerSetup.upsert({
        where: { id: "first-owner" },
        create: { id: "first-owner", tokenHash: tokenHash(token), expiresAt },
        update: { tokenHash: tokenHash(token), expiresAt },
      })
    })
    writeFileSync(output, `https://vklad.bezrabotnyi.com/login#setup=${token}\n`, { mode: 0o600, flag: "wx" })
    console.log(`One-use owner invitation saved privately; expires ${expiresAt.toISOString()}; no account or password created`)
  }
} finally { await db.$disconnect() }
