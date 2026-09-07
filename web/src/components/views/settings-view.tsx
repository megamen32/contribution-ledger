"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Coins,
  Cpu,
  Database,
  Gauge,
  ListRestart,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Users,
} from "lucide-react"
import type { Member } from "@/components/user-switcher"
import { api } from "@/lib/api-client"
import { AgreedRateForm } from "@/components/agreed-rate-form"
import { formatMoney } from "@/lib/money"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

// ----------------------------------------------------------------- types --
interface AgreedRate {
  id: string
  userId: string
  role: string
  category: string
  currency: string
  ratePerHourMinor: number
  effectiveFrom: string
  note: string
  createdAt: string
  user?: { id: string; displayName: string; color: string } | null
}

interface MarketRateRow {
  id: string
  role: string
  qualification: string
  market: string
  currency: string
  priceType: string
  low: number
  high: number
  source: string
  sourceDate?: string
  checkedAt?: string
}

interface MarketRateCard {
  id: string
  version: number
  kind: string
  content: { rates: MarketRateRow[] }
  agreedAt: string
}

interface RuleVersion {
  id: string
  version: number
  contentJson: string
  content: {
    summary?: string
    rounding?: string
    formulaText?: string
    laborFormula?: string
  }
  acceptedByJson: string
  acceptedBy: string[]
  effectiveFrom: string
  createdAt: string
}

interface JobRow {
  id: string
  kind: string
  businessKey: string
  state: string
  attempts: number
  lastError: string
  createdAt: string
  updatedAt: string
  actor?: { id: string; displayName: string; color: string } | null
}

interface TeamUser {
  id: string
  displayName: string
  email: string
  role: string
  color: string
  timezone: string
  createdAt: string
}

interface ModelProfileModel {
  key: string
  family: string
  tag: string
  digest?: string
  runtime_version?: string
  quantization?: string
}

interface ModelProfile {
  id: string
  profileId: string
  temperature: number
  samplesPerModel: number
  maxOutputTokens: number
  simulationMode: boolean
  active: boolean
  createdAt: string
  models: ModelProfileModel[]
  seeds: number[]
}

interface SettingsResponse {
  market: MarketRateCard[]
  agreed: AgreedRate[]
}

// ----------------------------------------------------------------- meta --
const CATEGORY_LABEL: Record<string, string> = {
  dev: "Разработка",
  research: "Исследование",
  design: "Дизайн",
  ops: "Операции",
  learning: "Обучение",
  sales: "Продажи",
  org: "Организация",
}

const JOB_STATE_META: Record<
  string,
  { label: string; className: string }
> = {
  queued: { label: "в очереди", className: "bg-muted text-muted-foreground border-transparent" },
  running: { label: "выполняется", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent" },
  retry_wait: { label: "ожидание повтора", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-transparent" },
  done: { label: "завершено", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-transparent" },
  failed: { label: "ошибка", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-transparent" },
  cancelled: { label: "отменено", className: "bg-muted text-muted-foreground border-transparent" },
}

const JOB_KIND_LABEL: Record<string, string> = {
  assess: "оценка",
  summarize: "сводка",
  ocr: "OCR",
  finalize: "финализация",
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

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

// ============================================================ SettingsView ==
export function SettingsView({ user: _user }: { user: Member }) {
  const [rateCards, setRateCards] = React.useState<SettingsResponse | null>(null)
  const [rules, setRules] = React.useState<RuleVersion[]>([])
  const [jobs, setJobs] = React.useState<JobRow[]>([])
  const [users, setUsers] = React.useState<TeamUser[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const [rc, r, j, u] = await Promise.all([
        api<SettingsResponse>("/api/rate-cards"),
        api<{ rules: RuleVersion[] }>("/api/rules"),
        api<{ jobs: JobRow[] }>("/api/jobs"),
        api<{ users: TeamUser[] }>("/api/users"),
      ])
      setRateCards(rc)
      setRules(r.rules ?? [])
      setJobs(j.jobs ?? [])
      setUsers(u.users ?? [])
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Не удалось загрузить настройки.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  if (loading && !rateCards) return <SettingsSkeleton />
  if (error && !rateCards) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Не удалось загрузить</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader />

      <AgreedRateForm onSaved={refresh} />
      <AgreedRatesCard rates={rateCards?.agreed ?? []} />

      <MarketRateCardCard market={rateCards?.market ?? []} />

      <RulesCard rules={rules} />

      <ModelProfilesCard />

      <JobsCard jobs={jobs} onChanged={refresh} />

      <TeamCard users={users} />
    </div>
  )
}

// --------------------------------------------------------- Header --
function SettingsHeader() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Settings2 className="h-3.5 w-3.5" />
        Настройки · ставки, правила, очередь
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
        Настройки
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Согласованные ставки, рыночные ориентиры, версии правил и очередь
        фоновых задач.
      </p>
    </motion.div>
  )
}

// --------------------------------------------------- AgreedRatesCard --
function AgreedRatesCard({ rates }: { rates: AgreedRate[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Coins className="h-4 w-4 text-muted-foreground" />
          Согласованные ставки труда
        </CardTitle>
        <CardDescription>
          Личные ставки команды — консервативные, согласованы индивидуально.
          Применяются при расчёте труда.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rates.length === 0 ? (
          <EmptyHint icon={<Coins className="h-7 w-7" />} text="Ставки пока не согласованы" />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Участник</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Категория</TableHead>
                  <TableHead>Действует с</TableHead>
                  <TableHead className="pr-5 text-right">Ставка / час</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{
                            backgroundColor: r.user?.color ?? "#9ca3af",
                          }}
                          aria-hidden
                        >
                          {initialsOf(r.user?.displayName)}
                        </div>
                        <span className="text-sm font-medium">
                          {r.user?.displayName ?? "—"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-sm text-muted-foreground">
                      {r.role}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(r.effectiveFrom), "d MMM yyyy", {
                        locale: ru,
                      })}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(r.ratePerHourMinor, r.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------- MarketRateCardCard --
function MarketRateCardCard({ market }: { market: MarketRateCard[] }) {
  const latest = market[0]
  const rows = latest?.content?.rates ?? []
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              Справочник рыночных ориентиров
            </CardTitle>
            <CardDescription className="mt-1">
              Материал для обезличенных судей, не личная зарплатная ведомость.
              Строки без внешнего основания называются договорными.
            </CardDescription>
          </div>
          {latest && (
            <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
              v{latest.version} · {format(new Date(latest.agreedAt), "d MMM yyyy", { locale: ru })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyHint icon={<Gauge className="h-7 w-7" />} text="Рыночный справочник пока не загружен" />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Роль</TableHead>
                  <TableHead>Квалификация</TableHead>
                  <TableHead>Рынок</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead className="pr-5 text-right">Диапазон / час</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-5 text-sm font-medium">{r.role}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.qualification}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.market}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.priceType}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source}
                      {r.sourceDate && (
                        <span className="ml-1 text-muted-foreground/70">
                          · {format(new Date(r.sourceDate), "d.MM.yyyy")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-sm font-medium tabular-nums text-foreground">
                      {formatMoney(r.low, r.currency)} — {formatMoney(r.high, r.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ------------------------------------------------------- RulesCard --
function RulesCard({ rules }: { rules: RuleVersion[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Версии правил
        </CardTitle>
        <CardDescription>
          Формулы и принципы расчёта вклада. Каждая версия принимается
          участниками.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {rules.length === 0 ? (
          <EmptyHint icon={<BookOpen className="h-7 w-7" />} text="Версии правил пока не созданы" />
        ) : (
          <ul
            className="max-h-96 divide-y divide-border/60 overflow-y-auto scroll-thin"
            role="list"
          >
            {rules.map((r) => {
              const accepted = r.acceptedBy ?? parseJson<string[]>(r.acceptedByJson, [])
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        v{r.version}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        действует с{" "}
                        {format(new Date(r.effectiveFrom), "d MMM yyyy", {
                          locale: ru,
                        })}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      принято: {accepted.length}
                    </Badge>
                  </div>
                  {r.content?.summary && (
                    <p className="mt-2 text-sm text-foreground/90">
                      {r.content.summary}
                    </p>
                  )}
                  {r.content?.formulaText && (
                    <div className="mt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Формула вклада
                      </p>
                      <pre className="mt-1 overflow-x-auto scroll-thin rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs text-foreground/90">
                        {r.content.formulaText}
                      </pre>
                    </div>
                  )}
                  {r.content?.laborFormula && (
                    <div className="mt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Труд
                      </p>
                      <pre className="mt-1 overflow-x-auto scroll-thin rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs text-foreground/90">
                        {r.content.laborFormula}
                      </pre>
                    </div>
                  )}
                  {r.content?.rounding && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Округление: <b className="text-foreground">{r.content.rounding}</b>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------- JobsCard --
function JobsCard({
  jobs,
  onChanged,
}: {
  jobs: JobRow[]
  onChanged: () => void
}) {
  const [retrying, setRetrying] = React.useState<string | null>(null)
  const { toast } = useToast()

  async function retry(id: string) {
    setRetrying(id)
    try {
      await api(`/api/jobs/${id}/retry`, { method: "POST", json: {} })
      toast({ title: "Задача перезапущена", description: "Поставлена в очередь" })
      onChanged()
    } catch (e: any) {
      toast({
        title: "Не удалось перезапустить",
        description: e?.message ?? "Ошибка",
        variant: "destructive",
      })
    } finally {
      setRetrying(null)
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListRestart className="h-4 w-4 text-muted-foreground" />
              Очередь задач
            </CardTitle>
            <CardDescription className="mt-1">
              Фоновые задачи системы — at-least-once с идемпотентной обработкой.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={onChanged}
          >
            <RefreshCw className="h-3 w-3" />
            Обновить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {jobs.length === 0 ? (
          <EmptyHint icon={<ListRestart className="h-7 w-7" />} text="Очередь пуста" />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Тип</TableHead>
                  <TableHead>Бизнес-ключ</TableHead>
                  <TableHead>Состояние</TableHead>
                  <TableHead className="text-right">Попыток</TableHead>
                  <TableHead>Инициатор</TableHead>
                  <TableHead>Создано</TableHead>
                  <TableHead className="pr-5 text-right">Действие</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => {
                  const meta = JOB_STATE_META[j.state] ?? {
                    label: j.state,
                    className: "bg-muted text-muted-foreground border-transparent",
                  }
                  const canRetry = j.state === "failed" || j.state === "cancelled"
                  return (
                    <TableRow key={j.id}>
                      <TableCell className="pl-5">
                        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                          {JOB_KIND_LABEL[j.kind] ?? j.kind}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <span className="block truncate font-mono text-[11px] text-muted-foreground" title={j.businessKey}>
                          {j.businessKey}
                        </span>
                        {j.lastError && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-rose-600 dark:text-rose-400" title={j.lastError}>
                            {j.lastError}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", meta.className)}>
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {j.attempts}
                      </TableCell>
                      <TableCell className="text-xs">
                        {j.actor ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white"
                              style={{ backgroundColor: j.actor.color }}
                              aria-hidden
                            >
                              {initialsOf(j.actor.displayName)}
                            </span>
                            <span className="text-muted-foreground">
                              {j.actor.displayName.split(/\s+/)[0]}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(j.createdAt), "d MMM, HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {canRetry ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => retry(j.id)}
                            disabled={retrying === j.id}
                          >
                            {retrying === j.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Повторить
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------- ModelProfilesCard --
function ModelProfilesCard() {
  const [profiles, setProfiles] = React.useState<ModelProfile[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    api<{ profiles: ModelProfile[] }>("/api/model-profiles")
      .then((res) => {
        if (!cancelled) {
          setProfiles(res.profiles ?? [])
          setError(null)
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Не удалось загрузить профили моделей.")
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          Профили моделей
        </CardTitle>
        <CardDescription>
          Формальный консорциум из 3 семейств × 3 повтора (спецификация §5).
          Температура 0.2, идемпотентность по сидам.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <EmptyHint icon={<ShieldAlert className="h-7 w-7" />} text={error} />
        ) : !profiles || profiles.length === 0 ? (
          <EmptyHint icon={<Cpu className="h-7 w-7" />} text="Профили моделей не настроены" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {profiles.map((p) => (
              <ProfileCard key={p.id} profile={p} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileCard({ profile }: { profile: ModelProfile }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-foreground">
            {profile.profileId}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>temp <b className="tabular-nums">{profile.temperature.toFixed(2)}</b></span>
            <span>· samples <b className="tabular-nums">{profile.samplesPerModel}</b></span>
            <span>· max tokens <b className="tabular-nums">{profile.maxOutputTokens}</b></span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {profile.active && (
            <Badge variant="outline" className="border-transparent bg-emerald-500/15 text-[10px] text-emerald-700 dark:text-emerald-400">
              активен
            </Badge>
          )}
          <Badge
            variant="outline"
            className={cn(
              "border-transparent text-[10px]",
              profile.simulationMode
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-teal-500/15 text-teal-700 dark:text-teal-400",
            )}
          >
            {profile.simulationMode ? "симуляция" : "2 модели OmniRoute"}
          </Badge>
        </div>
      </div>

      {profile.simulationMode && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>⚠ Симуляция:</b> разные промпты одной модели НЕ считаются разными
            моделями (спецификация §5). В боевой конфигурации нужны 3 различных
            локальных семейства (qwen3, gemma3, mistral).
          </span>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Модели
        </p>
        <ul className="space-y-1" role="list">
          {profile.models.map((m) => (
            <li
              key={m.key}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1.5 text-xs"
            >
              <span className="font-mono font-medium text-foreground">{m.key}</span>
              <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>семейство: <b className="text-foreground/80">{m.family}</b></span>
                <span>· tag <b className="font-mono text-foreground/80">{m.tag}</b></span>
                {m.quantization && (
                  <span>· квант <b className="font-mono text-foreground/80">{m.quantization}</b></span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Сиды выборки
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {profile.seeds.map((s, i) => (
            <span
              key={i}
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/60 bg-muted/40 px-1.5 font-mono text-[11px] tabular-nums text-foreground"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------- TeamCard --
function TeamCard({ users }: { users: TeamUser[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" />
          Команда
        </CardTitle>
        <CardDescription>
          {users.length} активных участников системы.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {users.length === 0 ? (
          <EmptyHint icon={<Users className="h-7 w-7" />} text="Участников не найдено" compact />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: u.color }}
                  aria-hidden
                >
                  {initialsOf(u.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{u.displayName}</p>
                    {u.role === "admin" && (
                      <Badge variant="outline" className="bg-primary/10 text-primary border-transparent text-[10px]">
                        админ
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={u.email}>
                    {u.email}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      с {format(new Date(u.createdAt), "d MMM yyyy", { locale: ru })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      {u.timezone}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------- EmptyHint --
function EmptyHint({
  icon,
  text,
  compact,
}: {
  icon: React.ReactNode
  text: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground",
        compact ? "px-6 py-8" : "px-6 py-12",
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="font-medium">{text}</p>
    </div>
  )
}

// --------------------------------------------------------- Skeleton --
function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}
