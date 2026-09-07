"use client"
import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function Login() {
  const [invite, setInvite] = useState("")
  const [register, setRegister] = useState(false)
  const [login, setLogin] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [repeat, setRepeat] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("invite")
    if (token) {
      setInvite(token)
      setRegister(true)
      window.history.replaceState(null, "", "/login")
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    try {
      if (register) {
        if (password !== repeat) throw new Error("Пароли не совпадают")
        await api("/api/account/register", { method: "POST", json: { login, displayName: name, password, invite } })
      }
      const result = await signIn("credentials", { login, password, redirect: false, callbackUrl: "/" })
      if (!result?.ok || result.error) throw new Error("Неверный логин или пароль")
      window.location.assign("/")
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось войти")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-14 sm:flex sm:items-center sm:justify-center sm:py-8">
      <section className="mx-auto w-full max-w-sm">
        <h1 className="text-4xl font-semibold tracking-tight">Вклад</h1>

        <form onSubmit={submit} className="mt-10 space-y-5">
          {register && (
            <label className="block space-y-2 text-sm font-medium">
              Имя
              <Input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
            </label>
          )}

          <label className="block space-y-2 text-sm font-medium">
            Логин
            <Input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="username" autoCapitalize="none" value={login} onChange={event => setLogin(event.target.value)} />
          </label>

          <label className="block space-y-2 text-sm font-medium">
            Пароль
            <Input type="password" required minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} />
          </label>

          {register && (
            <>
              <label className="block space-y-2 text-sm font-medium">
                Ещё раз
                <Input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} />
              </label>
              {!invite && (
                <label className="block space-y-2 text-sm font-medium">
                  Приглашение
                  <Input required maxLength={64} value={invite} onChange={event => setInvite(event.target.value.trim())} />
                </label>
              )}
            </>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy ? "…" : register ? "Создать аккаунт" : "Войти"}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-4 text-sm">
          <button type="button" className="text-primary hover:underline" onClick={() => { setRegister(!register); setError("") }}>
            {register ? "У меня уже есть аккаунт" : "Создать аккаунт"}
          </button>
          <a href="/downloads/" className="text-muted-foreground hover:text-foreground hover:underline">Скачать</a>
        </div>
      </section>
    </main>
  )
}
