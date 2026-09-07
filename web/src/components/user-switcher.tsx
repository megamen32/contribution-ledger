"use client"

import * as React from "react"
import { Check, ChevronDown, Users } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { AddMember } from "./add-member"

export interface Member {
  id: string
  displayName: string
  email: string
  role: string
  color: string
  timezone: string
}

export function UserSwitcher({
  members,
  current,
  onChange,
}: {
  members: Member[]
  current: Member | null
  onChange: (m: Member) => void
}) {
  const [open, setOpen] = React.useState(false)

  async function switchTo(m: Member) {
    try {
      await api("/api/me", { method: "POST", json: { userId: m.id } })
      onChange(m)
    } catch (e) {
      console.error(e)
    }
    setOpen(false)
  }

  const initials = current
    ? current.displayName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()
    : "?"

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 pl-1.5 pr-2.5">
          <Avatar className="h-7 w-7">
            <AvatarFallback style={{ backgroundColor: current?.color, color: "white" }} className="text-[11px] font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{current?.displayName ?? "Выбрать"}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2 text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> Команда ({members.length})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {members.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => switchTo(m)} className="gap-2 py-2">
            <Avatar className="h-7 w-7">
              <AvatarFallback style={{ backgroundColor: m.color, color: "white" }} className="text-[11px] font-semibold">
                {m.displayName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{m.displayName}</span>
              <span className="truncate text-xs text-muted-foreground">{m.role === "admin" ? "Администратор" : "Участник"}</span>
            </div>
            {current?.id === m.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <AddMember onAdded={onChange} />
        <DropdownMenuItem asChild><a href="/downloads/">Клиенты Mac / Windows</a></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
