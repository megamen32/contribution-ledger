"use client"
import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
export default function Login() {
  const [invite, setInvite] = useState(""); const [register, setRegister] = useState(false); const [login, setLogin] = useState(""); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false)
  useEffect(() => { const token = new URLSearchParams(window.location.hash.slice(1)).get("invite"); if (token) { setInvite(token); setRegister(true); window.history.replaceState(null, "", "/login") } }, [])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true)
    try {
      if (register) { if (password !== repeat) throw new Error("Пароли не совпадают"); await api("/api/account/register", { method: "POST", json: { login, displayName: name, password, invite } }); setRegister(false); setInvite("") }
      const result = await signIn("credentials", { login, password, redirect: false, callbackUrl: "/" })
      if (!result?.ok || result.error) throw new Error("Не удалось войти. Проверьте логин и пароль; после повторных попыток подождите 15 минут.")
      window.location.assign("/")
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось войти") } finally { setBusy(false) }
  }
  return <main className="min-h-screen flex items-center justify-center bg-background px-4"><section className="w-full max-w-md rounded-xl border bg-card p-8 space-y-6"><div><h1 className="text-3xl font-semibold">Вклад</h1><p className="mt-2 text-muted-foreground">{register ? "Создайте свой аккаунт команды" : "Вход в личный кабинет"}</p></div><p className="text-sm text-muted-foreground">Это отдельный аккаунт трекера. Админское SSO не используется.</p><form onSubmit={submit} className="space-y-4">{register && <label className="block">Ваше имя<Input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}<label className="block">Логин<Input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="username" autoCapitalize="none" value={login} onChange={event => setLogin(event.target.value)} /></label><label className="block">Пароль<Input type="password" required minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>{register && <><label className="block">Повторите пароль<Input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} /></label><label className="block">Код приглашения<Input required value={invite} maxLength={64} onChange={event => setInvite(event.target.value.trim())} /></label><p className="text-xs text-muted-foreground">Подробная история остаётся личной. Команда видит подтверждённые суммы вклада и опубликованные вами карточки.</p></>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" className="w-full" disabled={busy}>{busy ? "Проверяем…" : register ? "Создать аккаунт" : "Войти"}</Button></form><Button variant="link" onClick={() => { setRegister(!register); setError("") }}>{register ? "Уже есть аккаунт? Войти" : "Есть приглашение? Создать аккаунт"}</Button><p className="text-xs text-muted-foreground">Пароль: не менее 12 символов. Для регистрации нужно одноразовое приглашение команды.</p><a href="/downloads/" className="text-sm underline">Приложения для Mac и Windows</a></section></main>
}
