import { mkdirSync } from "fs"
import { writeFile } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
// git root의 scripts/ 폴더에서 실행되므로, Next.js public은 ../app/public
const ROOT = join(__dirname, "..", "app")

const DART_BASE_URL = "https://opendart.fss.or.kr/api"

const API_KEYS = [
  process.env.DART_API_KEY1,
  process.env.DART_API_KEY2,
].filter(Boolean)

if (API_KEYS.length === 0) throw new Error("DART_API_KEY1 환경변수가 필요합니다")

let keyIndex = 0
const getKey = () => API_KEYS[keyIndex++ % API_KEYS.length]

const QUARTER_REPORT_MAP = {
  Q1: "11013",
  Q2: "11012",
  Q3: "11014",
  Q4: "11011",
}

function getRecentQuarters() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentQuarter = Math.ceil(month / 3)

  const quarters = []
  let q = currentQuarter - 1
  let y = year

  for (let i = 0; i < 4; i++) {
    if (q <= 0) {
      q = 4
      y--
    }
    quarters.push({ year: y, quarter: `Q${q}` })
    q--
  }

  return quarters.reverse()
}

async function fetchCompanyList(retries = 3) {
  const url = `${DART_BASE_URL}/corpCode.xml?crtfc_key=${getKey()}`
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (!res.ok) throw new Error(`기업 목록 조회 실패: ${res.status}`)

      const arrayBuffer = await res.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // ZIP 파일 시그니처 확인 (PK\x03\x04)
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
        const preview = buffer.slice(0, 200).toString("utf-8").replace(/\n/g, " ")
        throw new Error(`ZIP 형식이 아닌 응답 수신 (hex: ${buffer.slice(0, 4).toString("hex")}, 내용: ${preview})`)
      }

      const AdmZip = (await import("adm-zip")).default
      const zip = new AdmZip(buffer)
      const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith(".xml"))
      if (!xmlEntry) throw new Error("XML 파일을 찾을 수 없습니다")

      const xml = xmlEntry.getData().toString("utf-8")
      const companies = []
      const regex =
        /<list>[\s\S]*?<corp_code>(.*?)<\/corp_code>[\s\S]*?<corp_name>(.*?)<\/corp_name>[\s\S]*?<stock_code>(.*?)<\/stock_code>[\s\S]*?<\/list>/g

      let match
      while ((match = regex.exec(xml)) !== null) {
        const stock_code = match[3].trim()
        if (stock_code) {
          companies.push({
            corp_code: match[1].trim(),
            corp_name: match[2].trim(),
            stock_code,
          })
        }
      }

      return companies
    } catch (e) {
      console.error(`[기업목록] 시도 ${attempt}/${retries} 실패: ${e.message}`)
      if (attempt === retries) throw e
      await delay(5000 * attempt)
    }
  }
}

async function fetchFinancialStatement(corpCode, year, reprtCode, fsDiv) {
  const params = new URLSearchParams({
    crtfc_key: getKey(),
    corp_code: corpCode,
    bsns_year: String(year),
    reprt_code: reprtCode,
    fs_div: fsDiv,
  })

  const url = `${DART_BASE_URL}/fnlttSinglAcntAll.json?${params}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { revenue: null, operating_profit: null, net_income: null, status: "조회실패" }

    const data = await res.json()
    if (data.status !== "000" || !data.list?.length) {
      return { revenue: null, operating_profit: null, net_income: null, status: "데이터없음" }
    }

    const list = data.list
    const find = (names) => {
      const item = list.find((r) => names.includes(r.account_nm?.trim()))
      return item?.thstrm_amount?.replace(/,/g, "") ?? null
    }

    const revenue = find(["매출액", "수익(매출액)", "영업수익"])
    const operating_profit = find(["영업이익", "영업이익(손실)"])
    const net_income = find(["당기순이익", "당기순이익(손실)"])

    const status =
      revenue === null && operating_profit === null && net_income === null ? "항목불일치" : "정상"

    return { revenue, operating_profit, net_income, status }
  } catch {
    return { revenue: null, operating_profit: null, net_income: null, status: "조회실패" }
  }
}

async function fetchAndSave(year, quarter, fsDiv) {
  const reprtCode = QUARTER_REPORT_MAP[quarter]
  const label = `${year}_${quarter}_${fsDiv}`

  console.log(`\n[${label}] 처리 시작`)

  const companies = await fetchCompanyList()
  console.log(`[${label}] 기업 수: ${companies.length}`)

  const results = []
  let done = 0
  let failed = 0

  const delay = (ms) => new Promise((r) => setTimeout(r, ms))
  const CONCURRENCY = 5

  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY)

    await Promise.all(
      batch.map(async (company) => {
        await delay(100)

        let fin
        for (let retry = 0; retry <= 2; retry++) {
          fin = await fetchFinancialStatement(company.corp_code, year, reprtCode, fsDiv)
          if (fin.status !== "조회실패" || retry === 2) break
          await delay(1000 * (retry + 1))
        }

        if (fin.status === "조회실패") failed++
        done++

        results.push({
          corp_name: company.corp_name,
          stock_code: company.stock_code,
          ...fin,
        })
      }),
    )

    if (done % 500 === 0 || done === companies.length) {
      console.log(`[${label}] ${done}/${companies.length} 처리 중...`)
    }
  }

  const output = {
    year: String(year),
    quarter,
    fsDiv,
    updatedAt: new Date().toISOString(),
    total: companies.length,
    failed,
    data: results,
  }

  const outDir = join(ROOT, "public", "data")
  mkdirSync(outDir, { recursive: true })

  const filePath = join(outDir, `${label}.json`)
  await writeFile(filePath, JSON.stringify(output))

  console.log(`[${label}] 완료 - ${done}개 처리, ${failed}개 실패`)
}

async function main() {
  console.log(`API 키 ${API_KEYS.length}개 로드됨`)

  const targetYear = process.env.TARGET_YEAR
  const targetQuarter = process.env.TARGET_QUARTER
  const targetFsDiv = process.env.TARGET_FS_DIV

  if (targetYear && targetQuarter && targetFsDiv) {
    await fetchAndSave(Number(targetYear), targetQuarter, targetFsDiv)
  } else {
    const quarters = getRecentQuarters()
    console.log(
      "처리할 분기:",
      quarters.map((q) => `${q.year}_${q.quarter}`).join(", "),
    )
    for (const { year, quarter } of quarters) {
      for (const fsDiv of ["CFS", "OFS"]) {
        await fetchAndSave(year, quarter, fsDiv)
      }
    }
  }

  console.log("\n모든 데이터 수집 완료!")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
