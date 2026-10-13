// Real model calls; assessment never changes the financial ledger.
import { complete } from "./omniroute"
import { JudgeAnswerSchema, validateAnswer, type BlindPacket, type JudgeAnswer, type MarketRate } from "./contracts"
import { grossMinor } from "./money"

const SYSTEM_BASE = `Ты — независимый оценщик выполненной задачи. Ты НЕ видишь имя исполнителя, фактическое время, личную ставку, историю вкладов и деньги участника. Оценивай только по содержанию обезличенного пакета.

Правила:
- Хорошо выполненное исследование с отрицательным результатом и заранее согласованное обучение — допустимая работа.
- Не считай «отсутствие коммита» признаком отсутствия работы.
- НЕ придумывай цену, если в справочнике нет подходящей ставки. Укажи price_status: "no_price_data" и rate_id: null.
- Если ставка есть: price_status: "rate_available" и rate_id = id строки справочника.
- Сложность 1–5 — описательная шкала, не формула.
- typical_duration — типичный диапазон часов компетентного исполнителя В СЕКУНДАХ (не фактическое время).
- Ссылайся только на evidence_ids из пакета.
- Отвечай ТОЛЬКО валидным JSON по схеме. Без пояснений вне JSON.`

function buildUserPrompt(packet: BlindPacket, rates: MarketRate[], persona: string): string {
  const rc = rates
    .map(
      (r) =>
        `- rate_id=${r.rate_id}: ${r.category}, ${r.grade}, ${r.market}, ${r.currency}, ${r.low_minor_per_hour / 100}–${r.high_minor_per_hour / 100} ${r.currency}/ч, источник: ${r.source}`,
    )
    .join("\n")
  const evidence = packet.evidence
    .map((e) => `  - ${e.evidence_id} (${e.kind}): ${e.text}`)
    .join("\n")
  return `${persona}

Справочник рыночных ориентиров (rate_card_id=${packet.rate_card_id}):
${rc}

Обезличенный пакет задачи:
- packet_id: ${packet.packet_id}
- Цель: ${packet.goal}
- Ограничения: ${packet.constraints.join("; ")}
- Инструменты: ${packet.available_tools.join(", ")}
- Результат: ${packet.outcome}
- Статус результата: ${packet.result_status}
- Источники (evidence):
${evidence}
- Ограничения пакета: ${packet.limitations.join("; ")}

Ответ строго в формате JSON (schema_version "2.0", packet_id из пакета):
{
  "schema_version": "2.0",
  "packet_id": "${packet.packet_id}",
  "assessment": "assessable" | "needs_information",
  "category": "dev|research|design|ops|learning|sales|org",
  "grade": "junior|middle|senior|expert|unknown",
  "complexity": 1..5 | null,
  "typical_duration": { "low_seconds": N, "high_seconds": N } | null,
  "price_status": "rate_available" | "no_price_data",
  "rate_id": "id из справочника" | null,
  "evidence_ids": ["e001", ...],
  "limitations": ["..."],
  "missing_information": ["..."],
  "rationale": "короткое обоснование (1-2 предложения)"
}`
}

function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fenced) {
      try {
        return JSON.parse(fenced[1])
      } catch {
        /* fall through */
      }
    }
    const first = text.indexOf("{")
    const last = text.lastIndexOf("}")
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1))
      } catch {
        /* fall through */
      }
    }
  }
  return null
}

export interface JudgeSlotResult {
  answer: JudgeAnswer
  priceLow: number | null // minor units; null when price_status = no_price_data
  priceHigh: number | null
  raw: string
  metadata: Awaited<ReturnType<typeof complete>>
  parseError: string | null
}

/** Derive price (minor units) from duration × rate row. null when no rate. */
function derivePrice(seconds: number, row: MarketRate | undefined, bound: "low" | "high"): number | null {
  if (!row) return null
  const rate = bound === "low" ? row.low_minor_per_hour : row.high_minor_per_hour
  return grossMinor(seconds, rate)
}

/**
 * Run a single judge slot. Returns the validated JudgeAnswer + derived prices.
 * Each slot calls its exact configured model and validates its response.
 * Invalid responses fail the slot; no answer is fabricated.
 */
export async function runJudgeSlot(
  modelKey: string,
  sampleIndex: number,
  packet: BlindPacket,
  rates: MarketRate[],
): Promise<JudgeSlotResult> {
  const completion = await complete(modelKey, [
    { role: "system", content: SYSTEM_BASE },
    { role: "user", content: buildUserPrompt(packet, rates, `Независимый прогон ${sampleIndex}`) },
  ])
  const raw = completion.content
  const parsed = extractJson(raw)

  const parsedResult = JudgeAnswerSchema.safeParse(parsed)
  if (!parsedResult.success) throw new Error("Invalid judge JSON")
  const answer = parsedResult.data
  const errors = validateAnswer(packet, answer)
  if (errors.length) throw new Error(errors.join("; "))
  const parseError = null

  // derive prices from the validated answer
  const row = answer.rate_id ? rates.find((r) => r.rate_id === answer.rate_id) : undefined
  const priceLow =
    answer.price_status === "rate_available" && answer.typical_duration && row
      ? derivePrice(answer.typical_duration.low_seconds, row, "low")
      : null
  const priceHigh =
    answer.price_status === "rate_available" && answer.typical_duration && row
      ? derivePrice(answer.typical_duration.high_seconds, row, "high")
      : null

  return { answer, priceLow, priceHigh, raw, parseError, metadata: completion }
}

export { JUDGE_MODELS } from "./omniroute"
