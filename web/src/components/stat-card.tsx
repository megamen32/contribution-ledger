"use client"

import * as React from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ReactNode
  accent?: "default" | "emerald" | "amber" | "rose" | "teal" | "copper"
  className?: string
  children?: React.ReactNode
}

const ACCENTS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
  teal: "text-teal-600 dark:text-teal-400",
  copper: "text-orange-600 dark:text-orange-400",
}

const ACCENT_BG: Record<NonNullable<StatCardProps["accent"]>, string> = {
  default: "bg-muted text-muted-foreground",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  copper: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
}

export function StatCard({ label, value, hint, icon, accent = "default", className, children }: StatCardProps) {
  return (
    <Card className={cn("overflow-hidden gap-0 py-0", className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("mt-2 text-2xl font-semibold tabular-nums", ACCENTS[accent])}>{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", ACCENT_BG[accent])}>
            {icon}
          </div>
        )}
      </div>
      {children && <div className="px-5 pb-5 pt-3">{children}</div>}
    </Card>
  )
}
