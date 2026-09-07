"use client"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
export interface Member { id: string; displayName: string; email: string; role: string; color: string; timezone: string }
// Identity switching was intentionally removed: a member can only open their own private board.
export function UserSwitcher({ current }: { current: Member | null; members: Member[]; onChange: (member: Member) => void }) {
  return current ? <div className="flex items-center gap-2"><a href="/account" className="text-sm underline">{current.displayName}</a><Button variant="outline" size="sm" onClick={() => signOut({ callbackUrl: "/login" })}>Выйти</Button></div> : <a href="/login" className="text-sm underline">Войти</a>
}
