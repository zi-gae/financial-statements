import { NextRequest } from "next/server"
import pLimit from "p-limit"
import ExcelJS from "exceljs"
import {
  fetchCompanyList,
  fetchFinancialStatement,
  QUARTER_REPORT_MAP,
  type FinancialData,
} from "@/lib/dart"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = searchParams.get("year")
  const quarter = searchParams.get("quarter")
  const fsDiv = searchParams.get("fsDiv")

  if (!year || !quarter || !fsDiv) {
    return new Response("year, quarter, fsDiv 파라미터가 필요합니다", { status: 400 })
  }

  const reprtCode = QUARTER_REPORT_MAP[quarter]
  if (!reprtCode) {
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
        send({ type: "status", message: "기업 목록 조회 중..." })

        const companies = await fetchCompanyList()
        const total = companies.length

        send({ type: "progress", done: 0, total, failed: 0, current: "" })

        const limit = pLimit(3)
        const results: FinancialData[] = []
        let done = 0
        let failed = 0

        const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

        const fetchWithRetry = async (corpCode: string, retries = 2): ReturnType<typeof fetchFinancialStatement> => {
          for (let i = 0; i <= retries; i++) {
            const result = await fetchFinancialStatement(corpCode, year, reprtCode, fsDiv)
            if (result.status !== "조회실패" || i === retries) return result
            await delay(1000 * (i + 1))
          }
          return { revenue: null, operating_profit: null, net_income: null, status: "조회실패" }
        }

        await Promise.all(
          companies.map((company) =>
            limit(async () => {
              if (req.signal.aborted) return

              await delay(100)

              const fin = await fetchWithRetry(company.corp_code)

              if (fin.status === "조회실패") failed++
              done++

              results.push({
                corp_name: company.corp_name,
                stock_code: company.stock_code,
                ...fin,
              })

              if (done % 20 === 0 || done === total) {
                send({ type: "progress", done, total, failed, current: company.corp_name })
              }
            }),
          ),
        )

        send({ type: "status", message: "엑셀 생성 중..." })

        const quarterLabel =
          { Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기" }[quarter] ?? quarter
        const fsDivLabel = fsDiv === "CFS" ? "연결" : "별도"

        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet("분기실적")

        sheet.columns = [
          { header: "기업명", key: "corp_name", width: 20 },
          { header: "종목코드", key: "stock_code", width: 12 },
          { header: "연도", key: "year", width: 8 },
          { header: "분기", key: "quarter", width: 8 },
          { header: "재무구분", key: "fs_div", width: 10 },
          { header: "매출액", key: "revenue", width: 18 },
          { header: "영업이익", key: "operating_profit", width: 18 },
          { header: "당기순이익", key: "net_income", width: 18 },
          { header: "데이터상태", key: "status", width: 12 },
        ]

        sheet.getRow(1).font = { bold: true }
        sheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE9ECEF" },
        }

        for (const row of results) {
          sheet.addRow({
            corp_name: row.corp_name,
            stock_code: row.stock_code,
            year,
            quarter: quarterLabel,
            fs_div: fsDivLabel,
            revenue: row.revenue != null ? Number(row.revenue) : "",
            operating_profit:
              row.operating_profit != null ? Number(row.operating_profit) : "",
            net_income: row.net_income != null ? Number(row.net_income) : "",
            status: row.status,
          })
        }

        for (let i = 2; i <= results.length + 1; i++) {
          const r = sheet.getRow(i)
          ;["revenue", "operating_profit", "net_income"].forEach((key) => {
            const cell = r.getCell(key)
            if (typeof cell.value === "number") {
              cell.numFmt = "#,##0"
            }
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
    },
  })
}
