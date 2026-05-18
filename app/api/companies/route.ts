import { NextResponse } from "next/server"
import { fetchCompanyList } from "@/lib/dart"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET() {
  try {
    const companies = await fetchCompanyList()
    return NextResponse.json({ companies })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "기업 목록 조회 실패"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
