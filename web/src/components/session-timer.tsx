"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Check,
  CircleDot,
  Clock,
  Coins,
  Loader2,
  Pause,
  Play,
  Square,
  TimerReset,
} from "lucide-react"
import { formatHMS, formatDuration } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api-client"
import { formatMoney } from "@/lib/money"

// ---- Shared lightweight types (subset of the API shapes) ----
export interface TimerTask {
  id: string
  title: string
  status: string
  category?: string | null
}

export interface TimerSession {
  id: string
  project: string
  taskId: string | null
  status: string // recording | paused | stopped | pending_upload | uploaded
  startedAt: string
  endedAt: string | null
  intervalsJson: string
  confirmedSeconds: number
  note: string
  // Effort-credit mode: true = time × rate (default); false = explicit result cost
  effortCredit?: boolean
  resultMinor?: number | null
  task?: { id: string; title: string } | null
}

interface Interval {
  start: string
  end: string | null
  kind: "work" | "pause"
}

function parseIntervals(json: string): Interval[] {
  try {
    const arr = JSON.parse(json || "[]")
    return Array.isArray(arr) ? (arr as Interval[]) : []
  } catch {
    return []
  }
}

/** Sum of work-interval seconds; an open work interval counts up to `now`. */
function sumWorkSeconds(intervals: Interval[], now: number): number {
  let s = 0
  for (const iv of intervals) {
    if (iv.kind !== "work") continue
    const start = new Date(iv.start).getTime()
    if (Number.isNaN(start)) continue
    const endTs = iv.end ? new Date(iv.end).getTime() : now
    s += Math.max(0, Math.floor((endTs - start) / 1000))
  }
  return s
}

export interface SessionTimerProps {
  activeSession: TimerSession | null
  tasks: TimerTask[]
  onRefresh: () => void
}

/**
 * Live Start/Pause/Stop session timer — the hero of the personal dashboard.
 *
 * States:
 *  - idle                 → start form (project + optional task + note)
 *  - recording | paused   → live HH:MM:SS display + Pause/Resume + Stop
 *  - stopped (local)      → frozen duration + "Завершить и отправить"
 */
export function SessionTimer({ activeSession, tasks, onRefresh }: SessionTimerProps) {
  const { toast } = useToast()
  const [now, setNow] = React.useState<number>(() => Date.now())
  // localSession mirrors activeSession, but survives a stop (so we can show
  // the finalize step even though the API's activeSession filter drops it).
  const [localSession, setLocalSession] = React.useState<TimerSession | null>(activeSession)
  const [busy, setBusy] = React.useState(false)

  // start-form fields
  const [project, setProject] = React.useState("")
  const [taskId, setTaskId] = React.useState<string>("none")
  const [note, setNote] = React.useState("")
  const [resultMode, setResultMode] = React.useState(false) // true → effortCredit=false (explicit result cost)
  const [resultRub, setResultRub] = React.useState<string>("")
  const [startError, setStartError] = React.useState<string | null>(null)

  // Keep localSession in sync when a fresh active session comes from the API.
  React.useEffect(() => {
    if (activeSession) setLocalSession(activeSession)
  }, [activeSession])

  // Tick every second while recording.
  const isRecording = localSession?.status === "recording"
  React.useEffect(() => {
    if (!isRecording) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [isRecording])

  const intervals = localSession ? parseIntervals(localSession.intervalsJson) : []
  const elapsed = localSession ? sumWorkSeconds(intervals, now) : 0

  async function startSession(e: React.FormEvent) {
    e.preventDefault()
    const p = project.trim()
    if (!p) {
      setStartError("Укажите проект или описание работы.")
      return
    }
    // Switch ON  → effortCredit=false (explicit result cost), rubles → minor (×100)
    // Switch OFF → effortCredit=true  (time × rate, default)
    const effortCredit = !resultMode
    const rub = Number(resultRub)
    const resultMinor =
      !effortCredit && Number.isFinite(rub) && rub > 0 ? Math.round(rub * 100) : null
    if (!effortCredit && resultMinor == null) {
      setStartError("Укажите согласованную стоимость результата в рублях.")
      return
    }
    setBusy(true)
    setStartError(null)
    try {
      const { session } = await api<{ session: TimerSession }>("/api/sessions", {
        method: "POST",
        json: {
          project: p,
          taskId: taskId === "none" ? undefined : taskId,
          note: note.trim() || undefined,
          effortCredit,
          resultMinor: effortCredit ? null : resultMinor,
        },
      })
      setLocalSession(session)
      setNow(Date.now())
      setProject("")
      setTaskId("none")
      setNote("")
      setResultMode(false)
      setResultRub("")
      toast({
        title: "Запись начата",
        description: `«${session.project}» — идёт учёт времени.`,
      })
      onRefresh()
    } catch (err: any) {
      if (err?.status === 409) {
        const msg = err?.data?.error ?? "У вас уже есть активная сессия."
        setStartError(typeof msg === "string" ? msg : "У вас уже есть активная сессия.")
        // Sync to the existing active session.
        onRefresh()
      } else {
        setStartError(err?.message ?? "Не удалось начать сессию.")
      }
    } finally {
      setBusy(false)
    }
  }

  async function patch(action: "pause" | "resume" | "stop" | "finalize") {
    if (!localSession) return
    setBusy(true)
    try {
      const { session } = await api<{ session: TimerSession }>(
        `/api/sessions/${localSession.id}`,
        { method: "PATCH", json: { action } },
      )
      if (action === "finalize") {
        toast({
          title: "Сессия отправлена",
          description: "Труд учтён в реестре вкладов.",
        })
        setLocalSession(null)
      } else if (action === "stop") {
        setLocalSession(session)
        toast({
          title: "Сессия остановлена",
          description: "Завершите учёт, чтобы труд попал в реестр.",
        })
      } else if (action === "pause") {
        setLocalSession(session)
        toast({ title: "Пауза" })
      } else {
        setLocalSession(session)
        setNow(Date.now())
        toast({ title: "Запись продолжена" })
      }
      onRefresh()
    } catch (err: any) {
      const msg =
        err?.data?.error ?? err?.message ?? "Действие не выполнено"
      toast({
        title: "Не получилось",
        description: typeof msg === "string" ? msg : "Действие не выполнено",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- IDLE ----
  if (!localSession) {
    return (
      <IdleHero
        project={project}
        setProject={setProject}
        taskId={taskId}
        setTaskId={setTaskId}
        note={note}
        setNote={setNote}
        resultMode={resultMode}
        setResultMode={setResultMode}
        resultRub={resultRub}
        setResultRub={setResultRub}
        tasks={tasks}
        busy={busy}
        error={startError}
        onSubmit={startSession}
      />
    )
  }

  // -------------------------------------------------- ACTIVE / STOPPED ----
  const recording = localSession.status === "recording"
  const paused = localSession.status === "paused"
  const stopped = localSession.status === "stopped"
  const live = recording || paused
  const displaySeconds = stopped ? localSession.confirmedSeconds : elapsed
  const resultPriced = localSession.effortCredit === false && localSession.resultMinor != null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors",
        recording &&
          "border-emerald-500/40 shadow-emerald-500/10 ring-1 ring-emerald-500/20",
        paused && "border-amber-500/40 ring-1 ring-amber-500/15",
        stopped && "border-amber-500/30",
      )}
    >
      {/* ambient glow while recording */}
      {recording && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl"
        />
      )}
      <div className="relative flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        {/* left: timer + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusBadge recording={recording} paused={paused} stopped={stopped} />
            <span className="truncate text-sm font-medium text-foreground">
              {localSession.project}
            </span>
          </div>

          <div className="mt-4 flex items-end gap-3">
            <div
              className={cn(
                "font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl",
                recording
                  ? "text-emerald-600 dark:text-emerald-400"
                  : paused
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground",
              )}
            >
              {formatHMS(displaySeconds)}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {localSession.task && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                Задача: <span className="text-foreground/80">{localSession.task.title}</span>
              </span>
            )}
            {stopped && resultPriced ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-500/10 px-1.5 py-0.5 text-teal-700 dark:text-teal-300">
                <Coins className="h-3.5 w-3.5" />
                Стоимость результата: <span className="font-semibold tabular-nums">{formatMoney(localSession.resultMinor ?? 0)}</span>
              </span>
            ) : stopped ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Учтено: <span className="text-foreground/80">{formatDuration(localSession.confirmedSeconds)}</span>
              </span>
            ) : null}
            {resultPriced && !stopped && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-500/10 px-1.5 py-0.5 text-teal-700 dark:text-teal-300">
                <Coins className="h-3.5 w-3.5" />
                Зачёт по результату: <span className="font-semibold tabular-nums">{formatMoney(localSession.resultMinor ?? 0)}</span>
              </span>
            )}
            {localSession.note && (
              <span className="italic text-muted-foreground/80">«{localSession.note}»</span>
            )}
          </div>
        </div>

        {/* right: controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
          <AnimatePresence mode="wait" initial={false}>
            {live && (
              <motion.div
                key="live-controls"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch"
              >
                {recording ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => patch("pause")}
                    disabled={busy}
                    className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
                  >
                    <Pause className="h-4 w-4" /> Пауза
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => patch("resume")}
                    disabled={busy}
                    className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                  >
                    <Play className="h-4 w-4" /> Продолжить
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => patch("stop")}
                  disabled={busy}
                >
                  <Square className="h-4 w-4" /> Остановить
                </Button>
              </motion.div>
            )}

            {stopped && (
              <motion.div
                key="stopped-controls"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.15 }}
                className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch"
              >
                <Button
                  type="button"
                  onClick={() => patch("finalize")}
                  disabled={busy}
                  className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Завершить и отправить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setLocalSession(null)}
                >
                  Позже
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

// -------------------------------------------------------------- subviews --

function StatusBadge({
  recording,
  paused,
  stopped,
}: {
  recording: boolean
  paused: boolean
  stopped: boolean
}) {
  if (recording) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Идёт запись
      </span>
    )
  }
  if (paused) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        <CircleDot className="h-3 w-3" />
        Пауза
      </span>
    )
  }
  if (stopped) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        <TimerReset className="h-3 w-3" />
        Остановлена
      </span>
    )
  }
  return null
}

function IdleHero({
  project,
  setProject,
  taskId,
  setTaskId,
  note,
  setNote,
  resultMode,
  setResultMode,
  resultRub,
  setResultRub,
  tasks,
  busy,
  error,
  onSubmit,
}: {
  project: string
  setProject: (v: string) => void
  taskId: string
  setTaskId: (v: string) => void
  note: string
  setNote: (v: string) => void
  resultMode: boolean
  setResultMode: (v: boolean) => void
  resultRub: string
  setResultRub: (v: string) => void
  tasks: TimerTask[]
  busy: boolean
  error: string | null
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <form onSubmit={onSubmit} className="grid gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <Play className="h-4 w-4" />
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                Начать новую сессию
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Запишите, над чем работаете сейчас — секунды пойдут в учёт сразу.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="project" className="text-xs text-muted-foreground">
                Проект / работа
              </Label>
              <Input
                id="project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Напр. доработка лендинга"
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task" className="text-xs text-muted-foreground">
                Задача (необязательно)
              </Label>
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger id="task" className="w-full">
                  <SelectValue placeholder="Без задачи" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Без задачи</SelectItem>
                  {tasks.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      У вас пока нет задач
                    </div>
                  ) : (
                    tasks.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="note" className="text-xs text-muted-foreground">
              Заметка (необязательно)
            </Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Что планируется сделать за сессию"
              maxLength={240}
            />
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="resultMode" className="text-xs font-medium text-foreground">
                  Зачёт по результату
                </Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {resultMode
                    ? "Оплата за результат — фиксированная сумма вместо время×ставка."
                    : "По умолчанию: учёт по времени × согласованная ставка. Включите, если согласована стоимость результата."}
                </p>
              </div>
              <Switch
                id="resultMode"
                checked={resultMode}
                onCheckedChange={setResultMode}
                aria-label="Зачёт по результату"
              />
            </div>
            {resultMode && (
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="resultRub" className="text-xs text-muted-foreground">
                  Согласованная стоимость результата, ₽
                </Label>
                <Input
                  id="resultRub"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="decimal"
                  value={resultRub}
                  onChange={(e) => setResultRub(e.target.value)}
                  placeholder="Например: 15000"
                  className="tabular-nums"
                />
                <p className="text-[11px] text-muted-foreground">
                  В реестр вкладов запишется именно эта сумма (в копейках).
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={busy || !project.trim()}
              className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90"
              size="lg"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Начать сессию
            </Button>
            <span className="text-xs text-muted-foreground">
              ⏎ Enter — запустить запись
            </span>
          </div>
        </form>

        <div className="hidden lg:flex lg:flex-col lg:items-center lg:gap-2 lg:pl-6 lg:text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Clock className="h-9 w-9" />
          </div>
          <p className="max-w-[10rem] text-xs text-muted-foreground">
            Учёт идёт по интервалам — паузы не считаются.
          </p>
        </div>
      </div>
    </motion.div>
  )
}
