import { readFileSync } from "node:fs"
import { subscriptionComplete, subscriptionEnabled, SUBSCRIPTION_MODELS } from "./subscription"

export const JUDGE_MODELS = subscriptionEnabled() ? SUBSCRIPTION_MODELS : ["glm-5.3", "gpt-6"]
export const SUMMARY_MODEL = "minimax/MiniMax-M3"

export function routerConfig() {
  const base = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128/v1").replace(/\/$/, "")
  const key = process.env.OMNIROUTE_API_KEY || (process.env.OMNIROUTE_API_KEY_FILE ? readFileSync(process.env.OMNIROUTE_API_KEY_FILE, "utf8").trim() : "")
  if (!key) throw new Error("OmniRoute не настроен: требуется API-ключ сервера. Учёт труда работает без ИИ.")
  return { base, key }
}

export async function complete(model: string, messages: { role: string; content: string }[]) {
  if (subscriptionEnabled()) return subscriptionComplete(model, messages)
  const { base, key } = routerConfig()
  const requestId = crypto.randomUUID()
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Cache-Control": "no-cache, no-store", "X-Request-Id": requestId },
    body: JSON.stringify({ model, messages, stream: false, max_tokens: 3000 }),
    signal: AbortSignal.timeout(120000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`OmniRoute HTTP ${response.status}`)
  const result = await response.json()
  if (result.model !== model) throw new Error(`OmniRoute вернул ${String(result.model)}, запрошена ${model}. Оценка не засчитана.`)
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== "string" || !content.trim()) throw new Error("OmniRoute вернул пустой ответ")
  return { content, requestedModel: model, returnedModel: result.model as string, requestId, usage: result.usage ?? null }
}
