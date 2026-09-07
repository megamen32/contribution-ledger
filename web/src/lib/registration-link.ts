export type RegistrationLink = { kind: "setup" | "invite"; token: string }
export const REGISTRATION_LINK_KEY = "vklad.registration-link"

export function parseRegistrationLink(hash: string): RegistrationLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""))
  for (const kind of ["setup", "invite"] as const) {
    const token = params.get(kind)
    if (token && /^[A-Za-z0-9_-]{1,64}$/.test(token)) return { kind, token }
  }
  return null
}

export function restoreRegistrationLink(value: string | null): RegistrationLink | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if ((parsed.kind === "setup" || parsed.kind === "invite") && typeof parsed.token === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(parsed.token)) return parsed
  } catch { /* A closed or invalid invitation does not prevent ordinary sign-in. */ }
  return null
}
