const DART_API_KEY = process.env.DART_API_KEY!
const DART_BASE_URL = "https://opendart.fss.or.kr/api"

export const QUARTER_REPORT_MAP: Record<string, string> = {
  Q1: "11013",
  Q2: "11012",
  Q3: "11014",
  Q4: "11011",
}

export const FS_DIV_MAP: Record<string, string> = {
  CFS: "CFS",
  OFS: "OFS",
}

export interface Company {
  corp_code: string
  corp_name: string
  stock_code: string
}

export interface FinancialData {
  corp_name: string
  stock_code: string
  revenue: string | null
  operating_profit: string | null
  net_income: string | null
  status: "정상" | "데이터없음" | "항목불일치" | "조회실패"
}

export async function fetchCompanyList(): Promise<Company[]> {
  const url = `${DART_BASE_URL}/corpCode.xml?crtfc_key=${DART_API_KEY}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`기업 목록 조회 실패: ${res.status}`)

  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // ZIP 파일 파싱 (DART는 XML을 ZIP으로 제공)
  const AdmZip = (await import("adm-zip")).default
  const zip = new AdmZip(buffer)
  const xmlEntry = zip.getEntries().find((e) => e.entryName.endsWith(".xml"))
  if (!xmlEntry) throw new Error("XML 파일을 찾을 수 없습니다")

  const xml = xmlEntry.getData().toString("utf-8")

  // 간단한 XML 파싱 (stock_code 있는 기업만)
  const companies: Company[] = []
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
}

export async function fetchFinancialStatement(
  corpCode: string,
  year: string,
  reprtCode: string,
  fsDiv: string,
): Promise<{ revenue: string | null; operating_profit: string | null; net_income: string | null; status: FinancialData["status"] }> {
  const params = new URLSearchParams({
    crtfc_key: DART_API_KEY,
    corp_code: corpCode,
    bsns_year: year,
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

    const list: Array<{ account_nm: string; thstrm_amount: string }> = data.list

    const find = (names: string[]) => {
      const item = list.find((r) => names.includes(r.account_nm?.trim()))
      return item?.thstrm_amount?.replace(/,/g, "") ?? null
    }

    const revenue = find(["매출액", "수익(매출액)", "영업수익"])
    const operating_profit = find(["영업이익", "영업이익(손실)"])
    const net_income = find(["당기순이익", "당기순이익(손실)"])

    const status =
      revenue === null && operating_profit === null && net_income === null
        ? "항목불일치"
        : "정상"

    return { revenue, operating_profit, net_income, status }
  } catch {
    return { revenue: null, operating_profit: null, net_income: null, status: "조회실패" }
  }
}
