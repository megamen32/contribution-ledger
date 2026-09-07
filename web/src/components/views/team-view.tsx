"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { ru } from "date-fns/locale"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Activity,
  AlertTriangle,
  Clock,
  History,
  LayoutDashboard,
  Scale,
  Shield,
  Undo2,
  Users,
  Wallet,
} from "lucide-react"
import type { Member } from "@/components/user-switcher"
import { api } from "@/lib/api-client"
import { formatDuration, formatMoney } from "@/lib/money"
import { StatCard } from "@/components/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"

// ----------------------------------------------------------------- types --
interface TeamMember {
  id: string
  displayName: string
  color: string
  role: string
  email: string
  cash: number
  expense: number
  labor: number
  bonus: number
  reversal: number
  reimbursement: number
  settlement: number
  outstandingLabor: number
  contribution: number
  entryCount: number
  hoursSeconds: number
}

interface TeamTotals {
  contribution: number
  cash: number
  expense: number
  labor: number
  reversal: number
  settlement: number
  unpaidLabor: number
  outstandingLabor: number
}

interface TeamInvariants {
  aiNeverTouchesLedger: boolean
  financialEffectMinor: number
  currency: string
  note: string
}

interface RecentEntry {
  id: string
  kind: string
  currency: string
  amountMinor: number
  note: string
  createdAt: string
  user?: { id: string; displayName: string; color: string } | null
  task?: { id: string; title: string } | null
}

interface TeamResponse {
  members: TeamMember[]
  totals: TeamTotals
  invariants: TeamInvariants
  tasks: {
    total: number
    byStatus: Record<string, number>
    byCategory: Record<string, number>
    byOwner: Record<string, number>
  }
  recent: RecentEntry[]
  hoursByDay: Record<string, number>
}

// ----------------------------------------------------------------- meta --
const CHART_COLORS = ["#0d9488", "#d97706", "#14b8a6", "#ea580c", "#e11d48", "#9333ea"]

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "Открытые", color: "#9ca3af" },
  in_progress: { label: "В работе", color: "#d97706" },
  needs_report: { label: "Ждёт отчёта", color: "#ea580c" },
  assessing: { label: "На оценке", color: "#14b8a6" },
  done: { label: "Готово", color: "#0d9488" },
  blocked: { label: "Заблокированы", color: "#e11d48" },
}

const ENTRY_KIND_META: Record<
  string,
  { label: string; dot: string; text: string }
> = {
  labor: { label: "Труд", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  cash_contribution: { label: "Взнос", dot: "bg-teal-500", text: "text-teal-700 dark:text-teal-400" },
  unreimbursed_expense: { label: "Расход", dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400" },
  bonus: { label: "Премия", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  reimbursement: { label: "Возмещение", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-400" },
  reversal: { label: "Отмена", dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-400" },
}

// ============================================================ TeamView ==
export function TeamView({ user: _user }: { user: Member }) {
  const [data, setData] = React.useState<TeamResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const res = await api<TeamResponse>("/api/team")
      setData(res)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Не удалось загрузить данные команды.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  if (loading && !data) return <TeamSkeleton />
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

  const sortedMembers = [...data.members].sort(
    (a, b) => b.contribution - a.contribution,
  )
  const totalContrib = data.totals.contribution

  return (
    <div className="flex flex-col gap-6">
      <TeamHeader memberCount={data.members.length} />

      <InvariantBanner invariants={data.invariants} />

      {/* totals row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Признанный вклад команды"
          value={formatMoney(data.totals.contribution)}
          hint={`${data.members.length} участников`}
          accent="emerald"
          icon={<Scale className="h-5 w-5" />}
        />
        <StatCard
          label="Денежные вложения"
          value={formatMoney(data.totals.cash + data.totals.expense)}
          hint="взносы + расходы"
          accent="teal"
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          label="Непогашенный труд"
          value={formatMoney(data.totals.outstandingLabor)}
          hint={`оплачено: ${formatMoney(Math.abs(data.totals.settlement))}`}
          accent="amber"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Корректировки"
          value={formatMoney(data.totals.reversal)}
          hint="возвраты и отмены"
          accent="rose"
          icon={<Undo2 className="h-5 w-5" />}
        />
      </div>

      {/* donut + tasks by status */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SharesDonut members={sortedMembers} total={totalContrib} />
        </div>
        <div className="lg:col-span-2">
          <TasksByStatus byStatus={data.tasks.byStatus} total={data.tasks.total} />
        </div>
      </div>

      {/* hours by day */}
      <HoursByDayCard hoursByDay={data.hoursByDay} />

      {/* members table */}
      <MembersTable members={sortedMembers} total={totalContrib} />

      {/* recent activity */}
      <RecentFeed entries={data.recent} />
    </div>
  )
}

// -------------------------------------------------------------- Header --
function TeamHeader({ memberCount }: { memberCount: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <LayoutDashboard className="h-3.5 w-3.5" />
          Общий дашборд · {memberCount} участников
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Вклады команды
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Общий учёт признанных вкладов. Прозрачно для всех участников.
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
        <Scale className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>Доля в учтённом вкладе, не в компании</span>
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------- InvariantBanner --
function InvariantBanner({ invariants }: { invariants: TeamInvariants }) {
  if (!invariants?.note) return null
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-sm text-emerald-800 dark:text-emerald-200">
      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="min-w-0">
        <p className="text-[13px] leading-snug">
          {invariants.note}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
          <span>ИИ не касается реестра: <b className="tabular-nums">{invariants.aiNeverTouchesLedger ? "да" : "нет"}</b></span>
          <span>финансовый эффект ИИ: <b className="tabular-nums">{invariants.financialEffectMinor}</b> minor</span>
          <span>валюта: <b>{invariants.currency}</b></span>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------ SharesDonut --
function SharesDonut({
  members,
  total,
}: {
  members: TeamMember[]
  total: number
}) {
  const showDonut = total > 0
  const chartData = members
    .filter((m) => m.contribution > 0)
    .map((m, idx) => ({
      name: m.displayName,
      value: m.contribution,
      color: m.color || CHART_COLORS[idx % CHART_COLORS.length],
      id: m.id,
    }))

  return (
    <Card className="h-full">
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" />
          Доли вкладов
        </CardTitle>
        <CardDescription>
          Доля каждого участника в признанном вкладе команды
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {!showDonut ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-4xl font-semibold text-muted-foreground tabular-nums">
              —
            </div>
            <p className="text-sm font-medium">Сумма вклада равна нулю</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              При нулевой сумме показываем прочерк. При корректировках с
              отрицательным итогом не рисуем бессмысленную круговую диаграмму.
            </p>
          </div>
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-2">
            <div className="relative h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="92%"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.id} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--popover)",
                      color: "var(--popover-foreground)",
                      fontSize: 12,
                      padding: "8px 10px",
                    }}
                    formatter={(value: number, _name, item: any) => {
                      const pct = total > 0 ? (value / total) * 100 : 0
                      return [
                        `${formatMoney(value)} · ${pct.toFixed(1)}%`,
                        item?.payload?.name ?? "",
                      ]
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Всего
                </span>
                <span className="mt-0.5 text-base font-semibold tabular-nums">
                  {formatMoney(total)}
                </span>
              </div>
            </div>
            <ul className="space-y-1.5" role="list">
              {members.map((m, idx) => {
                const pct =
                  total > 0 ? Math.max(0, (m.contribution / total) * 100) : 0
                const color = m.color || CHART_COLORS[idx % CHART_COLORS.length]
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="truncate text-foreground">
                        {m.displayName}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
                      <span className="text-xs text-muted-foreground">
                        {pct.toFixed(1)}%
                      </span>
                      <span className="font-medium">
                        {formatMoney(m.contribution)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// -------------------------------------------------- TasksByStatus --
function TasksByStatus({
  byStatus,
  total,
}: {
  byStatus: Record<string, number>
  total: number
}) {
  const items = Object.keys(STATUS_META)
    .map((k) => ({
      key: k,
      label: STATUS_META[k].label,
      color: STATUS_META[k].color,
      count: byStatus[k] ?? 0,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
  const max = Math.max(1, ...items.map((i) => i.count))

  return (
    <Card className="h-full">
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Задачи по статусам
        </CardTitle>
        <CardDescription>Всего задач: {total}</CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {items.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Activity className="h-8 w-8" />
            <span>Задач пока нет</span>
          </div>
        ) : (
          <ul className="space-y-3" role="list">
            {items.map((it) => (
              <li key={it.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: it.color }}
                    />
                    <span className="text-foreground">{it.label}</span>
                  </div>
                  <span className="tabular-nums font-medium">{it.count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(it.count / max) * 100}%`,
                      backgroundColor: it.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ----------------------------------------------------- HoursByDay --
function HoursByDayCard({
  hoursByDay,
}: {
  hoursByDay: Record<string, number>
}) {
  // Build 14-day window ending today so we always show context.
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: { day: string; label: string; hours: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({
      day: key,
      label: format(d, "d MMM", { locale: ru }),
      hours: hoursByDay[key] ?? 0,
    })
  }
  const total = days.reduce((a, b) => a + b.hours, 0)
  const max = Math.max(1, ...days.map((d) => d.hours))

  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Отработанные часы за 14 дней
            </CardTitle>
            <CardDescription className="mt-1">
              Сумма подтверждённых сессий по дням
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Всего за 14 дней
            </p>
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {total.toFixed(1)} ч
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={days}
              margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
                opacity={0.6}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval={1}
              />
              <YAxis
                allowDecimals
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                  padding: "6px 10px",
                }}
                formatter={(v: number) => [`${v.toFixed(2)} ч`, "Часы"]}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]} maxBarSize={26}>
                {days.map((d) => (
                  <Cell
                    key={d.day}
                    fill={d.hours === 0 ? "#e5e7eb" : "#0d9488"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------- MembersTable --
function MembersTable({
  members,
  total,
}: {
  members: TeamMember[]
  total: number
}) {
  const maxContrib = Math.max(1, ...members.map((m) => m.contribution))
  // back-compat: older backends may not return outstandingLabor on members — default to 0
  for (const m of members) (m as any).outstandingLabor ??= 0
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-muted-foreground" />
          Вклады по участникам
        </CardTitle>
        <CardDescription>
          Подробная разбивка по типам вклада · отсортировано по сумме вклада
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto scroll-thin">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Участник</TableHead>
                <TableHead className="text-right">Взносы</TableHead>
                <TableHead className="text-right">Расходы</TableHead>
                <TableHead className="text-right">Труд</TableHead>
                <TableHead className="text-right">Непогашено</TableHead>
                <TableHead className="text-right">Премии</TableHead>
                <TableHead className="text-right">Отмены</TableHead>
                <TableHead className="text-right">Часы</TableHead>
                <TableHead className="pr-5 text-right">Вклад · доля</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const pct =
                  total > 0 ? Math.max(0, (m.contribution / total) * 100) : 0
                const shareWidthPct =
                  maxContrib > 0
                    ? Math.max(2, (m.contribution / maxContrib) * 100)
                    : 0
                const initials = m.displayName
                  .split(/\s+/)
                  .map((s) => s[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                          style={{ backgroundColor: m.color }}
                          aria-hidden
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {m.displayName}
                          </p>
                          <p className="text-[11px] capitalize text-muted-foreground">
                            {m.role === "admin" ? "администратор" : m.role}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {m.cash === 0 ? "—" : formatMoney(m.cash)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {m.expense === 0 ? "—" : formatMoney(m.expense)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {m.labor === 0 ? "—" : formatMoney(m.labor)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-xs tabular-nums",
                        m.outstandingLabor > 0
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {m.outstandingLabor === 0 ? "—" : formatMoney(m.outstandingLabor)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {m.bonus === 0 ? "—" : formatMoney(m.bonus)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-rose-600 dark:text-rose-400">
                      {m.reversal === 0 ? "—" : formatMoney(m.reversal)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(m.hoursSeconds)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(m.contribution)}
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${shareWidthPct}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------- RecentFeed --
function RecentFeed({ entries }: { entries: RecentEntry[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border/60 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Лента операций
        </CardTitle>
        <CardDescription>
          Последние записи в общем реестре вкладов
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <History className="h-8 w-8" />
            <span>Записей пока нет</span>
          </div>
        ) : (
          <ul
            className="max-h-96 divide-y divide-border/60 overflow-y-auto scroll-thin"
            role="list"
          >
            {entries.map((e) => {
              const meta = ENTRY_KIND_META[e.kind] ?? {
                label: e.kind,
                dot: "bg-muted-foreground",
                text: "text-muted-foreground",
              }
              const negative = e.amountMinor < 0
              const initials = e.user?.displayName
                ?.split(/\s+/)
                .map((s) => s[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()
              return (
                <li
                  key={e.id}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{
                      backgroundColor: e.user?.color ?? "#9ca3af",
                    }}
                    aria-hidden
                  >
                    {initials ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-xs font-medium",
                            meta.text,
                          )}
                        >
                          {meta.label}
                        </span>
                        {e.user && (
                          <span className="text-xs text-muted-foreground">
                            {e.user.displayName}
                          </span>
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
                        {formatMoney(e.amountMinor, e.currency)}
                      </span>
                    </div>
                    {e.note && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {e.note}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-[11px] text-muted-foreground/80">
                      <span>
                        {format(new Date(e.createdAt), "d MMM yyyy, HH:mm", {
                          locale: ru,
                        })}
                      </span>
                      {e.task && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{e.task.title}</span>
                        </>
                      )}
                    </div>
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

// --------------------------------------------------------- Skeleton --
function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-64 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-80 rounded-xl lg:col-span-3" />
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-96 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}
