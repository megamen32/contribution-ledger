import { createHash, randomBytes } from "node:crypto"
import * as argon2 from "argon2"

export const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/
export function normalizeLogin(value: unknown) { return typeof value === "string" ? value.trim().toLowerCase() : "" }
export function validatePassword(value: unknown): value is string { return typeof value === "string" && value.length >= 12 && value.length <= 128 }
export function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex") }
export function newInviteToken() { return randomBytes(32).toString("base64url") }
export async function hashPassword(password: string) { return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }) }
