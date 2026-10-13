import { readFileSync } from "node:fs"

export const SUBSCRIPTION_MODELS = ["glm-5.3-flash", "MiniMax-M3.1-Flash-Preview"]
export function subscriptionEnabled() { return process.env.VKLAD_LLM_MODE === "subscription" }
export async function subscriptionComplete(model: string, messages: { role: string; content: string }[]) {
  const glm = model === SUBSCRIPTION_MODELS[0]
  if (!SUBSCRIPTION_MODELS.includes(model)) throw new Error("Модель недоступна в подписочном профиле")
  const provider = glm ? "zai-coding-plan" : "minimax-coding-plan"
  const keyFile = process.env[glm ? "VKLAD_GLM_KEY_FILE" : "VKLAD_MINIMAX_KEY_FILE"]
  if (!keyFile) throw new Error(`Подписка ${provider} не настроена`)
  const key = readFileSync(keyFile, "utf8").trim()
  if (!key) throw new Error(`Подписка ${provider} не настроена`)
  const base = glm ? "https://api.z.ai/api/anthropic" : "https://api.minimax.io/anthropic"
  const requestId = crypto.randomUUID()
  const response = await fetch(`${base}/v1/messages`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "X-Request-Id": requestId },
    body: JSON.stringify({ model, max_tokens: 3000,
      system: messages.filter(m => m.role === "system").map(m => m.content).join("\n"),
      messages: messages.filter(m => m.role !== "system"),
      ...(glm ? {} : { output_config: { effort: "low" } }),
    }),
  })
  if (!response.ok) throw new Error(`Подписка ${provider}: HTTP ${response.status}`)
  const result = await response.json()
  if (result.model !== model) throw new Error(`Запрошена ${model}, вернулась ${String(result.model)}. Оценка не засчитана.`)
  const content = (result.content ?? []).filter((b: any) => b.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n")
  if (!content.trim()) throw new Error(`Подписка ${provider}: пустой ответ`)
  if (result.stop_reason === "max_tokens") throw new Error(`Подписка ${provider}: ответ не завершён`)
  return { content, requestedModel: model, returnedModel: result.model as string, requestId, provider, providerResponseId: result.id ?? null, usage: result.usage ?? null }
}
