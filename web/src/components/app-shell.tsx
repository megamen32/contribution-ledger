"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  Briefcase,
  LayoutDashboard,
  ListChecks,
  Moon,
  Settings2,
  Sun,
  Scale,
  Github,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api-client"
import { UserSwitcher, type Member } from "@/components/user-switcher"
import { PersonalView } from "@/components/views/personal-view"
import { TasksView } from "@/components/views/tasks-view"
import { TeamView } from "@/components/views/team-view"
import { SettingsView } from "@/components/views/settings-view"

export type ViewKey = "personal" | "tasks" | "team" | "settings"

const NAV: { key: ViewKey; label: string; icon: React.ElementType; hint: string }[] = [
  { key: "personal", label: "Моя работа", icon: Briefcase, hint: "История выбранного участника" },
  { key: "tasks", label: "Задачи", icon: ListChecks, hint: "Задачи и оценки ИИ" },
  { key: "team", label: "Вклады команды", icon: LayoutDashboard, hint: "Общий дашборд владельцев" },
  { key: "settings", label: "Настройки", icon: Settings2, hint: "Ставки, правила, очередь" },
]

export function AppShell() {
  const [members, setMembers] = React.useState<Member[]>([])
  const [current, setCurrent] = React.useState<Member | null>(null)
  const [view, setView] = React.useState<ViewKey>("personal")
  const [bootLoading, setBootLoading] = React.useState(true)
  const [projectName, setProjectName] = React.useState("")
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // boot: load current user + members
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<{ user: Member | null; members: Member[]; project: { name: string } | null }>("/api/me")
        if (cancelled) return
        setMembers(data.members)
        setCurrent(data.user)
        setProjectName(data.project?.name || "Мой проект")
      } catch (e) {
        console.error(e)
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="ml-2 hidden items-center gap-0.5 md:flex">
            {NAV.map((item) => (
              <NavButton
                key={item.key}
                active={view === item.key}
                onClick={() => setView(item.key)}
                icon={item.icon}
                label={item.label}
              />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Сменить тему"
            >
              {mounted && resolvedTheme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
            </Button>
            <UserSwitcher members={members} current={current} onChange={setCurrent} />
          </div>
        </div>
        {/* mobile nav */}
        <nav className="flex items-center gap-0.5 overflow-x-auto px-3 pb-2 md:hidden scroll-thin">
          {NAV.map((item) => (
            <NavButton
              key={item.key}
              active={view === item.key}
              onClick={() => setView(item.key)}
              icon={item.icon}
              label={item.label}
              compact
            />
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {current && <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">{projectName}</h1>{current.role === "admin" && <a href="/account" className="text-sm text-primary hover:underline">Пригласить участника →</a>}</div>}
        {bootLoading ? (
          <BootSkeleton />
        ) : !current ? (
          <NoUserNotice members={members} onPick={setCurrent} />
        ) : (
          <React.Suspense fallback={<BootSkeleton />}>
            {view === "personal" && <PersonalView user={current} />}
            {view === "tasks" && <TasksView user={current} />}
            {view === "team" && <TeamView user={current} />}
            {view === "settings" && <SettingsView user={current} />}
          </React.Suspense>
        )}
      </main>

      <Footer />
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Scale className="h-5 w-5" />
      </div>
      <div className="leading-none">
        <p className="text-[15px] font-semibold tracking-tight">Вклад</p>
        <p className="hidden text-[11px] text-muted-foreground sm:block">учёт вкладов команды</p>
      </div>
    </div>
  )
}

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  compact,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  label: string
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        compact && "shrink-0",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-muted/30">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-3 px-4 py-5 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          <span>
            Внутренняя система · {new Date().getFullYear()} · модели добросовестны, защищаемся от ошибок программы, а не от коллег
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <a href="https://github.com/megamen32/contribution-ledger" className="inline-flex items-center gap-1 hover:underline">
            <Github className="h-3.5 w-3.5" /> Исходный код на GitHub
          </a>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">Доля в учтённом вкладе, не в компании</span>
        </div>
      </div>
    </footer>
  )
}

function BootSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border bg-muted/40" />
      ))}
      <div className="h-72 animate-pulse rounded-xl border bg-muted/40 sm:col-span-2 lg:col-span-4" />
    </div>
  )
}

function NoUserNotice({ members, onPick }: { members: Member[]; onPick: (m: Member) => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Scale className="h-8 w-8" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Выберите участника</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Это внутренняя система для команды из пяти человек. Войдите под своим именем, чтобы видеть личную историю и
          общий дашборд вкладов.
        </p>
      </div>
      <div className="grid w-full gap-2">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={async () => {
              try {
                await api("/api/me", { method: "POST", json: { userId: m.id } })
                onPick(m)
              } catch (e) {
                console.error(e)
              }
            }}
            className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50"
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: m.color }}
            >
              {m.displayName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{m.displayName}</p>
              <p className="text-xs text-muted-foreground">{m.role === "admin" ? "Администратор" : "Участник"}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
