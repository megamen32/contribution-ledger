import { NextResponse } from "next/server"

// GET /api — health
export async function GET() {
  return NextResponse.json({ ok: true, service: "vklad", version: "1.0.0" })
}
