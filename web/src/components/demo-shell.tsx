"use client"

import { useState } from "react"
import { Scale, Download, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney, grossMinor } from "@/lib/money"

type Entry = { title: string; amountMinor: number; kind: "work" | "cash" }
const TABS = ["Моя работа", "Задачи", "Вклады команды", "Настройки"] as const

// This sandbox has no network adapter or access to the team's ledger.
// Each visitor's entries exist only in this component until reload.
export function DemoShell() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Моя работа")
  const [entries, setEntries] = useState<Entry[]>([])
  const [tasks, setTasks] = useState<{ title: string; done: boolean }[]>([])
  const [title, setTitle] = useState("")
  const [hours, setHours] = useState("1")
  const [rate, setRate] = useState("1000")
  const [cash, setCash] = useState("1000")
  const [error, setError] = useState("")
  const workTotal = entries.filter(e => e.kind === "work").reduce((sum, e) => sum + e.amountMinor, 0)
  const cashTotal = entries.filter(e => e.kind === "cash").reduce((sum, e) => sum + e.amountMinor, 0)
  const money = (minor: number) => formatMoney(minor, "RUB")

  function add(kind: Entry["kind"]) {
    if (!title.trim()) { setError("Укажите, что вы сделали или оплатили"); return }
    const seconds = Math.round(Number(hours) * 3600)
    const hourlyMinor = Math.round(Number(rate) * 100)
    if (kind === "work" && (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(hourlyMinor) || seconds <= 0 || hourlyMinor <= 0)) {
      setError("Введите положительные часы и ставку"); return
    }
    const amountMinor = kind === "cash" ? Math.round(Number(cash) * 100) : grossMinor(seconds, hourlyMinor)
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > 100_000_000_00) {
      setError("Введите положительные часы, ставку или сумму"); return
    }
    setEntries(previous => [...previous, { title: title.trim(), amountMinor, kind }])
    setTitle("")
    setError("")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 text-xl font-semibold"><Scale className="text-primary" />Вклад</a>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">Демо без регистрации</span>
          <div className="ml-auto flex flex-wrap items-center gap-4 text-sm">
            <a href="/downloads/Vklad-macOS-arm64-v0.3.0.dmg" className="inline-flex items-center gap-2 text-primary hover:underline"><Download className="h-4 w-4" />Скачать для macOS</a>
            <a href="/login" className="hover:underline">Войти</a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Попробуйте учёт вкладов команды</h1>
          <p className="text-muted-foreground">Добавьте пробную работу или расходы и посмотрите, как складывается вклад. Всё в этом демо остаётся в вашей вкладке и сбрасывается при перезагрузке.</p>
        </div>
        <nav aria-label="Разделы демо" className="flex gap-2 overflow-x-auto border-b pb-3">
          {TABS.map(item => <Button key={item} variant={tab === item ? "default" : "ghost"} className="shrink-0" onClick={() => { setTab(item); setError("") }}>{item}</Button>)}
        </nav>
        <div className="grid gap-4 sm:grid-cols-3">
          {[["Труд", workTotal], ["Денежные вложения", cashTotal], ["Общий вклад", workTotal + cashTotal]].map(([label, value]) => (
            <Card key={label}><CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-3xl font-semibold">{money(Number(value))}</CardContent></Card>
          ))}
        </div>
        {tab === "Моя работа" && <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Добавить пробный вклад</CardTitle></CardHeader><CardContent className="space-y-4">
            <label className="block space-y-2 text-sm">Что сделано или оплачено<Input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} placeholder="Например, подготовка макета" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2 text-sm">Часы<Input type="number" min="0.01" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></label>
              <label className="block space-y-2 text-sm">Ставка, ₽/час<Input type="number" min="1" value={rate} onChange={e => setRate(e.target.value)} /></label>
            </div>
            <Button onClick={() => add("work")}>Добавить работу</Button>
            <div className="border-t pt-4"><label className="block space-y-2 text-sm">Денежный вклад, ₽<Input type="number" min="0.01" step="0.01" value={cash} onChange={e => setCash(e.target.value)} /></label><Button variant="outline" className="mt-3" onClick={() => add("cash")}>Добавить деньги</Button></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle>История пробных вкладов</CardTitle></CardHeader><CardContent>
            {entries.length === 0 ? <p className="text-muted-foreground">Здесь появятся ваши пробные записи. Начните с одной работы.</p> : <ul className="divide-y">{entries.map((entry, i) => <li key={i} className="flex justify-between gap-4 py-3"><div><p>{entry.title}</p><p className="text-sm text-muted-foreground">{entry.kind === "work" ? "Труд" : "Деньги"}</p></div><strong className="shrink-0">{money(entry.amountMinor)}</strong></li>)}</ul>}
          </CardContent></Card>
        </div>}
        {tab === "Задачи" && <Card><CardHeader><CardTitle>Попробуйте список задач</CardTitle></CardHeader><CardContent className="space-y-4">
          <form className="flex gap-3" onSubmit={e => { e.preventDefault(); if (title.trim()) { setTasks(previous => [...previous, { title: title.trim(), done: false }]); setTitle("") } }}><Input aria-label="Название задачи" placeholder="Название задачи" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /><Button type="submit">Добавить задачу</Button></form>
          {tasks.length === 0 && <p className="text-muted-foreground">Создайте задачу, затем отметьте её выполненной.</p>}
          <ul className="space-y-3">{tasks.map((task, i) => <li key={i}><label className="flex items-center gap-3"><input type="checkbox" checked={task.done} onChange={() => setTasks(previous => previous.map((item, index) => index === i ? { ...item, done: !item.done } : item))} /><span className={task.done ? "line-through text-muted-foreground" : ""}>{task.title}</span></label></li>)}</ul>
          <p className="text-sm text-muted-foreground">Оценка ИИ и запись экрана доступны в настроенном рабочем кабинете. В демо они не запускаются.</p>
        </CardContent></Card>}
        {tab === "Вклады команды" && <Card><CardHeader><CardTitle>Как считается вклад</CardTitle></CardHeader><CardContent className="space-y-4">
          <p>Пробный участник: труд {money(workTotal)} + денежные вложения {money(cashTotal)} = <strong>{money(workTotal + cashTotal)}</strong>.</p>
          <p className="text-muted-foreground">Труд учитывается по согласованной ставке. Это сумма учтённого вклада, а не доля в компании. Данные реальной команды здесь не отображаются.</p>
          <Button onClick={() => setTab("Моя работа")}>Добавить ещё вклад</Button>
        </CardContent></Card>}
        {tab === "Настройки" && <Card><CardHeader><CardTitle>Настройки демо</CardTitle></CardHeader><CardContent className="max-w-lg space-y-4">
          <label className="block space-y-2 text-sm">Пробная ставка, ₽/час<Input type="number" min="1" value={rate} onChange={e => setRate(e.target.value)} /></label>
          <p className="text-sm text-muted-foreground">Новая ставка применяется к следующим записям. Уже добавленная работа сохраняет свою сумму.</p>
          <Button variant="outline" onClick={() => { setEntries([]); setTasks([]); setTitle(""); setError(""); setRate("1000"); setHours("1"); setCash("1000") }}>Сбросить демо</Button>
        </CardContent></Card>}
        <section className="flex flex-col justify-between gap-4 rounded-xl border bg-muted/30 p-6 sm:flex-row sm:items-center">
          <div><h2 className="text-lg font-semibold">Готовы вести настоящие записи?</h2><p className="mt-1 text-sm text-muted-foreground">Создайте свой проект и пригласите команду. Пробные записи в кабинет не переносятся.</p></div>
          <a href="/login?register=1" className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Создать аккаунт<ArrowRight className="h-4 w-4" /></a>
        </section>
        <footer className="flex flex-wrap gap-4 text-sm text-muted-foreground"><span>macOS: Apple Silicon · версия 0.3.0</span><a className="hover:underline" href="/downloads/">Все загрузки</a><a className="hover:underline" href="https://github.com/megamen32/contribution-ledger">Исходный код на GitHub</a></footer>
      </main>
    </div>
  )
}
