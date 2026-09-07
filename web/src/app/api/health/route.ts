import { NextResponse } from "next/server"
export function GET() {
  return NextResponse.json({ status: "ok", service: "vklad", version: "0.2.0", capture: false })
}
