// Canonical JSON hashing — port of B's rules.canonical_bytes / digest.
// Spec invariants: no floats in hashed accounting packets; object keys sorted;
// list order preserved; deterministic SHA-256 for idempotency + reproducibility.

import { createHash } from "crypto"

/**
 * Normalize a value for canonical serialization.
 * - Rejects floats (forbidden in hashed accounting packets — use integer minor units).
 * - Sorts object keys recursively.
 * - Preserves array order (list order is significant).
 * - Primitives (string, boolean, null) pass through; integers pass through.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number forbidden in canonical JSON")
    if (!Number.isInteger(value)) throw new Error("floating-point values are forbidden in hashed accounting packets")
    return value
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v))
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalize(obj[key])
    }
    return out
  }
  throw new Error("unsupported canonical JSON value: " + typeof value)
}

/** Canonical UTF-8 bytes: sorted keys, no whitespace, no floats, no NaN. */
export function canonicalBytes(value: unknown): Buffer {
  const normalized = canonicalize(value)
  // JSON.stringify with no whitespace; ensure_ascii=false to keep Cyrillic readable & stable
  const text = JSON.stringify(normalized, (_k, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error("NaN/Infinity forbidden")
    return v
  })
  return Buffer.from(text, "utf8")
}

/** Stable SHA-256 hex digest (64 chars) of the canonical serialization. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalBytes(value)).digest("hex")
}

/** Short digest prefix for display (first 12 hex chars). */
export function digestShort(value: unknown): string {
  return digest(value).slice(0, 12)
}
