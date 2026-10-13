// Run with Bun. HTTP mode requires a separately initialized test-password-*.db.
import assert from "node:assert/strict"
import { readFileSync, openSync, closeSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import * as argon2 from "argon2"
import { hashPassword, newInviteToken, tokenHash, validatePassword } from "../src/lib/account"

for (const value of ["1", "a", "я", " ", "12", "123456789012", "a".repeat(128)]) assert.equal(validatePassword(value), true)
for (const value of ["", null, undefined, 1, {}, [], "a".repeat(129)]) assert.equal(validatePassword(value), false)
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
for (const file of ["src/app/login/page.tsx", "src/components/account-settings.tsx"]) {
  const source = readFileSync(resolve(webRoot, file), "utf8")
  const fields = (source.match(/<Input\b.*?\/>/g) ?? []).filter(field => field.includes('type="password"'))
  assert.equal(fields.length, 2)
  for (const field of fields) { assert.ok(field.includes("required")); assert.ok(!field.includes("minLength")) }
}
console.log("PASS: non-empty passwords, including one character; empty/non-string values rejected; all four UI fields agree")

if (!process.argv.includes("--unit")) {
  const databaseUrl = process.env.DATABASE_URL ?? ""
  assert.ok(databaseUrl.startsWith("file:"), "Use an isolated SQLite database")
  const databasePath = resolve(databaseUrl.slice(5))
  assert.ok(basename(databasePath).startsWith("test-password-"), "Refusing to touch any non-test database")
  const { PrismaClient } = await import("@prisma/client")
  const db = new PrismaClient()
  const standalone = process.env.STANDALONE_DIR || resolve(webRoot, ".next/standalone")
  const port = Number(process.env.PASSWORD_TEST_PORT || 8772)
  const origin = `http://127.0.0.1:${port}`
  const log = openSync(databasePath + ".http.log", "w", 0o600)
  const child = spawn(process.execPath.includes("bun") ? "/usr/local/bin/node" : process.execPath, ["server.js"], {
    cwd: standalone, stdio: ["ignore", log, log],
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl, HOSTNAME: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: origin, NEXTAUTH_URL: origin, NEXTAUTH_SECRET: "synthetic-password-policy-test-not-production", NEXT_TELEMETRY_DISABLED: "1" },
  })
  type Jar = Map<string, string>
  async function request(path: string, body?: object | URLSearchParams, jar: Jar = new Map()) {
    const headers: Record<string,string> = { Origin: origin }
    if (jar.size) headers.Cookie = [...jar].map(([k,v]) => `${k}=${v}`).join("; ")
    if (body) headers["Content-Type"] = body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json"
    const response = await fetch(origin + path, { method: body ? "POST" : "GET", headers, body: body ? (body instanceof URLSearchParams ? body : JSON.stringify(body)) : undefined, redirect: "manual", signal: AbortSignal.timeout(15000) })
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(";", 1)[0]; const equal = part.indexOf("=")
      jar.set(part.slice(0,equal), part.slice(equal+1))
    }
    const text = await response.text()
    let value: any
    try { value = JSON.parse(text) } catch { value = text }
    return { status: response.status, value }
  }
  async function login(name: string, password: string, jar: Jar) {
    const csrf = await request("/api/auth/csrf", undefined, jar)
    assert.equal(csrf.status, 200)
    return request("/api/auth/callback/credentials", new URLSearchParams({ login: name, password, csrfToken: csrf.value.csrfToken, json: "true", callbackUrl: origin + "/" }), jar)
  }
  try {
    let ready = false
    for (let count=0; count<60; count++) {
      if (child.exitCode !== null) throw new Error("Test server exited; see the test HTTP log")
      try { ready = (await request("/api/health")).status === 200 } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(ready, "Test server did not become ready")
    const suffix = crypto.randomUUID().slice(0,8)
    const legacyPassword = "Existing-Long-Password-123!"
    await db.workspace.upsert({where:{id:"legacy"},update:{},create:{id:"legacy",name:"Synthetic fixture project"}})
    const owner = await db.user.create({ data: { displayName: "Password test fixture", email: `${suffix}@test.invalid`, role: "admin", credential: { create: { login: `owner-${suffix}`, passwordHash: await hashPassword(legacyPassword) } } } })
    const invite = newInviteToken()
    await db.inviteToken.create({ data: { tokenHash: tokenHash(invite), createdById: owner.id, expiresAt: new Date(Date.now()+60000) } })
    const registration = { login: `member-${suffix}`, displayName: "Synthetic member", password: "1", invite }
    assert.equal((await request("/api/account/register", { ...registration, password: "" })).status, 422)
    const registered = await request("/api/account/register", registration)
    assert.equal(registered.status, 201, JSON.stringify(registered))
    const credential = await db.userCredential.findUniqueOrThrow({ where: { userId: registered.value.user.id } })
    assert.ok(credential.passwordHash.startsWith("$argon2id$"))
    assert.ok(await argon2.verify(credential.passwordHash, "1"))
    console.log("PASS: real HTTP registration with a one-digit password; hashed storage; empty registration rejected")

    const jar: Jar = new Map()
    assert.equal((await login(registration.login, "1", jar)).status, 200)
    assert.equal((await request("/api/me", undefined, jar)).value.user.id, registered.value.user.id)
    console.log("PASS: real credentials login and authenticated session with one digit")
    assert.equal((await request("/api/account/password", { oldPassword: "1", password: "" }, jar)).status, 422)
    assert.equal((await request("/api/account/password", { oldPassword: "3", password: "2" }, jar)).status, 403)
    assert.equal((await request("/api/account/password", { oldPassword: "1", password: "2" }, jar)).status, 200)
    assert.equal((await request("/api/me", undefined, jar)).status, 401)
    const oldJar: Jar = new Map()
    assert.equal((await login(registration.login, "1", oldJar)).status, 401)
    const newJar: Jar = new Map()
    assert.equal((await login(registration.login, "2", newJar)).status, 200)
    assert.equal((await request("/api/me", undefined, newJar)).value.user.id, registered.value.user.id)
    console.log("PASS: one-digit password change; old password and old session rejected; new one-digit login works")
    const legacyJar: Jar = new Map()
    assert.equal((await login(`owner-${suffix}`, legacyPassword, legacyJar)).status, 200)
    assert.equal((await request("/api/me", undefined, legacyJar)).value.user.id, owner.id)
    console.log("PASS: existing longer passwords still work; no production data used")
  } finally {
    child.kill("SIGTERM")
    if (child.exitCode === null) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve() }, 5000)
      child.once("exit", () => { clearTimeout(timer); resolve() })
    })
    closeSync(log)
    await db.$disconnect()
  }
}
