import { NextRequest } from "next/server"
import ExcelJS from "exceljs"
import { readFile } from "fs/promises"
import path from "path"
import { QUARTER_REPORT_MAP, type FinancialData } from "@/lib/dart"

interface SectorData {
  updatedAt: string
  data: Record<string, { code: string; name: string }>
}

interface DataFile {
  year: string
  quarter: string
  fsDiv: string
  updatedAt: string
  total: number
  failed: number
  data: FinancialData[]
}

async function loadSectorMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "data", "sector.json"), "utf-8")
    const sectorData: SectorData = JSON.parse(raw)
    return Object.fromEntries(
      Object.entries(sectorData.data).map(([stockCode, s]) => [stockCode, s.name]),
    )
  } catch {
    return {}
  }
}

function getPrevYearSameQuarter(year: string, quarter: string): { year: string; quarter: string } {
  return { year: String(parseInt(year) - 1), quarter }
}

function calcGrowthRate(current: string | null, prev: string | null): number | null {
  if (!current || !prev) return null
  const c = Number(current)
  const p = Number(prev)
  if (p === 0) return null
  return ((c - p) / Math.abs(p)) * 100
}

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year")
  const quarter = searchParams.get("quarter")
  const fsDiv = searchParams.get("fsDiv")

  if (!year || !quarter || !fsDiv) {
    return new Response("year, quarter, fsDiv 파라미터가 필요합니다", { status: 400 })
  }

  if (!QUARTER_REPORT_MAP[quarter]) {
    return new Response("올바르지 않은 분기입니다", { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 클라이언트 연결 끊김
        }
      }

      try {
        send({ type: "status", message: "데이터 로딩 중..." })

        const dataDir = path.join(process.cwd(), "public", "data")

        let fileData: DataFile
        try {
          const raw = await readFile(path.join(dataDir, `${year}_${quarter}_${fsDiv}.json`), "utf-8")
          fileData = JSON.parse(raw)
        } catch {
          send({
            type: "error",
            message: `${year}년 ${quarter} ${fsDiv} 데이터가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.`,
          })
          return
        }

        // 직전 분기 데이터 로드 (없으면 빈 맵)
        const prev = getPrevYearSameQuarter(year, quarter)
        const prevMap = new Map<string, FinancialData>()
        try {
          const prevRaw = await readFile(
            path.join(dataDir, `${prev.year}_${prev.quarter}_${fsDiv}.json`),
            "utf-8",
          )
          const prevData: DataFile = JSON.parse(prevRaw)
          for (const row of prevData.data) {
            prevMap.set(row.stock_code, row)
          }
        } catch {
          // 직전 분기 파일 없으면 전년비 빈칸
        }

        const results = fileData.data
        const total = fileData.total
        const failed = fileData.failed

        send({ type: "progress", done: total, total, failed, current: "" })
        send({ type: "status", message: "엑셀 생성 중..." })

        const sectorMap = await loadSectorMap()

        const quarterLabel =
          { Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기" }[quarter] ?? quarter
        const fsDivLabel = fsDiv === "CFS" ? "연결" : "별도"

        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet("분기실적")

        sheet.columns = [
          { header: "기업명", key: "corp_name", width: 20 },
          { header: "매출액", key: "revenue", width: 18 },
          { header: "매출액 전년비(%)", key: "revenue_growth", width: 18 },
          { header: "영업이익", key: "operating_profit", width: 18 },
          { header: "영업이익 전년비(%)", key: "operating_profit_growth", width: 20 },
          { header: "순이익", key: "net_income", width: 18 },
          { header: "순이익 전년비(%)", key: "net_income_growth", width: 18 },
          { header: "업종", key: "sector", width: 22 },
        ]

        sheet.getRow(1).font = { bold: true }
        sheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE9ECEF" },
        }

        const filteredResults = results.filter(
          (r) => r.revenue !== null || r.operating_profit !== null,
        )

        for (const row of filteredResults) {
          const prevRow = prevMap.get(row.stock_code)
          const revenueGrowth = calcGrowthRate(row.revenue, prevRow?.revenue ?? null)
          const opGrowth = calcGrowthRate(row.operating_profit, prevRow?.operating_profit ?? null)
          const niGrowth = calcGrowthRate(row.net_income, prevRow?.net_income ?? null)

          sheet.addRow({
            corp_name: row.corp_name,
            revenue: row.revenue != null ? Number(row.revenue) : "",
            revenue_growth: revenueGrowth != null ? Math.round(revenueGrowth * 10) / 10 : "",
            operating_profit: row.operating_profit != null ? Number(row.operating_profit) : "",
            operating_profit_growth: opGrowth != null ? Math.round(opGrowth * 10) / 10 : "",
            net_income: row.net_income != null ? Number(row.net_income) : "",
            net_income_growth: niGrowth != null ? Math.round(niGrowth * 10) / 10 : "",
            sector: sectorMap[row.stock_code] ?? "",
          })
        }

        for (let i = 2; i <= filteredResults.length + 1; i++) {
          const r = sheet.getRow(i)
          ;["revenue", "operating_profit", "net_income"].forEach((key) => {
            const cell = r.getCell(key)
            if (typeof cell.value === "number") cell.numFmt = "#,##0"
          })
          ;["revenue_growth", "operating_profit_growth", "net_income_growth"].forEach((key) => {
            const cell = r.getCell(key)
            if (typeof cell.value === "number") cell.numFmt = '0.0"%"'
          })
        }

        const buffer = await workbook.xlsx.writeBuffer()
        const base64 = Buffer.from(buffer).toString("base64")
        const filename = `상장사_분기실적_${year}_${quarterLabel}_${fsDivLabel}.xlsx`

        send({ type: "done", filename, base64, total, failed })
      } catch (e) {
        const message = e instanceof Error ? e.message : "알 수 없는 오류"
        send({ type: "error", message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
