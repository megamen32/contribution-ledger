"use client"

import { useState } from "react"
import { Scale, Download, RotateCcw, Briefcase, ListTodo, Users, Settings, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMoney, grossMinor } from "@/lib/money"
import { DEMO_MEMBERS, demoEntries, demoTasks, memberTotals, type DemoEntry, type DemoTask } from "@/lib/demo-data"

const TABS = ["Моя работа", "Задачи", "Вклады команды", "Настройки"] as const
const ICONS = [Briefcase, ListTodo, Users, Settings]
// Browser-only sandbox. Examples and changes never reach the real workspace API.
export function DemoShell() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Моя работа")
  const [entries, setEntries] = useState<DemoEntry[]>(demoEntries)
  const [tasks, setTasks] = useState<DemoTask[]>(demoTasks)
  const [selectedTask, setSelectedTask] = useState(0)
  const [title, setTitle] = useState("")
  const [hours, setHours] = useState("1")
  const [rate, setRate] = useState("1500")
  const [cash, setCash] = useState("1000")
  const [error, setError] = useState("")
  const mine = memberTotals(entries,"you")
  const workTotal = entries.filter(e=>e.kind==="work").reduce((s,e)=>s+e.amountMinor,0)
  const cashTotal = entries.filter(e=>e.kind==="cash").reduce((s,e)=>s+e.amountMinor,0)
  const money = (minor:number)=>formatMoney(minor,"RUB")
  const selected = tasks[selectedTask]
  function reset() { setEntries(demoEntries()); setTasks(demoTasks()); setTitle(""); setError(""); setRate("1500"); setHours("1"); setCash("1000"); setSelectedTask(0) }
  function add(kind:DemoEntry["kind"]) {
    if (!title.trim()) {setError("Укажите, что вы сделали или оплатили");return}
    const seconds=Math.round(Number(hours)*3600), hourlyMinor=Math.round(Number(rate)*100)
    if(kind==="work"&&(!Number.isSafeInteger(seconds)||!Number.isSafeInteger(hourlyMinor)||seconds<=0||hourlyMinor<=0)){setError("Введите положительные часы и ставку");return}
    const amountMinor=kind==="cash"?Math.round(Number(cash)*100):grossMinor(seconds,hourlyMinor)
    if(!Number.isSafeInteger(amountMinor)||amountMinor<=0||amountMinor>100_000_000_00){setError("Введите положительные часы, ставку или сумму");return}
    setEntries(previous=>[{title:title.trim(),amountMinor,kind,memberId:"you",detail:kind==="work"?`${hours} ч × ${rate} ₽/час`:"Денежный вклад"},...previous]);setTitle("");setError("")
  }
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
      <a href="/" className="flex items-center gap-2 font-semibold"><Scale className="text-primary"/>Вклад</a>
      <nav aria-label="Разделы демо" className="order-3 flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto">{TABS.map((item,i)=>{const Icon=ICONS[i];return <Button key={item} variant={tab===item?"secondary":"ghost"} className="shrink-0 gap-2" onClick={()=>{setTab(item);setError("")}}><Icon className="h-4 w-4"/>{item}</Button>})}</nav>
      <div className="ml-auto flex items-center gap-3 text-sm"><span className="rounded-full bg-primary/10 px-3 py-1 text-primary">Демо</span><a href="/login" className="hover:underline">Войти</a><a href="/login?register=1" className="rounded-md bg-primary px-3 py-2 text-primary-foreground">Создать аккаунт</a></div>
    </div></header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">Запуск сервиса</h1><p className="mt-1 text-sm text-muted-foreground">Демонстрационный проект · 3 участника · вы владелец</p></div><Button variant="outline" size="sm" className="gap-2" onClick={reset}><RotateCcw className="h-4 w-4"/>Сбросить демо</Button></div>
      <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Кабинет заполнен примерами. Меняйте записи и задачи — изменения останутся в этой вкладке. Для своей команды создайте аккаунт.</p>
      <div className="grid gap-4 sm:grid-cols-3">{[[tab==="Вклады команды"?"Труд команды":"Ваш труд",tab==="Вклады команды"?workTotal:mine.work],[tab==="Вклады команды"?"Деньги команды":"Ваши вложения",tab==="Вклады команды"?cashTotal:mine.cash],[tab==="Вклады команды"?"Общий вклад команды":"Ваш общий вклад",tab==="Вклады команды"?workTotal+cashTotal:mine.work+mine.cash]].map(([label,value])=><Card key={label}><CardHeader><CardTitle className="text-sm text-muted-foreground">{label}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold sm:text-3xl">{money(Number(value))}</CardContent></Card>)}</div>
      {tab==="Моя работа"&&<div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Добавить работу или расходы</CardTitle></CardHeader><CardContent className="space-y-4">
          <label className="block space-y-2 text-sm">Что сделано или оплачено<Input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder="Например, проверка формы"/></label>
          <div className="grid grid-cols-2 gap-3"><label className="block space-y-2 text-sm">Часы<Input type="number" min="0.01" step="0.25" value={hours} onChange={e=>setHours(e.target.value)}/></label><label className="block space-y-2 text-sm">Ставка, ₽/час<Input type="number" min="1" value={rate} onChange={e=>setRate(e.target.value)}/></label></div>
          <Button onClick={()=>add("work")}>Добавить работу</Button>
          <div className="border-t pt-4"><label className="block space-y-2 text-sm">Денежный вклад, ₽<Input type="number" min="0.01" step="0.01" value={cash} onChange={e=>setCash(e.target.value)}/></label><Button variant="outline" className="mt-3" onClick={()=>add("cash")}>Добавить деньги</Button></div>
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Ваша история вкладов</CardTitle></CardHeader><CardContent><ul className="divide-y">{entries.filter(e=>e.memberId==="you").map((entry,i)=><li key={i} className="flex justify-between gap-4 py-3"><div><p>{entry.title}</p><p className="mt-1 text-sm text-muted-foreground">{entry.detail}</p></div><strong className="shrink-0">{money(entry.amountMinor)}</strong></li>)}</ul><div className="mt-5 rounded-lg bg-muted/40 p-4 text-sm"><p className="font-medium">Последняя рабочая сессия</p><p className="mt-2 text-muted-foreground">Форма регистрации · 6 часов · завершена</p><p className="mt-1 text-muted-foreground">Отчёт сохранён в задаче.</p><Button variant="link" className="px-0" onClick={()=>{setSelectedTask(0);setTab("Задачи")}}>Открыть задачу</Button></div></CardContent></Card>
      </div>}
      {tab==="Задачи"&&<div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card><CardHeader><CardTitle>Задачи · {tasks.length}</CardTitle></CardHeader><CardContent className="space-y-4"><form className="flex gap-2" onSubmit={e=>{e.preventDefault();if(title.trim()){setTasks(previous=>[...previous,{title:title.trim(),done:false,description:"Новая задача демо",owner:"Вы",report:"Отчёта пока нет."}]);setSelectedTask(tasks.length);setTitle("")}}}><Input aria-label="Название задачи" placeholder="Название задачи" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/><Button type="submit">Добавить задачу</Button></form><ul className="space-y-2">{tasks.map((task,i)=><li key={i}><button className={`w-full rounded-lg border p-3 text-left ${selectedTask===i?"border-primary bg-primary/5":""}`} onClick={()=>setSelectedTask(i)}><span className="block font-medium">{task.title}</span><span className="mt-1 block text-sm text-muted-foreground">{task.owner} · {task.done?"Выполнена":"В работе"}</span></button></li>)}</ul></CardContent></Card>
        {selected&&<Card><CardHeader><CardTitle>{selected.title}</CardTitle></CardHeader><CardContent className="space-y-5"><p>{selected.description}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.done} onChange={()=>setTasks(previous=>previous.map((task,i)=>i===selectedTask?{...task,done:!task.done}:task))}/>Задача выполнена</label><div className="rounded-lg border p-4"><h2 className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-primary"/>Отчёт о работе</h2><p className="mt-3 text-sm text-muted-foreground">{selected.report}</p></div><p className="text-sm text-muted-foreground">В рабочем кабинете отчёт можно отправить на оценку ИИ. В демо платные запросы и запись экрана не запускаются.</p></CardContent></Card>}
      </div>}
      {tab==="Вклады команды"&&<Card><CardHeader><CardTitle>Вклады участников</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-muted-foreground"><tr><th className="py-3">Участник</th><th className="px-3">Труд</th><th className="px-3">Деньги</th><th className="text-right">Итого</th></tr></thead><tbody>{DEMO_MEMBERS.map(member=>{const totals=memberTotals(entries,member.id);return <tr key={member.id} className="border-b last:border-0"><td className="py-4"><p className="font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.role}</p></td><td className="whitespace-nowrap px-3">{money(totals.work)}</td><td className="whitespace-nowrap px-3">{money(totals.cash)}</td><td className="whitespace-nowrap text-right font-semibold">{money(totals.work+totals.cash)}</td></tr>})}</tbody></table></div><p className="mt-5 text-sm text-muted-foreground">Вклад = труд по согласованной ставке + денежные вложения. Это учтённая сумма, а не доля в компании. Все участники и записи здесь вымышлены.</p></CardContent></Card>}
      {tab==="Настройки"&&<Card><CardHeader><CardTitle>Правила проекта</CardTitle></CardHeader><CardContent className="max-w-xl space-y-4"><label className="block space-y-2 text-sm">Пробная ставка, ₽/час<Input type="number" min="1" value={rate} onChange={e=>setRate(e.target.value)}/></label><p className="text-sm text-muted-foreground">Новая ставка применяется к следующим записям. Уже добавленный труд сохраняет сумму. Подтверждённый труд учитывается по ставке независимо от оценки результата ИИ.</p><p className="text-sm text-muted-foreground">В своём проекте вы сможете настроить ставки, пригласить участников и хранить настоящие записи.</p></CardContent></Card>}
      <footer className="flex flex-wrap items-center gap-4 border-t pt-5 text-sm text-muted-foreground"><a href="/downloads/Vklad-macOS-arm64-v0.3.1.dmg" className="inline-flex items-center gap-2 hover:text-foreground"><Download className="h-4 w-4"/>Скачать для macOS</a><a href="/downloads/" className="hover:underline">Все загрузки</a><a href="https://github.com/megamen32/contribution-ledger" className="hover:underline">Исходный код на GitHub</a><a href="/login?register=1" className="ml-auto text-primary hover:underline">Создать свой проект →</a></footer>
    </main>
  </div>
}
