import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { AccountSettings } from "@/components/account-settings"
export const dynamic = "force-dynamic"
export default async function Account() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return <AccountSettings admin={user.role === "admin"} />
}
