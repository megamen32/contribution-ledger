import { getCurrentUser } from "@/lib/auth"
import { AppShell } from "@/components/app-shell"
import { DemoShell } from "@/components/demo-shell"
export const dynamic = "force-dynamic"
export default async function Home() {
  if (!(await getCurrentUser())) return <DemoShell />
  return <AppShell />
}
