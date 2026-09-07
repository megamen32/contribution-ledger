import { NextRequest, NextResponse } from "next/server"
export function proxy(req: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin")
    const allowed = process.env.PUBLIC_ORIGIN || "https://vklad.bezrabotnyi.com"
    if (origin && origin !== allowed) return NextResponse.json({ error: "Cross-origin write blocked" }, { status: 403 })
  }
  return NextResponse.next()
}
export const config = { matcher: ["/api/:path*"] }
