"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import {
  Briefcase,
  Clock,
  Scale,
  Wallet,
  Inbox,
  History,
  Receipt,
  Tag,
  AlertTriangle,
  RotateCcw,
  CornerDownRight,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import type { Member } from "@/components/user-switcher"
import { api } from "@/lib/api-client"
import { formatMoney, formatDuration } from "@/lib/money"
import { StatCard } from "@/components/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  SessionTimer,
  type TimerSession,
  type TimerTask,
} from "@/components/session-timer"
import { useToast } from "@/hooks/use-toast"

// ----------------------------------------------------------------- types --
interface TaskWithCounts {
  id: string
  title: string
  description: string
  status: string
  category?: string | null
  complexity?: number | null
  ownerId: string
  _count: { sessions: number; assessmentRounds: number }
}

interface LedgerEntry {
  id: string
  kind: string
  currency: string
  amountMinor: number
  taskId: string | null
  note: string
  basis: string
  createdAt: string
  targetEntryId?: string | null
  task?: { id: string; title: string } | null
}

interface RateCard {
  id: string
  role: string
  category: string
  currency: string
  ratePerHourMinor: number
}

interface SessionRow {
  id: string
  userId: string
  project: string
  taskId: string | null
  status: string
  startedAt: string
  endedAt: string | null
  intervalsJson: string
  confirmedSeconds: number
  note: string
  task?: { id: string; title: string; status: string } | null
}

interface Summary {
  cash: number
  expense: number
  labor: number
  bonus: number
  reversal: number
  reimbursement: number
  contribution: number
  totalSeconds: number
  totalHoursLabel: string
  teamTotal: number
  share: number
  sessionCount: number
  taskCount: number
}

interface MeResponse {
  user: Member
  activeSession: SessionRow | null
  sessions: SessionRow[]
  tasks: TaskWithCounts[]
  entries: LedgerEntry[]
  rateCards: RateCard[]
  summary: Summary
}

// ============================================================ PersonalView ==
export function PersonalView({ user }: { user: Member }) {
  const [data, setData] = React.useState<MeResponse | null>(null)
  const [tasks, setTasks] = React.useState<TimerTask[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<MeResponse>("/api/team/me")
      setData(res)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Не удалось загрузить данные.")
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshTasks = React.useCallback(async () => {
    try {
      const res = await api<{ tasks: TimerTask[] }>("/api/tasks?scope=mine")
      setTasks(res.tasks ?? [])
    } catch {
      // selector is optional; silently degrade
      setTasks([])
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh()
    refreshTasks()
  }, [user.id, refresh, refreshTasks])

  if (loading && !data) return <PersonalSkeleton />
  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!data) return null

  const firstName = user.displayName.split(/\s+/)[0] || user.displayName
  const initials = user.displayName
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex flex-col gap-6">
      <GreetingHeader
        firstName={firstName}
        initials={initials}
        color={user.color}
        role={user.role}
        share={data.summary.share}
      />

      <SessionTimer
        activeSession={data.activeSession}
        tasks={tasks}
        onRefresh={refresh}
      />

      <ContributionSummary summary={data.summary} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SessionsList sessions={data.sessions} activeSession={data.activeSession} />
        </div>
        <div className="lg:col-span-1">
          <MyTasksList tasks={data.tasks} />
        </div>
      </div>

      <ActivityTimeline entries={data.entries} onMutated={refresh} />

      <MyRates rateCards={data.rateCards} />
    </div>
  )
}

// -------------------------------------------------------------- Greeting --
function GreetingHeader({
  firstName,
  initials,
  color,
  role,
  share,
}: {
  firstName: string
  initials: string
  color: string
  role: string
  share: number
}) {
  const sharePct = share > 0 ? share : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3.5">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Привет, {firstName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Вот ваша личная история работы и вкладов.
            {role === "admin" && (
              <span className="ml-1.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                админ
              </span>
            )}
          </p>
        </div>
      </div>

      <ShareBadge share={sharePct} />
    </motion.div>
  )
}

function ShareBadge({ share }: { share: number }) {
  const safe = Math.max(0, Math.min(100, share))
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-4 py-2.5 shadow-sm">
      <div className="relative h-12 w-12 shrink-0">
        <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-muted/60"
          />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="text-emerald-600 dark:text-emerald-400"
            strokeDasharray={`${(safe / 100) * (2 * Math.PI * 15.5)} ${2 * Math.PI * 15.5}`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
          {safe.toFixed(0)}%
        </span>
      </div>
      <div className="leading-tight">
        <p className="text-xs font-medium text-foreground">Доля в учтённом вкладе</p>
        <p className="text-[11px] text-muted-foreground">доля в учтённом вкладе, не в компании</p>
      </div>
    </div>
  )
}

// ------------------------------------------------------- ContributionRow --
function ContributionSummary({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Признанный вклад"
        value={formatMoney(summary.contribution)}
        hint={`доля ${summary.share.toFixed(1)}%`}
        accent="emerald"
        icon={<Scale className="h-5 w-5" />}
      />
      <StatCard
        label="Неоплаченный труд"
        value={formatMoney(summary.labor)}
        hint={summary.totalHoursLabel}
        accent="amber"
        icon={<Clock className="h-5 w-5" />}
      />
      <StatCard
        label="Денежные вложения"
        value={formatMoney(summary.cash + summary.expense)}
        hint="взносы + расходы"
        accent="teal"
        icon={<Wallet className="h-5 w-5" />}
      />
      <StatCard
        label="Сессий записано"
        value={summary.sessionCount}
        hint={`задач: ${summary.taskCount}`}
        accent="copper"
        icon={<Briefcase className="h-5 w-5" />}
      />
    </div>
  )
}

// --------------------------------------------------------------- Sessions --
const STATUS_DOT: Record<string, string> = {
  uploaded: "bg-emerald-500",
  stopped: "bg-amber-500",
  pending_upload: "bg-orange-500",
  recording: "bg-emerald-500",
  paused: "bg-amber-500",
}

function SessionsList({
  sessions,
  activeSession,
}: {
  sessions: SessionRow[]
  activeSession: SessionRow | null
}) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Мои сессии
        </CardTitle>
        <CardDescription>Последние записи времени — {sessions.length} шт.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-7 w-7" />}
            title="Сессий пока нет"
            hint="Начните первую выше — она появится здесь."
          />
        ) : (
          <ul
            className="max-h-[28rem] divide-y divide-border/60 overflow-y-auto scroll-thin"
            role="list"
          >
            {sessions.map((s) => {
              const isActive = activeSession?.id === s.id
              const isLive = s.status === "recording" || s.status === "paused"
              const dot = STATUS_DOT[s.status] ?? "bg-muted-foreground"
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/40",
                    isActive && "bg-emerald-500/5",
                  )}
                >
                  <span className="mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                    {isLive ? (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                    ) : (
                      <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="truncate text-sm font-medium text-foreground">
                        {s.project}
                      </p>
                      <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {formatDuration(s.confirmedSeconds)}
                      </p>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                      <span>
                        {format(new Date(s.startedAt), "d MMM, HH:mm", { locale: ru })}
                      </span>
                      {s.task && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate text-foreground/70">
                            {s.task.title}
                          </span>
                        </>
                      )}
                      {isActive && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                          активна
                        </span>
                      )}
                    </div>
                    {s.note && (
                      <p className="mt-1 line-clamp-1 text-xs italic text-muted-foreground/80">
                        «{s.note}»
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------------------ Tasks --
const TASK_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  open: { label: "открыта", className: "bg-muted text-muted-foreground border-transparent" },
  in_progress: { label: "в работе", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent" },
  needs_report: { label: "нужен отчёт", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent" },
  assessing: { label: "оценка", className: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-transparent" },
  done: { label: "готово", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent" },
  blocked: { label: "блок", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-transparent" },
}

const CATEGORY_LABEL: Record<string, string> = {
  dev: "разработка",
  research: "исследование",
  design: "дизайн",
  ops: "операции",
  learning: "обучение",
  sales: "продажи",
  org: "организация",
}

function MyTasksList({ tasks }: { tasks: TaskWithCounts[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          Мои задачи
        </CardTitle>
        <CardDescription>Задачи, где вы владелец — {tasks.length} шт.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {tasks.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title="Задач пока нет"
            hint="Создайте задачу во вкладке «Задачи»."
          />
        ) : (
          <ul
            className="max-h-[28rem] divide-y divide-border/60 overflow-y-auto scroll-thin"
            role="list"
          >
            {tasks.map((t) => {
              const meta = TASK_STATUS_META[t.status] ?? TASK_STATUS_META.open
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-1.5 px-5 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                      {t.title}
                    </p>
                    <Badge variant="outline" className={cn("shrink-0", meta.className)}>
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                    {t.category && (
                      <span className="inline-flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        {CATEGORY_LABEL[t.category] ?? t.category}
                      </span>
                    )}
                    {typeof t.complexity === "number" && (
                      <span className="tabular-nums">сложность {t.complexity}/5</span>
                    )}
                  </div>
                  <div className="text-[11px] tabular-nums text-muted-foreground/80">
                    {t._count.sessions} сессий · {t._count.assessmentRounds} оценок
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------- ActivityTimeline --
const ENTRY_KIND_META: Record<
  string,
  { label: string; dot: string; text: string }
> = {
  labor: { label: "Труд", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  cash_contribution: { label: "Денежный взнос", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-400" },
  unreimbursed_expense: { label: "Расход", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400" },
  bonus: { label: "Бонус", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  reimbursement: { label: "Возмещение", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-400" },
  reversal: { label: "Сторно", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
  settlement: { label: "Погашение", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-400" },
}

const POSITIVE_KINDS = new Set(["labor", "cash_contribution", "unreimbursed_expense", "bonus"])

function ActivityTimeline({
  entries,
  onMutated,
}: {
  entries: LedgerEntry[]
  onMutated: () => Promise<void> | void
}) {
  const items = entries.slice(0, 15)
  // outstanding per positive entry = amountMinor − sum(|settlement.amountMinor|) for settlements targeting it
  const outstandingById = new Map<string, number>()
  for (const e of entries) {
    if (POSITIVE_KINDS.has(e.kind)) outstandingById.set(e.id, e.amountMinor)
  }
  for (const e of entries) {
    if (e.kind === "settlement" && e.targetEntryId) {
      const prev = outstandingById.get(e.targetEntryId) ?? 0
      outstandingById.set(e.targetEntryId, prev - Math.abs(e.amountMinor))
    }
  }
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Моя активность
        </CardTitle>
        <CardDescription>
          Записи в реестре вкладов — последние {Math.min(entries.length, 15)} из {entries.length}. Наведите на положительную запись, чтобы отменить или погасить.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <EmptyState
            icon={<History className="h-7 w-7" />}
            title="Активности пока нет"
            hint="Завершите сессию или внесите взнос — здесь появится запись."
          />
        ) : (
          <ol className="max-h-96 overflow-y-auto scroll-thin px-5 py-4" role="list">
            {items.map((e, idx) => (
              <ActivityRow
                key={e.id}
                entry={e}
                outstanding={outstandingById.get(e.id) ?? null}
                isLast={idx === items.length - 1}
                onMutated={onMutated}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityRow({
  entry,
  outstanding,
  isLast,
  onMutated,
}: {
  entry: LedgerEntry
  outstanding: number | null
  isLast: boolean
  onMutated: () => Promise<void> | void
}) {
  const { toast } = useToast()
  const meta = ENTRY_KIND_META[entry.kind] ?? {
    label: entry.kind,
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  }
  const negative = entry.amountMinor < 0
  const positive = POSITIVE_KINDS.has(entry.kind)
  const hasTarget = !!entry.targetEntryId

  // settle dialog
  const [settleOpen, setSettleOpen] = React.useState(false)
  const [settleRub, setSettleRub] = React.useState("")
  const [settleReason, setSettleReason] = React.useState("")
  const [settling, setSettling] = React.useState(false)

  // reverse dialog
  const [reverseOpen, setReverseOpen] = React.useState(false)
  const [reverseNote, setReverseNote] = React.useState("")
  const [reversing, setReversing] = React.useState(false)

  const outstandingMinor = outstanding != null ? Math.max(0, outstanding) : null
  const maxSettleRub = outstandingMinor != null ? outstandingMinor / 100 : 0

  async function doSettle() {
    const rub = Number(settleRub)
    if (!Number.isFinite(rub) || rub <= 0) {
      toast({ title: "Введите сумму", variant: "destructive" })
      return
    }
    const amt = Math.round(rub * 100)
    if (outstandingMinor != null && amt > outstandingMinor) {
      toast({
        title: "Сумма превышает остаток",
        description: `Непогашено: ${formatMoney(outstandingMinor, entry.currency)}`,
        variant: "destructive",
      })
      return
    }
    setSettling(true)
    try {
      await api(`/api/ledger/entries/${entry.id}/settle`, {
        method: "POST",
        json: { amountMinor: amt, reason: settleReason.trim() || undefined },
      })
      toast({
        title: "Платёж проведён",
        description: `Погашено ${formatMoney(amt, entry.currency)}`,
      })
      setSettleOpen(false)
      setSettleRub("")
      setSettleReason("")
      await onMutated()
    } catch (e: any) {
      toast({
        title: "Не удалось погасить",
        description: e?.data?.error ?? e?.message ?? "Ошибка",
        variant: "destructive",
      })
    } finally {
      setSettling(false)
    }
  }

  async function doReverse() {
    setReversing(true)
    try {
      await api(`/api/ledger/entries/${entry.id}/reverse`, {
        method: "POST",
        json: { note: reverseNote.trim() || "Корректировка" },
      })
      toast({
        title: "Создана сторнирующая запись",
        description: "Исходная запись отменена.",
      })
      setReverseOpen(false)
      setReverseNote("")
      await onMutated()
    } catch (e: any) {
      toast({
        title: "Не удалось отменить",
        description: e?.data?.error ?? e?.message ?? "Ошибка",
        variant: "destructive",
      })
    } finally {
      setReversing(false)
    }
  }

  return (
    <li className="group relative flex gap-3.5 pb-4 last:pb-0">
      {/* vertical line */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[5px] top-3 h-full w-px bg-border"
        />
      )}
      <span
        className={cn(
          "relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card",
          meta.dot,
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium", meta.text)}>
              {meta.label}
            </span>
            {(entry.kind === "reversal" || entry.kind === "settlement") && (
              <RotateCcw className="h-3 w-3 text-rose-500" />
            )}
            {hasTarget && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 rounded text-[10px] text-muted-foreground">
                    <CornerDownRight className="h-3 w-3" />
                    <span className="font-mono tabular-nums">
                      {entry.targetEntryId!.slice(-8)}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Погашает запись {entry.targetEntryId!.slice(-8)}
                </TooltipContent>
              </Tooltip>
            )}
            {positive && outstandingMinor != null && outstandingMinor > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    непогашено: <span className="font-medium tabular-nums">{formatMoney(outstandingMinor, entry.currency)}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Часть суммы ещё не закрыта платежами
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              negative
                ? "text-rose-600 dark:text-rose-400"
                : "text-foreground",
            )}
          >
            {formatMoney(entry.amountMinor, entry.currency)}
          </span>
        </div>
        {entry.note && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {entry.note}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground/80">
          <span>{format(new Date(entry.createdAt), "d MMM yyyy, HH:mm", { locale: ru })}</span>
          {entry.task && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{entry.task.title}</span>
            </>
          )}
        </div>
        {positive && outstandingMinor != null && outstandingMinor > 0 && (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
              onClick={() => setReverseOpen(true)}
            >
              <RotateCcw className="h-3 w-3" />
              Отменить
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[11px] text-teal-700 hover:bg-teal-500/10 hover:text-teal-800 dark:text-teal-400"
              onClick={() => setSettleOpen(true)}
            >
              <CheckCircle2 className="h-3 w-3" />
              Погасить
            </Button>
          </div>
        )}
      </div>

      {/* Settle dialog */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Погасить запись</DialogTitle>
            <DialogDescription>
              Частичная оплата. Будет создана запись <b>settlement</b>, уменьшающая непогашенный остаток.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground">
              Непогашено: <b className="text-foreground tabular-nums">{formatMoney(outstandingMinor ?? 0, entry.currency)}</b>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-rub">Сумма погашения, ₽</Label>
              <Input
                id="settle-rub"
                type="number"
                min={0.01}
                max={maxSettleRub}
                step={0.01}
                inputMode="decimal"
                value={settleRub}
                onChange={(e) => setSettleRub(e.target.value)}
                placeholder={`до ${maxSettleRub.toFixed(2)}`}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-reason">Основание (необязательно)</Label>
              <Input
                id="settle-reason"
                value={settleReason}
                onChange={(e) => setSettleReason(e.target.value)}
                placeholder="Например: перевод от 12.05"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettleOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={doSettle}
              disabled={settling}
              className="gap-1.5 bg-teal-600 text-white hover:bg-teal-600/90"
            >
              {settling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Провести платёж
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse alert dialog */}
      <AlertDialog open={reverseOpen} onOpenChange={setReverseOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Эта операция создаст корректирующую сторнирующую запись. Отменить
              нельзя. Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reverse-note">Заметка (необязательно)</Label>
            <Input
              id="reverse-note"
              value={reverseNote}
              onChange={(e) => setReverseNote(e.target.value)}
              placeholder="Причина корректировки"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={doReverse}
              disabled={reversing}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-600/90"
            >
              {reversing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Отменить запись
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

// ------------------------------------------------------------------- Rates --
function MyRates({ rateCards }: { rateCards: RateCard[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="h-4 w-4 text-muted-foreground" />
          Мои согласованные ставки
        </CardTitle>
        <CardDescription>
          Применяются при расчёте труда по умолчанию.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rateCards.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title="Ставки ещё не согласованы"
            hint="Согласуйте ставки во вкладке «Настройки»."
            compact
          />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Роль</th>
                  <th className="py-2 pr-4 font-medium">Категория</th>
                  <th className="py-2 pl-4 text-right font-medium">Ставка / час</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rateCards.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="py-2.5 pr-4 capitalize">{r.role}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </td>
                    <td className="py-2.5 pl-4 text-right font-medium tabular-nums text-foreground">
                      {formatMoney(r.ratePerHourMinor, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// -------------------------------------------------------------- EmptyState --
function EmptyState({
  icon,
  title,
  hint,
  compact,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        compact ? "px-6 py-8" : "px-6 py-12",
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// -------------------------------------------------------------- Skeleton --
function PersonalSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        <Skeleton className="h-96 rounded-xl lg:col-span-1" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}
