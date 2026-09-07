// Money utilities — all amounts stored as signed minor units (kopecks/cents).
// Decimal math via integer arithmetic; HALF_UP rounding on confirmation.

/** Format minor units -> human string with currency. */
export function formatMoney(minor: number, currency = "RUB"): string {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const frac = abs % 100
  const majorStr = major.toLocaleString("ru-RU")
  const fracStr = frac.toString().padStart(2, "0")
  const sym = currencySymbol(currency)
  const out = `${majorStr},${fracStr}\u00A0${sym}`
  return neg ? `−${out}` : out
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case "RUB": return "₽"
    case "USD": return "$"
    case "EUR": return "€"
    default: return currency
  }
}

/** Round a Decimal-like number to minor units with HALF_UP. */
export function roundHalfUpMinor(value: number): number {
  // value is in major units (e.g. rubles with fraction)
  const scaled = value * 100
  // HALF_UP
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let result: number
  if (diff > 0.5) result = floor + 1
  else if (diff < 0.5) result = floor
  else result = floor + 1 // exactly 0.5 -> up
  return result
}

/** Compute labor value: confirmed hours * agreed hourly rate (minor).
 *  Both inputs and the result are in minor units (kopecks). HALF_UP to integer minor.
 *  @deprecated Use grossMinor() for split-invariant bucketed rounding. Kept for compat. */
export function laborValue(confirmedSeconds: number, ratePerHourMinor: number): number {
  return grossMinor(confirmedSeconds, ratePerHourMinor)
}

/** gross_minor: HALF_UP rounding of seconds × hourly_rate_minor / 3600 to integer minor.
 *  Uses BigInt internally to avoid float drift. Port of B's rules.gross_minor.
 *  Invariant: splitting work into fragments and summing grossMinor() of each fragment
 *  independently CAN drift — use bucketDelta() for cumulative buckets. */
export function grossMinor(seconds: number, ratePerHourMinor: number): number {
  if (seconds < 0 || ratePerHourMinor < 0) throw new Error("seconds and rate must be nonnegative")
  if (seconds === 0 || ratePerHourMinor === 0) return 0
  // exact minor = seconds × rate / 3600. BigInt for exactness; HALF_UP on the remainder.
  const prod = BigInt(seconds) * BigInt(ratePerHourMinor)
  const q = prod / 3600n
  const r = prod % 3600n
  return Number(r * 2n >= 3600n ? q + 1n : q)
}

/** bucket_delta: round the CUMULATIVE bucket total, return the delta from the previous
 *  rounded total. Guarantees split-invariance: sum(bucketDelta(prev, s_i)) == grossMinor(sum(s_i)).
 *  Port of B's rules.bucket_delta. */
export function bucketDelta(prevSeconds: number, addedSeconds: number, ratePerHourMinor: number): number {
  if (prevSeconds < 0 || addedSeconds < 0) throw new Error("seconds must be nonnegative")
  return grossMinor(prevSeconds + addedSeconds, ratePerHourMinor) - grossMinor(prevSeconds, ratePerHourMinor)
}

/** unpaid_minor: gross − already_paid. Raises if already_paid > gross (overpayment is a
 *  separate obligation, not silently clamped to zero). Port of B's rules.unpaid_minor. */
export function unpaidMinor(gross: number, alreadyPaid: number): number {
  if (gross < 0 || alreadyPaid < 0) throw new Error("amounts must be nonnegative")
  if (alreadyPaid > gross) throw new Error("overpayment is a separate obligation; do not silently clamp it to zero")
  return gross - alreadyPaid
}

/** Format seconds as "Xч Yм" (Russian). */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0м"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0 && m > 0) return `${h}ч ${m}м`
  if (h > 0) return `${h}ч`
  return `${m}м`
}

/** Format seconds as HH:MM:SS for live timer. */
export function formatHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

/** Sum minor amounts. */
export function sumMinor(amounts: number[]): number {
  return amounts.reduce((a, b) => a + b, 0)
}
