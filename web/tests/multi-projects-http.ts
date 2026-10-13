// Focused HTTP integration: actual authentication, project cookies, stale-page guard and favicon. Expected 10s, max 30s.
import assert from "node:assert/strict"
import { openSync, closeSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { PrismaClient } from "@prisma/client"
const databaseUrl = process.env.DATABASE_URL ?? ""
assert.ok(databaseUrl.startsWith("file:"))
const databasePath = resolve(databaseUrl.slice(5))
assert.ok(basename(databasePath).startsWith("test-multi-projects-http-"), "Refusing production database")
const db = new PrismaClient()
assert.equal(await db.user.count(), 0, "Use a new test database")
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const port = Number(process.env.MULTI_TEST_PORT || 8775)
const origin = `http://127.0.0.1:${port}`
const log = openSync(databasePath + ".http.log", "w", 0o600)
const child = spawn("/usr/local/bin/node", ["server.js"], {
  cwd: process.env.STANDALONE_DIR || resolve(webRoot, ".next/standalone"),
  stdio: ["ignore", log, log],
  env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: origin, NEXTAUTH_URL: origin, NEXTAUTH_SECRET: "synthetic-multi-project-http-not-production", NEXT_TELEMETRY_DISABLED: "1" },
})
type Jar = Map<string, string>
async function request(path: string, body?: object | URLSearchParams, jar: Jar = new Map(), requestOrigin = origin, extraHeaders: Record<string,string> = {}) {
  const headers: Record<string, string> = { Origin: requestOrigin, ...extraHeaders }
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
  const password = "synthetic-multi-project-http-check"
  const register = async (loginName:string) => {
    const result=await request("/api/account/register",{login:loginName,displayName:loginName,password,projectName:loginName})
    assert.equal(result.status,201); return result.value
  }
  const a=await register("http_owner_a"),b=await register("http_owner_b")
  const jarA:Jar=new Map(),jarB:Jar=new Map()
  assert.equal((await login("http_owner_a",password,jarA)).status,200)
  assert.equal((await login("http_owner_b",password,jarB)).status,200)
  const invitation=await request("/api/account/invite",{},jarA)
  assert.equal(invitation.status,200)
  const token=new URLSearchParams(new URL(invitation.value.url).hash.slice(1)).get("invite")
  assert.equal((await request("/api/account/invite/accept",{invite:token})).status,401)
  assert.equal((await request("/api/account/invite/accept",{invite:token},jarB)).status,200)
  let me=await request("/api/me",undefined,jarB)
  assert.equal(me.value.project.id,a.project.id)
  assert.equal(me.value.user.role,"member")
  assert.equal(me.value.projects.length,2)
  assert.equal((await request("/api/account/invite",{},jarB)).status,403)
  assert.equal((await request("/api/projects/switch",{projectId:b.project.id},jarB)).status,200)
  me=await request("/api/me",undefined,jarB)
  assert.equal(me.value.project.id,b.project.id)
  assert.equal(me.value.user.role,"admin")
  assert.equal((await request("/api/tasks",{title:"stale foreign page"},jarB,origin,{"X-Vklad-Project":a.project.id})).status,401)
  assert.equal(await db.task.count(),0)
  assert.equal((await request("/api/projects/switch",{projectId:b.project.id},jarA)).status,403)
  assert.equal((await request("/api/account/invite/accept",{invite:token},jarB)).status,200)
  assert.equal((await request("/api/me",undefined,jarB)).value.project.id,a.project.id)
  const icon=await fetch(origin+"/favicon.ico")
  assert.equal(icon.status,200)
  assert.match(icon.headers.get("content-type")||"",/image/)
  assert.deepEqual([...new Uint8Array(await icon.arrayBuffer()).slice(0,4)],[0,0,1,0])
  assert.equal((await fetch(origin+"/icon.svg")).status,200)
  assert.match((await request("/login")).value,/rel="icon"[^>]*href="\/favicon.ico/)
  console.log("PASS: authenticated existing-account invitation, project-cookie switching, role boundaries, stale-page write rejected, ICO/SVG and HTML favicon metadata")
} finally {
  child.kill("SIGTERM")
  if (child.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve() }, 5000); child.once("exit", () => { clearTimeout(timer); resolve() }) })
  closeSync(log)
  await db.$disconnect()
}
