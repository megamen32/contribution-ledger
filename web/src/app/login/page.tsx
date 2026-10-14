"use client"
import { useEffect, useState } from "react"
import { signIn, signOut } from "next-auth/react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseRegistrationLink, restoreRegistrationLink, REGISTRATION_LINK_KEY } from "@/lib/registration-link"

export default function Login() {
  const [invite, setInvite] = useState("")
  const [ownerSetup, setOwnerSetup] = useState(false)
  const [hasInvitationLink, setHasInvitationLink] = useState(false)
  const [register, setRegister] = useState(false)
  const [login, setLogin] = useState("")
  const [name, setName] = useState("")
  const [projectName, setProjectName] = useState("Мой проект")
  const [password, setPassword] = useState("")
  const [repeat, setRepeat] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState<{ displayName: string } | null>(null)

  useEffect(() => {
    setRegister(new URLSearchParams(window.location.search).get("register") === "1")
    function readInvitation() {
      let link = parseRegistrationLink(window.location.hash)
      try {
        if (link) sessionStorage.setItem(REGISTRATION_LINK_KEY, JSON.stringify(link))
        else link = restoreRegistrationLink(sessionStorage.getItem(REGISTRATION_LINK_KEY))
      } catch { /* The current link still works when browser storage is unavailable. */ }
      if (!link) return
      setInvite(link.token)
      setOwnerSetup(link.kind === "setup")
      setHasInvitationLink(true)
      setRegister(true)
      setError("")
      window.history.replaceState(null, "", "/login")
      if (link.kind === "invite") api<{ user: { displayName: string } | null }>("/api/me").then(data => setSignedIn(data.user)).catch(() => setSignedIn(null))
    }
    readInvitation()
    window.addEventListener("hashchange", readInvitation)
    return () => window.removeEventListener("hashchange", readInvitation)
  }, [])

  function clearInvitation() {
    setOwnerSetup(false); setHasInvitationLink(false); setInvite("")
    try { sessionStorage.removeItem(REGISTRATION_LINK_KEY) } catch {}
  }
  async function acceptCurrentInvitation() {
    setError(""); setBusy(true)
    try { await api("/api/account/invite/accept", { method: "POST", json: { invite } }); clearInvitation(); window.location.assign("/") }
    catch (error) { setError(error instanceof Error ? error.message : "Не удалось принять приглашение"); setBusy(false) }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError("")
    setBusy(true)
    try {
      const existingInvitation = !register && !ownerSetup ? invite : ""
      let registeredProject: string | undefined
      if (register) {
        if (password !== repeat) throw new Error("Пароли не совпадают")
        const result = await api<{ project?: { id: string } }>(ownerSetup ? "/api/account/setup" : "/api/account/register", { method: "POST", json: { login, displayName: name, password, invite, projectName } })
        registeredProject = result.project?.id
        // Registration has consumed the invitation even if the following sign-in fails.
        setRegister(false)
        clearInvitation()
      }
      const result = await signIn("credentials", { login, password, redirect: false, callbackUrl: "/" })
      if (!result?.ok || result.error) throw new Error("Неверный логин или пароль")
      if (existingInvitation) {
        const data = await api<{ user: { displayName: string } }>("/api/me")
        setSignedIn(data.user)
        await api("/api/account/invite/accept", { method: "POST", json: { invite: existingInvitation } })
        clearInvitation()
      } else if (registeredProject) await api("/api/projects/switch", { method: "POST", json: { projectId: registeredProject } })
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
        <p className="mt-4 text-sm text-muted-foreground"><a href="/demo" className="text-primary hover:underline">Попробовать демо без регистрации →</a></p>

        {signedIn && invite && !ownerSetup ? <section className="mt-10 space-y-5"><h2 className="text-xl font-semibold">Приглашение в проект</h2><p className="text-sm text-muted-foreground">Вы вошли как {signedIn.displayName}. Новый проект добавится к вашим проектам, и вы сможете переключаться между ними.</p><Button disabled={busy} className="w-full" onClick={acceptCurrentInvitation}>{busy ? "…" : "Принять приглашение"}</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex flex-wrap gap-4 text-sm"><a className="text-primary hover:underline" href="/">К моим проектам</a><button className="text-primary hover:underline" onClick={() => signOut({ callbackUrl: "/login" })}>Войти в другой аккаунт</button></div></section> : <><form onSubmit={submit} className="mt-10 space-y-5">
          {register && <p className="text-sm text-muted-foreground">{hasInvitationLink ? "Вы присоединитесь к проекту по приглашению." : "Создайте свой проект и пригласите в него команду."}</p>}
          {register && (
            <label className="block space-y-2 text-sm font-medium">
              Имя
              <Input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
            </label>
          )}
          {register && !hasInvitationLink && <label className="block space-y-2 text-sm font-medium">Название проекта<Input required maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} /></label>}

          <label className="block space-y-2 text-sm font-medium">
            Логин
            <Input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}" autoComplete="username" autoCapitalize="none" value={login} onChange={event => setLogin(event.target.value)} />
          </label>

          <label className="block space-y-2 text-sm font-medium">
            Пароль
            <Input type="password" required maxLength={128} autoComplete={register ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} />
          </label>

          {register && (
            <>
              <label className="block space-y-2 text-sm font-medium">
                Ещё раз
                <Input type="password" required maxLength={128} autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} />
              </label>
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
          <a href="/downloads/Vklad-macOS-arm64-v0.3.1.dmg" className="text-muted-foreground hover:text-foreground hover:underline">Скачать для macOS</a>
        </div>
        {register && hasInvitationLink && <button className="mt-4 text-sm text-primary hover:underline" type="button" onClick={() => { clearInvitation(); setError("") }}>Создать свой проект вместо вступления</button>}</>}
        <footer className="mt-8 text-sm text-muted-foreground"><a href="https://github.com/megamen32/contribution-ledger" className="hover:underline">Исходный код на GitHub</a></footer>
      </section>
    </main>
  )
}
