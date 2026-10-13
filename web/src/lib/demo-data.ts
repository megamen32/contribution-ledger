// Synthetic examples only. No network, identity or production ledger data.
export const DEMO_MEMBERS = [{id:"you",name:"Вы",role:"Разработка"},{id:"anna",name:"Анна",role:"Дизайн"},{id:"max",name:"Максим",role:"Организация"}]
export type DemoEntry = { title: string; amountMinor: number; kind: "work" | "cash"; memberId: string; detail: string }
export type DemoTask = { title: string; done: boolean; description: string; owner: string; report: string }
export function demoEntries(): DemoEntry[] { return [
 {title:"Форма регистрации",amountMinor:900000,kind:"work",memberId:"you",detail:"6 часов × 1 500 ₽/час"},
 {title:"Домен и хостинг",amountMinor:300000,kind:"cash",memberId:"you",detail:"Расходы на запуск"},
 {title:"Макет главной страницы",amountMinor:600000,kind:"work",memberId:"anna",detail:"4 часа × 1 500 ₽/час"},
 {title:"Интервью с пользователями",amountMinor:400000,kind:"work",memberId:"max",detail:"4 часа × 1 000 ₽/час"},
 {title:"Тестовое размещение",amountMinor:200000,kind:"cash",memberId:"max",detail:"Расходы на проверку идеи"},
] }
export function demoTasks(): DemoTask[] { return [
 {title:"Форма регистрации",done:true,description:"Создать аккаунт, проверить поля и показать понятные ошибки.",owner:"Вы",report:"Форма готова: логин, пароль, название проекта. Проверены пустые поля и повторный логин."},
 {title:"Макет главной страницы",done:true,description:"Подготовить экран для знакомства с продуктом.",owner:"Анна",report:"Готовы макеты для компьютера и телефона, кнопки входа и скачивания."},
 {title:"Подготовить запуск",done:false,description:"Собрать обратную связь и составить список улучшений.",owner:"Максим",report:"Проведены три интервью. Осталось проверить первые регистрации."},
] }
export function memberTotals(entries: DemoEntry[], memberId: string) {
 const own=entries.filter(e=>e.memberId===memberId)
 return {work:own.filter(e=>e.kind==="work").reduce((s,e)=>s+e.amountMinor,0),cash:own.filter(e=>e.kind==="cash").reduce((s,e)=>s+e.amountMinor,0)}
}
