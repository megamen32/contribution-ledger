// Blind-packet construction: allowlist projection of an approved report into an
// anonymized judge input. Port of B's rules.make_blind_packet + ai_routes.redact_text.
//
// CRITICAL: this is an allowlist transform, NOT "ask the model to forget the name".
// Identity fields (member_id, user_id, actual_hours, personal_rate, money, email,
// avatar, personal paths) are structurally excluded by BlindPacketSchema.strict().
// Evidence IDs are re-numbered to e001, e002, ... to strip original IDs that might
// leak identity (e.g. "anna-research-notes").
//
// Free-text identity review is STILL REQUIRED separately — see findKnownIdentifiers.

import type { BlindPacket, MarketRate, ReportContent } from "./contracts"

/** Build a blind packet from an approved report. Allowlist projection only.
 *  Evidence IDs are re-numbered to e001..eNNN. */
export function makeBlindPacket(
  report: ReportContent,
  opts: {
    packetId: string
    scope: string
    availableTools: string[]
    constraints: string[]
    rates: MarketRate[]
    rateCardId: string
    visualReviewRequired?: boolean
  },
): BlindPacket {
  const packet: BlindPacket = {
    schema_version: "2.0",
    packet_id: opts.packetId,
    scope: opts.scope,
    goal: report.goal,
    constraints: opts.constraints,
    available_tools: opts.availableTools,
    outcome: report.result.text,
    result_status: report.result_status,
    evidence: report.excerpts.map((e, i) => ({
      // re-number to strip original IDs that might leak identity
      evidence_id: `e${String(i + 1).padStart(3, "0")}`,
      kind: e.kind,
      text: e.text,
    })),
    limitations: report.limitations,
    omitted_material: report.omitted_material,
    visual_review_required: opts.visualReviewRequired ?? false,
    rate_card_id: opts.rateCardId,
    rates: opts.rates,
  }
  return packet
}

/** Flag known literal identifiers (member names, emails) found in the packet text.
 *  Returns the list of names found. This is a literal substring check, NOT NLP —
 *  a "no known names found" result does not promise complete anonymization. */
export function findKnownIdentifiers(packet: BlindPacket, names: string[]): string[] {
  const text = JSON.stringify(packet).casefold()
  return names.filter((n) => n && n.length >= 3 && text.includes(n.casefold()))
}

/** Replace known names (>=3 chars), emails, and home-directory paths with redaction
 *  markers. Port of B's ai_routes.redact_text. Only natural-language fields are scrubbed;
 *  identifier/reference structure stays intact. */
export function redactText(text: string, names: string[]): string {
  let out = text
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    if (name.length >= 3) {
      out = out.replace(new RegExp(escapeRegExp(name), "gi"), "[участник]")
    }
  }
  // emails
  out = out.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[почта]")
  // home paths: /Users/x, /home/x, C:\Users\x
  out = out.replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s/\\]+/g, "[домашний каталог]")
  return out
}

/** Scrub all natural-language text fields of a packet in place. Returns a new packet. */
export function redactPacket(packet: BlindPacket, names: string[]): BlindPacket {
  const out: BlindPacket = { ...packet }
  out.scope = redactText(out.scope, names)
  out.goal = redactText(out.goal, names)
  out.outcome = redactText(out.outcome, names)
  out.constraints = out.constraints.map((c) => redactText(c, names))
  out.available_tools = out.available_tools.map((t) => redactText(t, names))
  out.limitations = out.limitations.map((l) => redactText(l, names))
  out.omitted_material = out.omitted_material.map((m) => redactText(m, names))
  out.evidence = out.evidence.map((e) => ({ ...e, text: redactText(e.text, names) }))
  // append a review reminder
  out.limitations = [
    ...out.limitations,
    "Проверьте имена, личную ставку и фактические часы в тексте перед оценкой.",
  ]
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Extend String prototype for casefold (lowercase unicode) — lightweight
declare global {
  interface String {
    casefold(): string
  }
}
String.prototype.casefold = function (this: string) {
  return this.toLowerCase()
}
