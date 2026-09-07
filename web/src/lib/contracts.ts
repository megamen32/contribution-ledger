// Normative JSON contracts — Zod ports of B's contribution_spec.contracts.
// These are the single source of truth for blind packets, judge answers,
// market rates, evidence, and model profiles. .strict() forbids identity fields.

import { z } from "zod"

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/)

export const NonEmptySchema = z.string().min(1).max(20000)
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/)

// --- Evidence & sources ---------------------------------------------------

export const EvidenceKindSchema = z.enum([
  "artifact_excerpt",
  "participant_statement",
  "inference",
])

export const EvidenceSchema = z
  .object({
    evidence_id: IdentifierSchema,
    kind: EvidenceKindSchema,
    text: NonEmptySchema,
  })
  .strict()

export const SourceExcerptSchema = z
  .object({
    evidence_id: IdentifierSchema,
    artifact_id: IdentifierSchema.nullable(),
    locator: NonEmptySchema.nullable(),
    kind: EvidenceKindSchema,
    text: NonEmptySchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === "artifact_excerpt" && (v.artifact_id === null || v.locator === null)) {
      ctx.addIssue({
        code: "custom",
        message: "artifact_excerpt requires a resolvable artifact_id and locator",
      })
    }
  })

export const ClaimSchema = z
  .object({
    text: NonEmptySchema,
    basis: EvidenceKindSchema,
    evidence_ids: z.array(IdentifierSchema).min(1),
  })
  .strict()

// --- MarketRate -----------------------------------------------------------

export const RateProvenanceSchema = z.enum([
  "external_reference",
  "team_assumption",
  "synthetic_fixture",
])

export const MarketRateSchema = z
  .object({
    rate_id: IdentifierSchema,
    category: NonEmptySchema,
    grade: z.enum(["junior", "middle", "senior", "expert", "unspecified"]),
    currency: CurrencySchema,
    low_minor_per_hour: z.number().int().min(0),
    high_minor_per_hour: z.number().int().min(0),
    basis: z.literal("contractor_hour").default("contractor_hour"),
    market: NonEmptySchema,
    provenance: RateProvenanceSchema,
    source: NonEmptySchema,
    checked_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.high_minor_per_hour < v.low_minor_per_hour) {
      ctx.addIssue({ code: "custom", message: "unordered rate range" })
    }
  })

// --- BlindPacket (anonymized judge input) ---------------------------------

export const BlindPacketSchema = z
  .object({
    schema_version: z.literal("2.0"),
    packet_id: IdentifierSchema,
    scope: NonEmptySchema,
    goal: NonEmptySchema,
    constraints: z.array(NonEmptySchema),
    available_tools: z.array(NonEmptySchema),
    outcome: NonEmptySchema,
    result_status: z.enum([
      "complete",
      "partial",
      "negative_research",
      "learning",
      "unknown",
    ]),
    evidence: z.array(EvidenceSchema).min(1),
    limitations: z.array(NonEmptySchema),
    omitted_material: z.array(NonEmptySchema),
    visual_review_required: z.boolean(),
    rate_card_id: IdentifierSchema,
    rates: z.array(MarketRateSchema),
  })
  .strict()
  .superRefine((v, ctx) => {
    // duplicate evidence IDs
    const ids = v.evidence.map((e) => e.evidence_id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "duplicate evidence reference ID" })
    }
    // duplicate rate IDs
    const rids = v.rates.map((r) => r.rate_id)
    if (new Set(rids).size !== rids.length) {
      ctx.addIssue({ code: "custom", message: "duplicate rate reference ID" })
    }
  })

export type BlindPacket = z.infer<typeof BlindPacketSchema>
export type MarketRate = z.infer<typeof MarketRateSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type SourceExcerpt = z.infer<typeof SourceExcerptSchema>
export type Claim = z.infer<typeof ClaimSchema>

// --- JudgeAnswer (model output contract) ----------------------------------

export const JudgeAnswerSchema = z
  .object({
    schema_version: z.literal("2.0"),
    packet_id: IdentifierSchema,
    assessment: z.enum(["assessable", "needs_information"]),
    category: NonEmptySchema,
    grade: z.enum(["junior", "middle", "senior", "expert", "unknown"]),
    complexity: z.number().int().min(1).max(5).nullable(),
    typical_duration: z
      .object({
        low_seconds: z.number().int().min(0),
        high_seconds: z.number().int().min(0),
      })
      .nullable(),
    price_status: z.enum(["rate_available", "no_price_data"]),
    rate_id: IdentifierSchema.nullable(),
    evidence_ids: z.array(IdentifierSchema),
    limitations: z.array(NonEmptySchema),
    missing_information: z.array(NonEmptySchema),
    rationale: NonEmptySchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    // duplicate evidence refs
    if (new Set(v.evidence_ids).size !== v.evidence_ids.length) {
      ctx.addIssue({ code: "custom", message: "duplicate evidence references" })
    }
    if (v.assessment === "needs_information") {
      if (v.typical_duration !== null || v.price_status !== "no_price_data") {
        ctx.addIssue({
          code: "custom",
          message: "insufficient information cannot silently yield a price",
        })
      }
      if (v.missing_information.length === 0) {
        ctx.addIssue({ code: "custom", message: "explain which information is missing" })
      }
    }
    if (v.price_status === "rate_available") {
      if (v.rate_id === null || v.typical_duration === null) {
        ctx.addIssue({ code: "custom", message: "a price needs both a rate and duration" })
      }
    } else if (v.rate_id !== null) {
      ctx.addIssue({ code: "custom", message: "no_price_data requires a null rate_id" })
    }
  })

export type JudgeAnswer = z.infer<typeof JudgeAnswerSchema>

// --- ModelProfile (3 distinct model families × 3 samples) -----------------

export const ModelSpecSchema = z
  .object({
    key: IdentifierSchema,
    family: IdentifierSchema,
    tag: NonEmptySchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    runtime_version: NonEmptySchema,
    quantization: NonEmptySchema,
  })
  .strict()

export const ModelProfileSchema = z
  .object({
    profile_id: IdentifierSchema,
    models: z.array(ModelSpecSchema).min(3).max(3),
    samples_per_model: z.literal(3),
    temperature: z.number().min(0).max(2).default(0.2),
    seeds: z.array(z.number().int().min(0)).min(3).max(3),
    max_output_tokens: z.number().int().min(128).max(16384).default(1536),
    simulation_mode: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const attr of ["key", "family", "digest"] as const) {
      const vals = v.models.map((m) => m[attr])
      if (new Set(vals).size !== 3) {
        ctx.addIssue({
          code: "custom",
          message: `three distinct model ${attr} values are required`,
        })
      }
    }
    if (new Set(v.seeds).size !== 3) {
      ctx.addIssue({
        code: "custom",
        message: "three declared distinct sampling seeds are required",
      })
    }
  })

export type ModelProfile = z.infer<typeof ModelProfileSchema>
export type ModelSpec = z.infer<typeof ModelSpecSchema>

// --- Report content (what the author approves) ----------------------------

export const ReportContentSchema = z
  .object({
    goal: NonEmptySchema,
    actions: z.array(ClaimSchema).max(30),
    result: ClaimSchema,
    result_status: z.enum([
      "complete",
      "partial",
      "negative_research",
      "learning",
      "unknown",
    ]),
    excerpts: z.array(SourceExcerptSchema).min(1),
    omitted_material: z.array(NonEmptySchema),
    limitations: z.array(NonEmptySchema),
    suggested_task_split: z.array(NonEmptySchema),
  })
  .strict()

export type ReportContent = z.infer<typeof ReportContentSchema>

// --- Validation helpers ---------------------------------------------------

/** Validate a judge answer against a packet. Returns a list of error strings (empty = valid).
 *  Port of B's rules.validate_answer. */
export function validateAnswer(packet: BlindPacket, answer: JudgeAnswer): string[] {
  const errors: string[] = []
  if (packet.packet_id !== answer.packet_id) {
    errors.push("answer belongs to a different packet")
  }
  const evidenceIds = new Set(packet.evidence.map((e) => e.evidence_id))
  for (const eid of answer.evidence_ids) {
    if (!evidenceIds.has(eid)) errors.push(`unknown evidence reference: ${eid}`)
  }
  if (answer.assessment === "assessable" && answer.evidence_ids.length === 0) {
    errors.push("an assessment needs at least a labeled self-report or excerpt")
  }
  if (answer.rate_id !== null) {
    const rateIds = new Set(packet.rates.map((r) => r.rate_id))
    if (!rateIds.has(answer.rate_id)) {
      errors.push("unknown rate; model-generated rates are not accepted")
    }
  }
  return errors
}
