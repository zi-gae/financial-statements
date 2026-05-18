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
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const send = (data: object) => {
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // SSE 스트림으로 진행률 전송 후 엑셀을 별도 응답으로 보내는 대신,
  // 여기선 엑셀을 직접 스트리밍한다.
  // 진행률은 /api/download/progress SSE를 별도로 구성하는 방식도 있으나,
  // 단순화를 위해 여기선 완료 후 파일을 내려받는 방식으로 구현한다.

  const processDownload = async () => {
    try {
      send({ type: "status", message: "기업 목록 조회 중..." })

      const companies = await fetchCompanyList()
      const total = companies.length

      send({ type: "progress", done: 0, total, failed: 0, current: "" })

      const limit = pLimit(8)
      const results: FinancialData[] = []
      let done = 0
      let failed = 0

      await Promise.all(
        companies.map((company) =>
          limit(async () => {
            const fin = await fetchFinancialStatement(
              company.corp_code,
              year,
              reprtCode,
              fsDiv,
            )

            if (fin.status === "조회실패") failed++
            done++

            results.push({
              corp_name: company.corp_name,
              stock_code: company.stock_code,
              ...fin,
            })

            if (done % 10 === 0 || done === total) {
              send({
                type: "progress",
                done,
                total,
                failed,
                current: company.corp_name,
              })
            }
          }),
        ),
      )

      send({ type: "status", message: "엑셀 생성 중..." })

      const quarterLabel = { Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기" }[quarter] ?? quarter
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

      // 헤더 스타일
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
          operating_profit: row.operating_profit != null ? Number(row.operating_profit) : "",
          net_income: row.net_income != null ? Number(row.net_income) : "",
          status: row.status,
        })
      }

      // 숫자 컬럼 포맷
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
      const filename = `상장사_분기실적_${year}_${quarterLabel}_${fsDivLabel}.xlsx`

      send({ type: "done", filename, failed, total })
      await writer.close()

      return { buffer, filename }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "알 수 없는 오류"
      send({ type: "error", message: msg })
      await writer.close()
      throw e
    }
  }

  // SSE가 아닌 직접 파일 다운로드 방식으로 처리
  try {
    const companies = await fetchCompanyList()
    const total = companies.length
    const limit = pLimit(8)
    const results: FinancialData[] = []
    let failed = 0

    await Promise.all(
      companies.map((company) =>
        limit(async () => {
          const fin = await fetchFinancialStatement(
            company.corp_code,
            year,
            reprtCode,
            fsDiv,
          )
          if (fin.status === "조회실패") failed++
          results.push({
            corp_name: company.corp_name,
            stock_code: company.stock_code,
            ...fin,
          })
        }),
      ),
    )

    const quarterLabel = { Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기" }[quarter] ?? quarter
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
        operating_profit: row.operating_profit != null ? Number(row.operating_profit) : "",
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
    const filename = `상장사_분기실적_${year}_${quarterLabel}_${fsDivLabel}.xlsx`

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Total-Companies": String(total),
        "X-Failed-Companies": String(failed),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "다운로드 처리 중 오류 발생"
    return new Response(msg, { status: 500 })
  }

  void processDownload
}
