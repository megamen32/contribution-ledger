// HTTP tests use a new isolated database and the actual production build.
import assert from "node:assert/strict"
import { openSync, closeSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import { newInviteToken, tokenHash } from "../src/lib/account"
import { parseRegistrationLink, restoreRegistrationLink } from "../src/lib/registration-link"

assert.deepEqual(parseRegistrationLink("#setup=abc_123"), { kind: "setup", token: "abc_123" })
assert.deepEqual(parseRegistrationLink("#invite=abc-123"), { kind: "invite", token: "abc-123" })
for (const bad of ["", "#setup=", "#setup=%3Cscript%3E", "#invite=" + "x".repeat(65)]) assert.equal(parseRegistrationLink(bad), null)
assert.deepEqual(restoreRegistrationLink('{"kind":"setup","token":"abc_123"}'), { kind: "setup", token: "abc_123" })
for (const bad of [null, "garbage", "null", '{"kind":"admin","token":"x"}']) assert.equal(restoreRegistrationLink(bad), null)
console.log("PASS: owner/member links stay distinct and survive a reload")

const databaseUrl = process.env.DATABASE_URL ?? ""
assert.ok(databaseUrl.startsWith("file:"))
const databasePath = resolve(databaseUrl.slice(5))
assert.ok(basename(databasePath).startsWith("test-owner-"), "Refusing production database")
const db = new PrismaClient()
assert.equal(await db.user.count(), 0, "Use a new test database")
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const port = Number(process.env.OWNER_TEST_PORT || 8773)
const origin = `http://127.0.0.1:${port}`
const log = openSync(databasePath + ".http.log", "w", 0o600)
const child = spawn("/usr/local/bin/node", ["server.js"], {
  cwd: process.env.STANDALONE_DIR || resolve(webRoot, ".next/standalone"),
  stdio: ["ignore", log, log],
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: origin, NEXTAUTH_URL: origin, NEXTAUTH_SECRET: "synthetic-owner-setup-test-not-production", NEXT_TELEMETRY_DISABLED: "1" },
})
type Jar = Map<string, string>
async function request(path: string, body?: object | URLSearchParams, jar: Jar = new Map(), requestOrigin = origin) {
  const headers: Record<string, string> = { Origin: requestOrigin }
  if (jar.size) headers.Cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ")
  if (body) headers["Content-Type"] = body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json"
  const res = await fetch(origin + path, { method: body ? "POST" : "GET", headers, body: body ? (body instanceof URLSearchParams ? body : JSON.stringify(body)) : undefined, redirect: "manual", signal: AbortSignal.timeout(15000) })
  for (const cookie of res.headers.getSetCookie()) { const value = cookie.split(";", 1)[0]; const index = value.indexOf("="); jar.set(value.slice(0, index), value.slice(index + 1)) }
  const text = await res.text()
  let value: any
  try { value = JSON.parse(text) } catch { value = text }
  return { status: res.status, value }
}
async function login(name: string, password: string, jar: Jar) {
  const csrf = await request("/api/auth/csrf", undefined, jar)
  assert.equal(csrf.status, 200)
  return request("/api/auth/callback/credentials", new URLSearchParams({ login: name, password, csrfToken: csrf.value.csrfToken, json: "true", callbackUrl: origin + "/" }), jar)
}
try {
  let ready = false
  for (let count = 0; count < 60; count++) {
    if (child.exitCode !== null) throw new Error("Test server exited; see isolated HTTP log")
    try { ready = (await request("/api/health")).status === 200 } catch {}
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready)
  const token = newInviteToken()
  const body = { login: "owner-test", displayName: "Synthetic owner", password: "1", invite: token }
  assert.equal((await request("/api/account/setup", body)).status, 403)
  await db.ownerSetup.create({ data: { id: "first-owner", tokenHash: tokenHash(token), expiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await request("/api/account/setup", body)).status, 403)
  await db.ownerSetup.update({ where: { id: "first-owner" }, data: { expiresAt: new Date(Date.now() + 60000) } })
  assert.equal((await request("/api/account/setup", { ...body, invite: "wrong" })).status, 403)
  assert.equal((await request("/api/account/setup", { ...body, password: "" })).status, 422)
  assert.equal((await request("/api/account/setup", body, new Map(), "https://untrusted.invalid")).status, 403)
  assert.equal((await request("/api/account/register", body)).status, 403)
  assert.equal(await db.user.count(), 0)
  console.log("PASS: unissued, expired, incorrect and cross-origin setup attempts rejected; no open owner signup")

  const results = await Promise.all([request("/api/account/setup", body), request("/api/account/setup", { ...body, login: "other-owner" })])
  assert.equal(results.filter(result => result.status === 201).length, 1, JSON.stringify(results))
  assert.ok(results.every(result => [201, 403, 409].includes(result.status)), JSON.stringify(results))
  assert.equal(await db.userCredential.count(), 1)
  assert.equal(await db.user.count({ where: { role: "admin" } }), 1)
  assert.ok((await db.ownerSetup.findUniqueOrThrow({ where: { id: "first-owner" } })).usedAt)
  assert.equal((await request("/api/account/setup", body)).status, 403)
  const owner = await db.userCredential.findFirstOrThrow()
  const jar: Jar = new Map()
  assert.equal((await login(owner.login, "1", jar)).status, 200)
  assert.equal((await request("/api/me", undefined, jar)).value.user.role, "admin")
  console.log("PASS: exactly one first owner; one-digit password; ordinary login and authenticated session")

  const invite = await request("/api/account/invite", {}, jar)
  assert.equal(invite.status, 200)
  const memberToken = new URLSearchParams(new URL(invite.value.url).hash.slice(1)).get("invite")
  const memberBody = { login: "member-test", displayName: "Synthetic member", password: "2", invite: memberToken }
  assert.equal((await request("/api/account/register", memberBody)).status, 201)
  assert.equal((await request("/api/account/register", memberBody)).status, 403)
  const memberJar: Jar = new Map()
  assert.equal((await login("member-test", "2", memberJar)).status, 200)
  assert.equal((await request("/api/me", undefined, memberJar)).value.user.role, "member")
  assert.equal((await request("/api/account/invite", {}, memberJar)).status, 403)
  console.log("PASS: owner creates teammate invitation; invited member registers and logs in; no owner privileges")
} finally {
  child.kill("SIGTERM")
  if (child.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve() }, 5000); child.once("exit", () => { clearTimeout(timer); resolve() }) })
  closeSync(log)
  await db.$disconnect()
}
