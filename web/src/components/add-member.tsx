"use client"
import { useState } from "react"
import { api } from "@/lib/api-client"
import type { Member } from "./user-switcher"

export function AddMember({ onAdded }: { onAdded: (member: Member) => void }) {
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return <form className="p-3 space-y-2" onSubmit={async (event) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const result = await api<{ user: Member }>("/api/users", { method: "POST", json: { displayName: name.trim() } })
      onAdded(result.user)
      setName("")
      setError("")
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось добавить участника") }
    finally { setBusy(false) }
  }}>
    <label htmlFor="new-member-name" className="text-sm">Новый участник</label>
    <input id="new-member-name" className="w-full border rounded p-2" maxLength={100} required value={name} onChange={event => setName(event.target.value)} />
    <button className="border rounded px-3 py-1" disabled={busy} type="submit">Добавить</button>
    {error && <p role="alert">{error}</p>}
  </form>
}
