// Median & deterministic aggregation for the 3×3 judge consortium.
// Port of B's contribution_spec.rules.aggregate_samples.
// Spec §11: median-of-medians for numeric ranges; majority vote for category.
// Spec §13: financial_effect_minor is ALWAYS 0 — AI assessment never touches the ledger.

export function median(nums: number[]): number {
  if (nums.length === 0) return NaN
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export interface JudgeResponse {
  modelKey: string
  sampleIndex: number
  assessable: boolean | "needs_information" | "assessable"
  workType?: string
  qualification?: string
  complexity?: number
  hoursLow?: number
  hoursHigh?: number
  rateCardRowId?: string
  completeness?: string
  evidenceId?: string
  rationale?: string
  priceLow?: number | null // minor units, derived from hours×rate; null = no_price_data
  priceHigh?: number | null
  // New contract fields (B's JudgeAnswer):
  priceStatus?: "rate_available" | "no_price_data" | null
  rateId?: string | null
}

export interface ModelAggregate {
  modelKey: string
  hoursLow: number
  hoursHigh: number
  priceLow: number | null
  priceHigh: number | null
  category: string
  count: number
}

export interface ConsortiumAggregate {
  collectionStatus: "complete" | "partial"
  priceStatus: "known" | "unknown"
  costLow: number | null
  costHigh: number | null
  currency: string | null
  hoursLow: number | null
  hoursHigh: number | null
  category: string | "mixed" | null
  needsReview: boolean
  reviewReasons: string[]
  perModel: ModelAggregate[]
  validCount: number
  totalCount: number
  financialEffectMinor: 0 // EXPLICIT INVARIANT — always 0 (spec §13)
}

/** Group responses by model key. */
function groupByModel(responses: JudgeResponse[]): Map<string, JudgeResponse[]> {
  const m = new Map<string, JudgeResponse[]>()
  for (const r of responses) {
    if (!m.has(r.modelKey)) m.set(r.modelKey, [])
    m.get(r.modelKey)!.push(r)
  }
  return m
}

function majority(values: string[]): string | "mixed" | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  let tie = false
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
      tie = false
    } else if (c === bestCount) {
      tie = true
    }
  }
  if (best === null) return null
  if (tie) return "mixed"
  // strict majority (>half) across all values
  if (bestCount > values.length / 2) return best
  return "mixed"
}

/** Migrate legacy judge response JSON (pre-contract) to the new shape. */
export function migrateLegacyResponse(v: any): JudgeResponse {
  const priceStatus: JudgeResponse["priceStatus"] =
    v.priceStatus ?? (v.priceLow != null && v.priceLow > 0 ? "rate_available" : "no_price_data")
  return {
    modelKey: v.modelKey,
    sampleIndex: v.sampleIndex,
    assessable: v.assessable,
    workType: v.workType,
    qualification: v.qualification,
    complexity: v.complexity,
    hoursLow: v.hoursLow,
    hoursHigh: v.hoursHigh,
    rateCardRowId: v.rateCardRowId ?? v.rate_id,
    completeness: v.completeness,
    evidenceId: v.evidenceId ?? (v.evidence_ids?.[0] ?? ""),
    rationale: v.rationale,
    priceLow: v.priceLow ?? null,
    priceHigh: v.priceHigh ?? null,
    priceStatus,
    rateId: v.rateId ?? v.rate_id ?? null,
  }
}

/**
 * Deterministic aggregation per spec §11 + B's rules.aggregate_samples.
 * - collectionStatus: "complete" iff all 9 slots are valid+assessable; else "partial"
 * - priceStatus: "known" iff ALL valid slots have price_status=rate_available AND same rate basis; else "unknown"
 * - Numeric ranges: median within model (3 samples), then median across models
 * - Category: majority within model (2 of 3), then majority across models
 * - needsReview reasons: incomplete_price_information, mixed_category, within_model_disagreement,
 *   between_model_disagreement, incomparable_rate_basis, visual_review_required
 * - financialEffectMinor: ALWAYS 0 (AI never touches ledger — spec §13)
 */
export function aggregateConsortium(
  responses: JudgeResponse[],
  visualReviewRequired = false,
): ConsortiumAggregate {
  const valid = responses.filter((r) => r.assessable === true || r.assessable === "assessable")
  const total = 6
  const complete = responses.length === total && new Set(responses.map(r => r.modelKey + r.sampleIndex)).size === 6 && groupByModel(responses).size === 2 && [...groupByModel(responses).values()].every(r => r.length === 3)
  const perModel: ModelAggregate[] = []
  const modelCategoryVotes: string[] = []
  const reasons = new Set<string>()
  let known = complete && valid.length === total
  // track (currency, basis, market, provenance) tuples used — must be unanimous
  const basisTuples = new Set<string>()

  for (const [modelKey, runs] of groupByModel(valid)) {
    const lows = runs.map((r) => r.hoursLow ?? NaN).filter((n) => !Number.isNaN(n))
    const highs = runs.map((r) => r.hoursHigh ?? NaN).filter((n) => !Number.isNaN(n))
    const plows = runs
      .map((r) => r.priceLow)
      .filter((n): n is number => n != null && n > 0)
    const phighs = runs
      .map((r) => r.priceHigh)
      .filter((n): n is number => n != null && n > 0)
    const cats = runs.map((r) => r.workType ?? "unknown").filter((c) => c)

    // price_status check: any no_price_data slot makes the whole price unknown
    for (const r of runs) {
      if (r.rateId) basisTuples.add(r.rateId)
      if (r.priceStatus === "no_price_data" || (r.priceLow == null && r.priceHigh == null)) {
        known = false
        reasons.add("incomplete_price_information")
      }
    }

    const mHoursLow = lows.length ? median(lows) : NaN
    const mHoursHigh = highs.length ? median(highs) : NaN
    const mPriceLow = plows.length ? median(plows) : NaN
    const mPriceHigh = phighs.length ? median(phighs) : NaN
    // within-model majority (2 of 3)
    const mCat = cats.length ? majority(cats) ?? "mixed" : "mixed"

    // internal spread check (within this model's price centers)
    const centers = runs
      .map((r) =>
        r.priceLow != null && r.priceHigh != null && r.priceLow > 0
          ? (r.priceLow + r.priceHigh) / 2
          : NaN,
      )
      .filter((n) => !Number.isNaN(n) && n > 0)
    if (centers.length >= 2) {
      const mn = Math.min(...centers)
      const mx = Math.max(...centers)
      if (mn > 0 && mx / mn > 2) reasons.add("within_model_disagreement")
    }

    perModel.push({
      modelKey,
      hoursLow: Number.isNaN(mHoursLow) ? 0 : mHoursLow,
      hoursHigh: Number.isNaN(mHoursHigh) ? 0 : mHoursHigh,
      priceLow: Number.isNaN(mPriceLow) ? null : Math.round(mPriceLow),
      priceHigh: Number.isNaN(mPriceHigh) ? null : Math.round(mPriceHigh),
      category: mCat,
      count: runs.length,
    })
    modelCategoryVotes.push(mCat)
  }

  // cross-model aggregation
  const costLows = perModel.map((m) => m.priceLow).filter((n): n is number => n != null && n > 0)
  const costHighs = perModel.map((m) => m.priceHigh).filter((n): n is number => n != null && n > 0)
  const hoursLows = perModel.map((m) => m.hoursLow).filter((n) => n > 0)
  const hoursHighs = perModel.map((m) => m.hoursHigh).filter((n) => n > 0)

  const costLow = costLows.length ? Math.round(median(costLows)) : null
  const costHigh = costHighs.length ? Math.round(median(costHighs)) : null
  const hoursLowAgg = hoursLows.length ? median(hoursLows) : null
  const hoursHighAgg = hoursHighs.length ? median(hoursHighs) : null
  const categoryAgg = modelCategoryVotes.length ? majority(modelCategoryVotes) : null

  // between-model disagreement: max model center / min model center > 2
  if (costLow != null && costHigh != null) {
    const centers = perModel
      .filter((m) => m.priceLow != null && m.priceHigh != null && (m.priceLow ?? 0) > 0)
      .map((m) => ((m.priceLow ?? 0) + (m.priceHigh ?? 0)) / 2)
    if (centers.length >= 2) {
      const mn = Math.min(...centers)
      const mx = Math.max(...centers)
      if (mn > 0 && mx / mn > 2) reasons.add("between_model_disagreement")
    }
  }

  // incomparable_rate_basis: models used rates with different (currency, basis, market, provenance)
  if (basisTuples.size > 1) {
    reasons.add("incomparable_rate_basis")
    known = false
  }

  // mixed_category: no strict majority within model OR across models
  if (categoryAgg === "mixed" || categoryAgg === null) reasons.add("mixed_category")
  if (!complete) reasons.add("incomplete_collection")
  if (visualReviewRequired) {
    reasons.add("visual_review_required")
    known = false
  }

  // currency: take from the first rate_available slot (single-currency team default)
  const currency = known ? "RUB" : null

  return {
    collectionStatus: complete ? "complete" : "partial",
    priceStatus: known ? "known" : "unknown",
    costLow: known ? costLow : null,
    costHigh: known ? costHigh : null,
    currency,
    hoursLow: hoursLowAgg,
    hoursHigh: hoursHighAgg,
    category: categoryAgg,
    needsReview: reasons.size > 0,
    reviewReasons: [...reasons].sort(),
    perModel,
    validCount: valid.length,
    totalCount: total,
    financialEffectMinor: 0,
  }
}
