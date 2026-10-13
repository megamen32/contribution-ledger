"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import {
  AlertCircle,
  AlertTriangle,
  ClipboardList,
  Clock,
  Coins,
  Eye,
  FileText,
  GraduationCap,
  Inbox,
  Info,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Wand2,
  X,
} from "lucide-react"
import type { Member } from "@/components/user-switcher"
import { api } from "@/lib/api-client"
import { formatDuration, formatMoney } from "@/lib/money"
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
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

// ----------------------------------------------------------------- types --
interface TaskOwner {
  id: string
  displayName: string
  color: string
}

interface TaskListItem {
  id: string
  title: string
  description: string
  status: string
  category?: string | null
  complexity?: number | null
  ownerId: string
  createdAt: string
  updatedAt: string
  owner?: TaskOwner
  _count: {
    sessions: number
    assessmentRounds: number
    ledgerEntries: number
  }
}

interface TaskAllocation {
  id: string
  taskId: string
  sessionId?: string | null
  userId: string
  confirmedSeconds: number
  source: string
  session?: { id: string; project: string; startedAt: string } | null
}

interface ReportVersion {
  id: string
  taskId: string
  version: number
  contentJson: string
  status: string
  sourcesManifest: string
  authorApprovedAt?: string | null
  createdAt: string
}

interface AssessmentRoundSummary {
  id: string
  taskId: string
  reportId: string
  number: number
  status: string
  aggregateJson: string
  visualReviewRequired: boolean
  simulationMode?: boolean
  modelProfileId?: string | null
  createdAt: string
  updatedAt: string
  _count: { judgeRuns: number }
}

interface LedgerEntryRow {
  id: string
  kind: string
  currency: string
  amountMinor: number
  note: string
  basis: string
  createdAt: string
  status: string
}

interface SessionRow {
  id: string
  project: string
  status: string
  startedAt: string
  endedAt?: string | null
  confirmedSeconds: number
  note: string
}

interface TaskDetail extends TaskListItem {
  revision: number
  description: string
  allocations: TaskAllocation[]
  reportVersions: ReportVersion[]
  assessmentRounds: AssessmentRoundSummary[]
  ledgerEntries: LedgerEntryRow[]
  sessions: SessionRow[]
}

interface JudgeRunRow {
  id: string
  modelKey: string
  sampleIndex: number
  attempt: number
  status: string
  responseJson: string
  error: string
}

interface AssessmentRoundDetail extends AssessmentRoundSummary {
  judgeRuns: JudgeRunRow[]
}

interface Aggregate {
  collectionStatus?: "complete" | "partial"
  priceStatus?: "known" | "unknown"
  costLow: number | null
  costHigh: number | null
  currency?: string | null
  hoursLow: number | null
  hoursHigh: number | null
  category: string | "mixed" | null
  needsReview: boolean
  reviewReasons: string[]
  perModel: {
    modelKey: string
    hoursLow: number
    hoursHigh: number
    priceLow: number | null
    priceHigh: number | null
    category: string
    count: number
  }[]
  validCount: number
  totalCount: number
  financialEffectMinor?: 0
}

// ----------------------------------------------------------------- meta --
const REVIEW_REASON_LABELS: Record<string, string> = {
  incomplete_price_information: "Неполная ценовая информация",
  mixed_category: "Смешанная категория",
  within_model_disagreement: "Внутримодельное расхождение >2×",
  between_model_disagreement: "Межмодельное расхождение >2×",
  incomparable_rate_basis: "Несравнимые базисы ставок",
  visual_review_required: "Требуется визуальная проверка",
  incomplete_collection: "Не все слоты собраны",
}

const GRADE_LABEL: Record<string, string> = {
  junior: "джун",
  middle: "мидл",
  senior: "сеньор",
  expert: "эксперт",
  unknown: "уровень неизв.",
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: "Открыта", className: "bg-muted text-muted-foreground border-transparent" },
  in_progress: { label: "В работе", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent" },
  needs_report: { label: "Ждёт отчёта", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent" },
  assessing: { label: "На оценке", className: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-transparent" },
  done: { label: "Готово", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent" },
  blocked: { label: "Заблокирована", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-transparent" },
}

const CATEGORY_LABEL: Record<string, string> = {
  dev: "Разработка",
  research: "Исследование",
  design: "Дизайн",
  ops: "Операции",
  learning: "Обучение",
  sales: "Продажи",
  org: "Организация",
}

const ENTRY_KIND_LABEL: Record<string, string> = {
  labor: "Труд",
  cash_contribution: "Взнос",
  unreimbursed_expense: "Расход",
  bonus: "Премия",
  reimbursement: "Возмещение",
  reversal: "Отмена",
}

const STATUS_OPTIONS = Object.keys(STATUS_META)

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, className: "bg-muted text-muted-foreground border-transparent" }
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function initialsOf(name?: string) {
  if (!name) return "?"
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

// ============================================================ TasksView ==
export function TasksView({ user }: { user: Member }) {
  const [tasks, setTasks] = React.useState<TaskListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [scope, setScope] = React.useState<"all" | "mine">("all")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [search, setSearch] = React.useState("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const { toast } = useToast()

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<{ tasks: TaskListItem[] }>("/api/tasks?scope=all")
      setTasks(res.tasks ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Не удалось загрузить задачи.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  // Filtered list
  const filtered = React.useMemo(() => {
    return tasks.filter((t) => {
      if (scope === "mine" && t.ownerId !== user.id) return false
      if (statusFilter !== "all" && t.status !== statusFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (!t.title.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [tasks, scope, statusFilter, search, user.id])

  // Auto-select first when list loads & nothing selected
  React.useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      // do not auto-select (spec says empty state when nothing chosen)
    }
  }, [filtered, selectedId])

  async function handleCreate(payload: {
    title: string
    description?: string
    category?: string
    complexity?: number
    manualSeconds?: number
  }) {
    try {
      await api("/api/tasks", { method: "POST", json: payload })
      toast({ title: "Задача создана", description: payload.title })
      setCreateOpen(false)
      await refresh()
    } catch (e: any) {
      toast({
        title: "Не удалось создать задачу",
        description: e?.message ?? "Ошибка",
        variant: "destructive",
      })
    }
  }

  if (loading && tasks.length === 0) return <TasksSkeleton />
  if (error && tasks.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" />
            Задачи · всего {tasks.length}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            Задачи
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Доска задач с отчётами и ИИ-оценкой 2×3 (две модели × три запуска).
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Новая задача
        </Button>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <TaskListPanel
            tasks={filtered}
            totalCount={tasks.length}
            selectedId={selectedId}
            onSelect={setSelectedId}
            scope={scope}
            onScopeChange={setScope}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            search={search}
            onSearch={setSearch}
          />
        </div>
        <div className="lg:col-span-3">
          {selectedId ? (
            <TaskDetailPanel
              key={selectedId}
              taskId={selectedId}
              currentUser={user}
              onMutated={refresh}
            />
          ) : (
            <EmptyDetail />
          )}
        </div>
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />
    </div>
  )
}

// ------------------------------------------------- TaskListPanel --
function TaskListPanel({
  tasks,
  totalCount,
  selectedId,
  onSelect,
  scope,
  onScopeChange,
  statusFilter,
  onStatusChange,
  search,
  onSearch,
}: {
  tasks: TaskListItem[]
  totalCount: number
  selectedId: string | null
  onSelect: (id: string) => void
  scope: "all" | "mine"
  onScopeChange: (s: "all" | "mine") => void
  statusFilter: string
  onStatusChange: (s: string) => void
  search: string
  onSearch: (s: string) => void
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b border-border/60 pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            Список задач
          </span>
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {tasks.length} / {totalCount}
          </Badge>
        </CardTitle>
        <div className="mt-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Поиск по названию…"
              className="h-8 pl-8 text-sm"
              aria-label="Поиск задач"
            />
            {search && (
              <button
                onClick={() => onSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
                aria-label="Очистить"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-md border border-border/70 bg-muted/40 p-0.5">
              <button
                onClick={() => onScopeChange("all")}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  scope === "all"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Все
              </button>
              <button
                onClick={() => onScopeChange("mine")}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  scope === "mine"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Мои
              </button>
            </div>
            <Select value={statusFilter} onValueChange={onStatusChange}>
              <SelectTrigger size="sm" className="h-7 w-auto text-xs">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        {tasks.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <span>Ничего не найдено</span>
            <span className="text-xs">
              Попробуйте изменить фильтр или создать новую задачу.
            </span>
          </div>
        ) : (
          <ul
            className="max-h-[36rem] divide-y divide-border/60 overflow-y-auto scroll-thin"
            role="list"
          >
            {tasks.map((t) => {
              const meta = statusMeta(t.status)
              const isSel = t.id === selectedId
              return (
                <li key={t.id}>
                  <button
                    onClick={() => onSelect(t.id)}
                    className={cn(
                      "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors",
                      isSel
                        ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
                        : "hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "line-clamp-2 text-sm font-medium leading-snug",
                          isSel ? "text-foreground" : "text-foreground/90",
                        )}
                      >
                        {t.title}
                      </p>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0", meta.className)}
                      >
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                      {t.owner && (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                            style={{ backgroundColor: t.owner.color }}
                            aria-hidden
                          >
                            {initialsOf(t.owner.displayName)}
                          </span>
                          <span className="max-w-[7rem] truncate">
                            {t.owner.displayName.split(/\s+/)[0]}
                          </span>
                        </span>
                      )}
                      {t.category && (
                        <span className="inline-flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {CATEGORY_LABEL[t.category] ?? t.category}
                        </span>
                      )}
                      {typeof t.complexity === "number" && (
                        <ComplexityDots value={t.complexity} />
                      )}
                    </div>
                    <div className="text-[11px] tabular-nums text-muted-foreground/80">
                      {t._count.sessions} сессий · {t._count.assessmentRounds} оценок
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ComplexityDots({ value }: { value: number }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-0.5"
            aria-label={`Сложность ${value} из 5`}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  i < value ? "bg-copper-500 bg-orange-500" : "bg-muted",
                )}
              />
            ))}
          </span>
        </TooltipTrigger>
        <TooltipContent>Сложность: {value} / 5</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ------------------------------------------------- TaskDetailPanel --
function TaskDetailPanel({
  taskId,
  currentUser,
  onMutated,
}: {
  taskId: string
  currentUser: Member
  onMutated: () => void
}) {
  const [task, setTask] = React.useState<TaskDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)
  const [assessing, setAssessing] = React.useState(false)
  const { toast } = useToast()

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<{ task: TaskDetail }>(`/api/tasks/${taskId}`)
      setTask(res.task)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Не удалось загрузить задачу.")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  React.useEffect(() => {
    setLoading(true)
    setTask(null)
    refresh()
  }, [refresh])

  async function changeStatus(next: string) {
    if (!task) return
    if (next === task.status) return
    try {
      const res = await api<{ task: TaskDetail }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        json: { status: next, revision: task.revision },
      })
      setTask(res.task)
      toast({ title: "Статус обновлён", description: STATUS_META[next]?.label })
      onMutated()
    } catch (e: any) {
      if (e?.status === 409) {
        toast({
          title: "Конфликт ревизий",
          description: "Задача была изменена. Обновляю…",
          variant: "destructive",
        })
        await refresh()
      } else {
        toast({
          title: "Не удалось сменить статус",
          description: e?.message ?? "Ошибка",
          variant: "destructive",
        })
      }
    }
  }

  async function editTask(payload: {
    title?: string
    description?: string
    category?: string
    complexity?: number
  }) {
    if (!task) return
    try {
      const body: Record<string, unknown> = { revision: task.revision }
      if (payload.title !== undefined) body.title = payload.title
      if (payload.description !== undefined) body.description = payload.description
      if (payload.category !== undefined)
        body.category = payload.category === "__none__" ? null : payload.category
      if (payload.complexity !== undefined)
        body.complexity = payload.complexity === 0 ? null : payload.complexity
      const res = await api<{ task: TaskDetail }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        json: body,
      })
      setTask(res.task)
      setEditOpen(false)
      toast({ title: "Задача обновлена" })
      onMutated()
    } catch (e: any) {
      if (e?.status === 409) {
        toast({
          title: "Конфликт ревизий",
          description: "Задача была изменена. Обновляю…",
          variant: "destructive",
        })
        await refresh()
      } else {
        toast({
          title: "Не удалось сохранить",
          description: e?.message ?? "Ошибка",
          variant: "destructive",
        })
      }
    }
  }

  async function createReport(content: {
    goal?: string
    result?: string
    actions?: string
  }) {
    if (!task) return
    try {
      const reportContent = {
        goal: content.goal ?? task.title,
        result: content.result ?? task.description ?? "",
        actions: content.actions
          ? content.actions
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        unfinished: "",
        constraints: "",
        sources: [],
        origins: [],
        completeness: "partial",
      }
      await api(`/api/tasks/${taskId}/report`, {
        method: "POST",
        json: { content: reportContent, approve: true },
      })
      toast({ title: "Отчёт создан и утверждён" })
      await refresh()
      onMutated()
    } catch (e: any) {
      toast({
        title: "Не удалось создать отчёт",
        description: e?.message ?? "Ошибка",
        variant: "destructive",
      })
    }
  }

  async function runAssessment() {
    if (!task) return
    setAssessing(true)
    try {
      const res = await api<{
        round: AssessmentRoundSummary
        aggregate: Aggregate
        validCount: number
        totalCount: number
      }>(`/api/tasks/${taskId}/assess`, { method: "POST", json: {} })
      toast({
        title: "Оценка завершена",
        description: `Валидных судей: ${res.validCount} / ${res.totalCount}`,
      })
      await refresh()
      onMutated()
    } catch (e: any) {
      toast({
        title: "Ошибка оценки",
        description: e?.message ?? "Не удалось запустить оценку",
        variant: "destructive",
      })
    } finally {
      setAssessing(false)
    }
  }

  if (loading && !task) {
    return (
      <Card>
        <CardContent className="p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="mt-3 h-4 w-1/2" />
          <div className="mt-5 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }
  if (error && !task) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  if (!task) return null

  const meta = statusMeta(task.status)
  const hasReport = task.reportVersions.length > 0

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={meta.className}>
                {meta.label}
              </Badge>
              {task.category && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <Tag className="h-3 w-3" />
                  {CATEGORY_LABEL[task.category] ?? task.category}
                </Badge>
              )}
              {typeof task.complexity === "number" && (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  C{task.complexity}
                </Badge>
              )}
              <Badge variant="outline" className="text-muted-foreground">
                rev. {task.revision}
              </Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              {task.title}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {task.owner && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                    style={{ backgroundColor: task.owner.color }}
                    aria-hidden
                  >
                    {initialsOf(task.owner.displayName)}
                  </span>
                  {task.owner.displayName}
                </span>
              )}
              <span>
                создано {format(new Date(task.createdAt), "d MMM yyyy", { locale: ru })}
              </span>
              <span>
                обновлено {format(new Date(task.updatedAt), "d MMM yyyy, HH:mm", { locale: ru })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select value={task.status} onValueChange={changeStatus}>
              <SelectTrigger size="sm" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setEditOpen(true)}
            >
              Изменить
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        <Tabs defaultValue="overview" className="flex h-full flex-col">
          <div className="border-b border-border/60 px-4 pt-3">
            <TabsList className="bg-transparent p-0">
              <TabsTrigger value="overview">Обзор</TabsTrigger>
              <TabsTrigger value="reports" className="gap-1.5">
                Отчёты
                {task.reportVersions.length > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                    {task.reportVersions.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="assessments">Оценки</TabsTrigger>
              <TabsTrigger value="ledger">Бухгалтерия</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="m-0 flex-1 overflow-hidden">
            <OverviewTab task={task} />
          </TabsContent>
          <TabsContent value="reports" className="m-0 flex-1 overflow-hidden">
            <ReportsTab
              task={task}
              hasReport={hasReport}
              onCreate={createReport}
            />
          </TabsContent>
          <TabsContent value="assessments" className="m-0 flex-1 overflow-hidden">
            <AssessmentsTab
              task={task}
              hasReport={hasReport}
              assessing={assessing}
              onRun={runAssessment}
              onChanged={refresh}
              currentUser={currentUser}
            />
          </TabsContent>
          <TabsContent value="ledger" className="m-0 flex-1 overflow-hidden">
            <LedgerTab task={task} />
          </TabsContent>
        </Tabs>
      </CardContent>

      <EditTaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        onSave={editTask}
      />
    </Card>
  )
}

// ----------------------------------------------------- Empty detail --
function EmptyDetail() {
  return (
    <Card className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <ClipboardList className="h-7 w-7" />
      </div>
      <div>
        <p className="text-sm font-medium">Выберите задачу слева</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Здесь появятся описание, отчёты, ИИ-оценки 2×3 и бухгалтерия по
          выбранной задаче.
        </p>
      </div>
    </Card>
  )
}

// ----------------------------------------------------- Overview tab --
function OverviewTab({ task }: { task: TaskDetail }) {
  const totalSeconds = task.allocations.reduce(
    (a, b) => a + (b.confirmedSeconds || 0),
    0,
  )
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Описание
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
            {task.description || "—"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MiniStat
            label="Сессий"
            value={task.sessions.length.toString()}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <MiniStat
            label="Учтённое время"
            value={formatDuration(totalSeconds)}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
          <MiniStat
            label="Отчётов"
            value={task.reportVersions.length.toString()}
            icon={<FileText className="h-3.5 w-3.5" />}
          />
          <MiniStat
            label="Оценок"
            value={task.assessmentRounds.length.toString()}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Распределение времени
        </h3>
        {task.allocations.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Распределений времени пока нет.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border/60 rounded-lg border border-border/60" role="list">
            {task.allocations.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {a.session?.project ?? "Ручной учёт"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.source === "manual"
                      ? "ручной ввод"
                      : a.source === "measured"
                        ? "измерено"
                        : a.source}
                    {a.session?.startedAt && (
                      <>
                        {" · "}
                        {format(new Date(a.session.startedAt), "d MMM, HH:mm", {
                          locale: ru,
                        })}
                      </>
                    )}
                  </p>
                </div>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatDuration(a.confirmedSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

// ----------------------------------------------------- Reports tab --
function ReportsTab({
  task,
  hasReport,
  onCreate,
}: {
  task: TaskDetail
  hasReport: boolean
  onCreate: (c: { goal?: string; result?: string; actions?: string }) => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Версии отчётов</h3>
          <p className="text-xs text-muted-foreground">
            Авторские отчёты — основа для обезличенного пакета оценки.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Создать отчёт
        </Button>
      </div>
      {!hasReport ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-center text-sm text-muted-foreground">
          <FileText className="h-7 w-7" />
          <span>Отчётов пока нет</span>
          <span className="text-xs">
            Создайте первый отчёт, чтобы запустить оценку 2×3.
          </span>
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {task.reportVersions.map((r) => {
            const c = parseJson<{
              goal?: string
              result?: string
              actions?: string[]
            }>(r.contentJson, {})
            return (
              <li
                key={r.id}
                className="rounded-lg border border-border/60 bg-card p-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      v{r.version}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        r.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent"
                          : "bg-muted text-muted-foreground border-transparent",
                      )}
                    >
                      {r.status === "approved" ? "утверждён" : "черновик"}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {format(new Date(r.createdAt), "d MMM yyyy, HH:mm", {
                      locale: ru,
                    })}
                  </span>
                </div>
                {c.goal && (
                  <p className="mt-2 text-sm font-medium">{c.goal}</p>
                )}
                {c.result && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                    {c.result}
                  </p>
                )}
                {c.actions && c.actions.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {c.actions.slice(0, 4).map((a, i) => (
                      <li key={i} className="line-clamp-1">
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <CreateReportDialog
        open={open}
        onOpenChange={setOpen}
        taskTitle={task.title}
        taskDescription={task.description}
        onCreate={async (c) => {
          await onCreate(c)
          setOpen(false)
        }}
      />
    </div>
  )
}

// ----------------------------------------------------- Assessments tab --
function AssessmentsTab({
  task,
  hasReport,
  assessing,
  onRun,
  onChanged,
  currentUser: _currentUser,
}: {
  task: TaskDetail
  hasReport: boolean
  assessing: boolean
  onRun: () => void
  onChanged: () => void
  currentUser: Member
}) {
  const latest = task.assessmentRounds[0]
  const [packetOpen, setPacketOpen] = React.useState(false)
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Оценки consortium 2×3</h3>
          <p className="text-xs text-muted-foreground">
            Две модели × три запуска = 6 ответов. Медиана медиан, голосование по
            категории.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setPacketOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            Просмотреть обезличенный пакет
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={onRun}
            disabled={assessing || !hasReport}
          >
            {assessing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {assessing ? "Идёт оценка…" : "Запустить оценку 2×3"}
          </Button>
        </div>
      </div>

      {!hasReport && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Чтобы запустить оценку, нужен утверждённый отчёт. Перейдите на
            вкладку «Отчёты» и создайте его.
          </span>
        </div>
      )}

      {assessing && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-800 dark:text-teal-200">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">
              Идёт оценка задачи…
            </p>
            <p className="text-xs text-teal-700/80 dark:text-teal-300/80">
              Запускаются две модели с тремя повторами каждая. Результат появится после завершения.
            </p>
          </div>
        </div>
      )}

      {task.assessmentRounds.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-center text-sm text-muted-foreground">
          <Sparkles className="h-7 w-7" />
          <span>Оценок пока нет</span>
          <span className="text-xs">
            Создайте отчёт и запустите consortium 2×3.
          </span>
        </div>
      ) : (
        <ul className="space-y-3" role="list">
          {task.assessmentRounds.map((r) => (
            <RoundCard
              key={r.id}
              round={r}
              isLatest={r.id === latest?.id}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      <BlindPacketDialog
        open={packetOpen}
        onOpenChange={setPacketOpen}
        taskId={task.id}
      />
    </div>
  )
}

function RoundCard({
  round,
  isLatest,
  onChanged,
}: {
  round: AssessmentRoundSummary
  isLatest: boolean
  onChanged: () => void
}) {
  const agg: Aggregate = {
    collectionStatus: undefined,
    priceStatus: undefined,
    costLow: null,
    costHigh: null,
    currency: null,
    hoursLow: null,
    hoursHigh: null,
    category: null,
    needsReview: false,
    reviewReasons: [],
    perModel: [],
    validCount: 0,
    totalCount: 9,
    financialEffectMinor: 0,
    ...parseJson<Partial<Aggregate>>(round.aggregateJson, {}),
  }
  const [expanded, setExpanded] = React.useState(false)
  const [detail, setDetail] = React.useState<AssessmentRoundDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = React.useState(false)
  const [recalc, setRecalc] = React.useState(false)
  const { toast } = useToast()

  async function loadDetail() {
    setLoadingDetail(true)
    try {
      const res = await api<{ round: AssessmentRoundDetail }>(
        `/api/assessments/${round.id}`,
      )
      setDetail(res.round)
    } catch (e: any) {
      toast({
        title: "Не удалось загрузить ответы судей",
        description: e?.message ?? "Ошибка",
        variant: "destructive",
      })
    } finally {
      setLoadingDetail(false)
    }
  }

  async function recalculate() {
    setRecalc(true)
    try {
      const res = await api<{ round: AssessmentRoundDetail; aggregate: Aggregate }>(
        `/api/assessments/${round.id}/recalculate`,
        { method: "POST", json: {} },
      )
      setDetail(res.round)
      toast({
        title: "Агрегат пересчитан",
        description: `Валидных: ${res.aggregate.validCount} / ${res.aggregate.totalCount}`,
      })
      onChanged()
    } catch (e: any) {
      toast({
        title: "Не удалось пересчитать",
        description: e?.message ?? "Ошибка",
        variant: "destructive",
      })
    } finally {
      setRecalc(false)
    }
  }

  function toggleExpand() {
    const next = !expanded
    setExpanded(next)
    if (next && !detail) loadDetail()
  }

  const statusMeta = (() => {
    switch (round.status) {
      case "done":
        return { label: "завершён", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent" }
      case "partial":
        return { label: "частично", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent" }
      case "running":
        return { label: "выполняется", className: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-transparent" }
      case "failed":
        return { label: "ошибка", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-transparent" }
      default:
        return { label: round.status, className: "bg-muted text-muted-foreground border-transparent" }
    }
  })()

  return (
    <li className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Оценка #{round.number}</span>
            <Badge variant="outline" className={statusMeta.className}>
              {statusMeta.label}
            </Badge>
            {isLatest && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-transparent">
                последняя
              </Badge>
            )}
            <Badge variant="outline" className="text-muted-foreground">
              {round._count.judgeRuns} судей
            </Badge>
            {(() => {
              const cs = agg.collectionStatus ?? (agg.validCount === agg.totalCount ? "complete" : "partial")
              const complete = cs === "complete"
              return (
                <Badge
                  variant="outline"
                  className={cn(
                    "border-transparent text-[10px]",
                    complete
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {complete ? `6/6 завершён` : `${agg.validCount}/${agg.totalCount} частично`}
                </Badge>
              )
            })()}
            {(() => {
              const ps = agg.priceStatus ?? (agg.costLow != null ? "known" : "unknown")
              const known = ps === "known"
              return (
                <Badge
                  variant="outline"
                  className={cn(
                    "border-transparent text-[10px]",
                    known
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {known ? "Цена известна" : "Цена неизвестна"}
                </Badge>
              )
            })()}
            {round.simulationMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="cursor-help border-transparent bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Симуляция 3 семейств
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Разные промпты одной модели НЕ считаются разными моделями
                  (спецификация §5). В боевой конфигурации нужны 3 различных
                  локальных семейства (qwen3, gemma3, mistral).
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {format(new Date(round.createdAt), "d MMM yyyy, HH:mm", { locale: ru })}
            {round.visualReviewRequired && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                визуальная проверка
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            onClick={recalculate}
            disabled={recalc}
          >
            {recalc ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Пересчитать
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={toggleExpand}
          >
            {expanded ? "Скрыть судей" : "9 ответов судей"}
          </Button>
        </div>
      </div>

      {/* aggregate summary */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AggCell
          label="Стоимость (диапазон)"
          value={(() => {
            const cur = agg.currency ?? "RUB"
            if (agg.costLow != null && agg.costHigh != null)
              return `${formatMoney(agg.costLow, cur)} — ${formatMoney(agg.costHigh, cur)}`
            if (agg.costLow != null) return `от ${formatMoney(agg.costLow, cur)}`
            return "нет данных"
          })()}
          icon={<Coins className="h-3.5 w-3.5" />}
          accent="emerald"
        />
        <AggCell
          label="Часы (диапазон)"
          value={
            agg.hoursLow != null && agg.hoursHigh != null
              ? `${agg.hoursLow} — ${agg.hoursHigh} ч`
              : agg.hoursLow != null
                ? `от ${agg.hoursLow} ч`
                : "нет данных"
          }
          icon={<Clock className="h-3.5 w-3.5" />}
          accent="amber"
        />
        <AggCell
          label="Категория"
          value={
            agg.category
              ? agg.category === "mixed"
                ? "смешанная"
                : CATEGORY_LABEL[agg.category] ?? agg.category
              : "нет большинства"
          }
          icon={<Tag className="h-3.5 w-3.5" />}
          accent="teal"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          Валидных судей: <b className="text-foreground">{agg.validCount}</b> / {agg.totalCount}
        </span>
        {agg.needsReview ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-rose-700 dark:text-rose-400">
            <AlertTriangle className="h-3 w-3" />
            требуется проверка
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">
            <Wand2 className="h-3 w-3" />
            согласовано
          </span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-help items-center gap-1 text-muted-foreground/90">
              <Info className="h-3 w-3" />
              ИИ-оценка не меняет начисления
              <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            Финансовый эффект ИИ-оценки всегда равен нулю.
            Стоимость труда в реестр попадает по согласованной ставке ×
            подтверждённые часы, не из ответов судей.
          </TooltipContent>
        </Tooltip>
      </div>

      {agg.needsReview && agg.reviewReasons.length > 0 && (
        <div className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400">
            Причины проверки
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-rose-700/90 dark:text-rose-300/90">
            {agg.reviewReasons.map((r, i) => (
              <li key={i}>{REVIEW_REASON_LABELS[r] ?? r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* per-model mini table */}
      {agg.perModel.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 text-left font-medium">Модель</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Часы</th>
                <th className="px-2.5 py-1.5 text-right font-medium">Стоимость</th>
                <th className="px-2.5 py-1.5 text-right font-medium">N</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {agg.perModel.map((m) => (
                <tr key={m.modelKey}>
                  <td className="px-2.5 py-1.5 font-mono">{m.modelKey}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {m.hoursLow}–{m.hoursHigh} ч
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {m.priceLow != null && m.priceHigh != null && m.priceLow > 0
                      ? `${formatMoney(m.priceLow)} – ${formatMoney(m.priceHigh)}`
                      : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <div className="mt-3">
          {loadingDetail && !detail ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-md" />
              ))}
            </div>
          ) : detail ? (
            <JudgeGrid runs={detail.judgeRuns} />
          ) : null}
        </div>
      )}
    </li>
  )
}

function AggCell({
  label,
  value,
  icon,
  accent,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  accent: "emerald" | "amber" | "teal"
}) {
  const colorMap = {
    emerald: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
    teal: "text-teal-700 dark:text-teal-400",
  }
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={cn(
          "mt-1 text-sm font-semibold tabular-nums",
          colorMap[accent],
        )}
      >
        {value}
      </p>
    </div>
  )
}

function JudgeGrid({ runs }: { runs: JudgeRunRow[] }) {
  // Ensure 9 cells in stable order
  const order = runs.slice().sort((a, b) => {
    if (a.modelKey === b.modelKey) return a.sampleIndex - b.sampleIndex
    return a.modelKey < b.modelKey ? -1 : 1
  })
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Ответы 9 судей (3 модели × 3 повтора)
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {order.map((r) => (
          <JudgeCard key={r.id} run={r} />
        ))}
      </div>
    </div>
  )
}

function JudgeCard({ run }: { run: JudgeRunRow }) {
  // Accept both new (JudgeAnswer v2.0) and legacy response shapes.
  const resp = parseJson<{
    // v2.0 contract
    schema_version?: string
    assessment?: "assessable" | "needs_information" | string
    category?: string
    grade?: "junior" | "middle" | "senior" | "expert" | "unknown" | string
    complexity?: number | null
    typical_duration?: { low_seconds: number; high_seconds: number } | null
    price_status?: "rate_available" | "no_price_data" | string
    rate_id?: string | null
    missing_information?: string[]
    limitations?: string[]
    rationale?: string
    priceLow?: number | null
    priceHigh?: number | null
    parseError?: string | null
    // legacy
    assessable?: boolean | string
    workType?: string
    qualification?: string
    hoursLow?: number
    hoursHigh?: number
    completeness?: string
  }>(run.responseJson, {})

  const statusMeta = (() => {
    switch (run.status) {
      case "done":
        return { label: "готово", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" }
      case "running":
        return { label: "выполняется", dot: "bg-teal-500 animate-pulse", text: "text-teal-700 dark:text-teal-400" }
      case "failed":
        return { label: "ошибка", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" }
      default:
        return { label: "в очереди", dot: "bg-muted-foreground", text: "text-muted-foreground" }
    }
  })()

  // Normalize: legacy → v2.0 equivalents.
  const assessment: "assessable" | "needs_information" =
    resp.assessment === "needs_information"
      ? "needs_information"
      : resp.assessment
        ? (resp.assessment as "assessable" | "needs_information")
        : resp.assessable === false || resp.assessable === "not_assessable"
          ? "needs_information"
          : "assessable"
  const category = resp.category ?? resp.workType
  const grade = resp.grade ?? resp.qualification ?? "unknown"
  const complexity = resp.complexity ?? null
  // hours: prefer v2 typical_duration, fall back to legacy hoursLow/High
  const hours = (() => {
    if (resp.typical_duration) {
      const lo = resp.typical_duration.low_seconds / 3600
      const hi = resp.typical_duration.high_seconds / 3600
      if (Number.isFinite(lo) && Number.isFinite(hi))
        return `${lo.toFixed(1)}–${hi.toFixed(1)} ч`
    }
    if (typeof resp.hoursLow === "number" && typeof resp.hoursHigh === "number")
      return `${resp.hoursLow}–${resp.hoursHigh} ч`
    return null
  })()
  // price_status: explicit, else derive from priceLow>0 (legacy).
  const priceStatus: "rate_available" | "no_price_data" =
    resp.price_status === "no_price_data"
      ? "no_price_data"
      : resp.price_status === "rate_available"
        ? "rate_available"
        : typeof resp.priceLow === "number" && resp.priceLow > 0
          ? "rate_available"
          : "no_price_data"
  const hasPrice =
    priceStatus === "rate_available" &&
    typeof resp.priceLow === "number" &&
    typeof resp.priceHigh === "number"
  const missing = Array.isArray(resp.missing_information) ? resp.missing_information : []
  const parseError = resp.parseError ?? null

  return (
    <div className="flex flex-col rounded-md border border-border/60 bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] font-medium">
          {run.modelKey}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          #{run.sampleIndex}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
        <span className={statusMeta.text}>{statusMeta.label}</span>
        {grade && grade !== "unknown" && (
          <Badge
            variant="outline"
            className="border-transparent bg-violet-500/15 px-1 py-0 text-[9px] font-normal text-violet-700 dark:text-violet-400"
          >
            <GraduationCap className="mr-0.5 h-2.5 w-2.5" />
            {GRADE_LABEL[grade] ?? grade}
          </Badge>
        )}
        {assessment === "needs_information" && (
          <Badge
            variant="outline"
            className="border-transparent bg-amber-500/15 px-1 py-0 text-[9px] font-normal text-amber-700 dark:text-amber-400"
          >
            Требует данные
          </Badge>
        )}
      </div>
      {run.status === "done" ? (
        <div className="mt-2 space-y-1 text-[11px]">
          {parseError && (
            <p className="line-clamp-2 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-400">
              <AlertCircle className="mr-1 inline h-2.5 w-2.5" />
              {parseError}
            </p>
          )}
          {category && (
            <Row label="тип" value={CATEGORY_LABEL[category] ?? category} />
          )}
          {typeof complexity === "number" && complexity != null && (
            <Row label="сложн." value={`C${complexity}`} />
          )}
          {hours && <Row label="часы" value={hours} />}
          {hasPrice ? (
            <Row
              label="цена"
              value={`${formatMoney(resp.priceLow!)}–${formatMoney(resp.priceHigh!)}`}
            />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">цена</span>
              <Badge
                variant="outline"
                className="border-transparent bg-amber-500/15 px-1 py-0 text-[9px] font-normal text-amber-700 dark:text-amber-400"
              >
                Нет ставки
              </Badge>
            </div>
          )}
          {assessment === "needs_information" && missing.length > 0 && (
            <div className="mt-1 rounded bg-amber-500/5 px-1.5 py-1">
              <p className="text-[9px] font-medium uppercase tracking-wide text-amber-700/80 dark:text-amber-400/80">
                не хватает данных:
              </p>
              <ul className="mt-0.5 list-disc space-y-0 pl-3 text-[10px] text-muted-foreground">
                {missing.slice(0, 3).map((m, i) => (
                  <li key={i} className="line-clamp-1">{m}</li>
                ))}
              </ul>
            </div>
          )}
          {resp.rationale && (
            <p className="mt-1 line-clamp-3 text-[10px] italic text-muted-foreground">
              «{resp.rationale}»
            </p>
          )}
        </div>
      ) : run.status === "failed" ? (
        <p className="mt-2 line-clamp-3 text-[10px] text-rose-700 dark:text-rose-400">
          {run.error || parseError || "неизвестная ошибка"}
        </p>
      ) : (
        <p className="mt-2 text-[10px] text-muted-foreground">
          ожидание ответа…
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  )
}

// ----------------------------------------------------- BlindPacketDialog --
function BlindPacketDialog({
  open,
  onOpenChange,
  taskId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  taskId: string
}) {
  const [state, setState] = React.useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | {
        kind: "ok"
        packet: unknown
        leakedNames: string[]
        reviewPassed: boolean
        note: string
      }
  >({ kind: "idle" })

  React.useEffect(() => {
    if (!open) {
      setState({ kind: "idle" })
      return
    }
    setState({ kind: "loading" })
    api<{ packet: unknown; leakedNames: string[]; reviewPassed: boolean; note: string }>(
      `/api/tasks/${taskId}/packet`,
    )
      .then((res) =>
        setState({
          kind: "ok",
          packet: res.packet,
          leakedNames: res.leakedNames ?? [],
          reviewPassed: !!res.reviewPassed,
          note: res.note ?? "",
        }),
      )
      .catch((e: any) =>
        setState({
          kind: "error",
          message: e?.data?.error ?? e?.message ?? "Не удалось загрузить пакет.",
        }),
      )
  }, [open, taskId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            Обезличенный пакет
          </DialogTitle>
          <DialogDescription>
            То, что видят ИИ-судьи consortium: цель, результат, источники,
            ограничения и рыночные ставки. Без имён, user_id, часов и личных ставок.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto scroll-thin pr-1">
          {state.kind === "loading" && (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          )}
          {state.kind === "error" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Не удалось загрузить</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}
          {state.kind === "ok" && (
            <div className="space-y-3">
              {state.reviewPassed ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>Известных имён не найдено — пакет готов к отправке судьям.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">В пакете найдены известные имена:</p>
                    <p className="mt-0.5 font-mono text-[11px] leading-snug">
                      {state.leakedNames.join(", ")}
                    </p>
                    <p className="mt-1 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                      Отредактируйте отчёт, чтобы убрать упоминания участников.
                    </p>
                  </div>
                </div>
              )}
              {state.note && (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {state.note}
                </p>
              )}
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  JSON пакета (read-only)
                </p>
                <pre className="max-h-96 overflow-auto scroll-thin rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-[11px] leading-snug text-foreground/90">
                  {JSON.stringify(state.packet, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------- Ledger tab --
function LedgerTab({ task }: { task: TaskDetail }) {
  const total = task.ledgerEntries.reduce((a, b) => a + b.amountMinor, 0)
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Бухгалтерия задачи</h3>
          <p className="text-xs text-muted-foreground">
            Записи реестра вкладов, связанные с этой задачей.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Сальдо
          </p>
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              total < 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {formatMoney(total)}
          </p>
        </div>
      </div>
      {task.ledgerEntries.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-center text-sm text-muted-foreground">
          <Coins className="h-6 w-6" />
          <span>Бухгалтерских записей пока нет</span>
        </div>
      ) : (
        <ul
          className="max-h-96 divide-y divide-border/60 overflow-y-auto scroll-thin rounded-lg border border-border/60"
          role="list"
        >
          {task.ledgerEntries.map((e) => {
            const negative = e.amountMinor < 0
            const label = ENTRY_KIND_LABEL[e.kind] ?? e.kind
            return (
              <li
                key={e.id}
                className="flex items-start gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                      {label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", {
                        locale: ru,
                      })}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {e.note}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    negative
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-foreground",
                  )}
                >
                  {formatMoney(e.amountMinor, e.currency)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ----------------------------------------------------- Create task dialog --
function CreateTaskDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreate: (p: {
    title: string
    description?: string
    category?: string
    complexity?: number
    manualSeconds?: number
  }) => Promise<void>
}) {
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [category, setCategory] = React.useState<string>("__none__")
  const [complexity, setComplexity] = React.useState<number>(3)
  const [addManual, setAddManual] = React.useState(false)
  const [manualMin, setManualMin] = React.useState<number>(60)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      // reset on close
      setTitle("")
      setDescription("")
      setCategory("__none__")
      setComplexity(3)
      setAddManual(false)
      setManualMin(60)
    }
  }, [open])

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category === "__none__" ? undefined : category,
        complexity,
        manualSeconds: addManual ? manualMin * 60 : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
          <DialogDescription>
            Опишите задачу. Можно сразу учесть ручной труд по согласованной
            ставке.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nt-title">Название</Label>
            <Input
              id="nt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Реализовать импорт CSV"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-desc">Описание</Label>
            <Textarea
              id="nt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Цель, ограничения, результат…"
              rows={3}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Без категории" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без категории</SelectItem>
                  {Object.keys(CATEGORY_LABEL).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Сложность: {complexity} / 5</Label>
              <Slider
                min={1}
                max={5}
                step={1}
                value={[complexity]}
                onValueChange={(v) => setComplexity(v[0] ?? 3)}
              />
            </div>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addManual}
                onChange={(e) => setAddManual(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-emerald-600"
              />
              <span>Учесть ручной труд сейчас</span>
            </label>
            {addManual && (
              <div className="mt-3 space-y-1.5">
                <Label>Минут: {manualMin}</Label>
                <Slider
                  min={5}
                  max={480}
                  step={5}
                  value={[manualMin]}
                  onValueChange={(v) => setManualMin(v[0] ?? 60)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Расчёт: часы × ваша согласованная ставка по категории.
                </p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving || !title.trim()} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------- Edit task dialog --
function EditTaskDialog({
  open,
  onOpenChange,
  task,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  task: TaskDetail
  onSave: (p: {
    title: string
    description: string
    category: string
    complexity: number
  }) => Promise<void>
}) {
  const [title, setTitle] = React.useState(task.title)
  const [description, setDescription] = React.useState(task.description)
  const [category, setCategory] = React.useState<string>(task.category ?? "__none__")
  const [complexity, setComplexity] = React.useState<number>(task.complexity ?? 3)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setTitle(task.title)
      setDescription(task.description)
      setCategory(task.category ?? "__none__")
      setComplexity(task.complexity ?? 3)
    }
  }, [open, task])

  async function submit() {
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        description,
        category,
        complexity,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Редактировать задачу</DialogTitle>
          <DialogDescription>
            Изменения сохраняются с проверкой ревизии.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="et-title">Название</Label>
            <Input
              id="et-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="et-desc">Описание</Label>
            <Textarea
              id="et-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Без категории</SelectItem>
                  {Object.keys(CATEGORY_LABEL).map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Сложность: {complexity} / 5</Label>
              <Slider
                min={0}
                max={5}
                step={1}
                value={[complexity]}
                onValueChange={(v) => setComplexity(v[0] ?? 0)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving || !title.trim()} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------- Create report dialog --
function CreateReportDialog({
  open,
  onOpenChange,
  taskTitle,
  taskDescription,
  onCreate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  taskTitle: string
  taskDescription: string
  onCreate: (c: { goal?: string; result?: string; actions?: string }) => Promise<void>
}) {
  const [goal, setGoal] = React.useState("")
  const [result, setResult] = React.useState("")
  const [actions, setActions] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setGoal(taskTitle)
      setResult(taskDescription)
      setActions("")
    }
  }, [open, taskTitle, taskDescription])

  async function submit() {
    setSaving(true)
    try {
      await onCreate({
        goal: goal.trim() || undefined,
        result: result.trim() || undefined,
        actions: actions.trim() || undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Создать отчёт</DialogTitle>
          <DialogDescription>
            Авторский отчёт — основа для обезличенного пакета оценки.
            Утверждается сразу.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-goal">Цель</Label>
            <Input
              id="r-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-actions">Действия (по строкам)</Label>
            <Textarea
              id="r-actions"
              value={actions}
              onChange={(e) => setActions(e.target.value)}
              placeholder={"Что было сделано\nКаждая строка — отдельный пункт"}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-result">Результат</Label>
            <Textarea
              id="r-result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={saving} className="gap-1.5">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Создать и утвердить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --------------------------------------------------------- Skeleton --
function TasksSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-96 rounded-xl lg:col-span-2" />
        <Skeleton className="h-96 rounded-xl lg:col-span-3" />
      </div>
    </div>
  )
}
