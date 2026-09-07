"use client"
import { useState } from "react"
import { api } from "@/lib/api-client"

export function AgreedRateForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [amount,setAmount] = useState("")
  const [message,setMessage] = useState("")
  const [busy,setBusy] = useState(false)
  return <form className="rounded-xl border p-4 flex flex-wrap items-end gap-3" onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api("/api/rate-cards", { method:"POST", json:{ category:"all", ratePerHourMinor:Math.round(Number(amount)*100) } })
      await onSaved()
      setMessage("Ставка сохранена для выбранного участника. Прошлые начисления не изменены.")
    } catch(error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить ставку") }
    finally { setBusy(false) }
  }}>
    <label className="grid gap-1" htmlFor="agreed-rate-rub">Моя согласованная ставка, ₽/час
      <input className="border rounded p-2 bg-background" id="agreed-rate-rub" type="number" min="0.01" step="0.01" max="1000000" required value={amount} onChange={event=>setAmount(event.target.value)} />
    </label>
    <button className="border rounded px-4 py-2" disabled={busy}>Сохранить ставку</button>
    <p className="w-full text-sm" role="status">{message || "Для новой работы выбранного участника. Ставку сначала согласуйте с командой."}</p>
  </form>
}
