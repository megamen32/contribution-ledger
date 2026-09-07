import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { AppShell } from "@/components/app-shell"
export const dynamic = "force-dynamic"
export default async function Home() {
  if (!(await getCurrentUser())) redirect("/login")
  return <AppShell />
}
