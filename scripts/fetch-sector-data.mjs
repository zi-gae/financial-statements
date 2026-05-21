// 네이버 금융 SSL 인증서 체인 이슈 우회
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

import { mkdirSync } from "fs"
import { writeFile } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const BASE_URL = "http://finance.naver.com"
const DELAY_MS = 300

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchEucKr(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)

  const arrayBuffer = await res.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const iconv = await import("iconv-lite")
  return iconv.default.decode(buffer, "euc-kr")
}

async function fetchSectorList() {
  const html = await fetchEucKr(`${BASE_URL}/sise/sise_group.naver?type=upjong`)
  const matches = [...html.matchAll(/no=(\d+)[^>]*>([^<]+)<\/a>/g)]

  return matches
    .map((m) => ({ code: m[1], name: m[2].trim() }))
    .filter((s) => s.name && s.code)
}

async function fetchStocksInSector(sectorCode) {
  const html = await fetchEucKr(
    `${BASE_URL}/sise/sise_group_detail.naver?type=upjong&no=${sectorCode}`,
  )
  const matches = [...html.matchAll(/code=([A-Z0-9]{6})/g)]
  return [...new Set(matches.map((m) => m[1]))]
}

async function main() {
  const sectors = await fetchSectorList()
  console.log(`업종 수: ${sectors.length}개`)

  const stockToSector = {}
  const sectorNames = {}

  for (const sector of sectors) {
    sectorNames[sector.code] = sector.name
    try {
      const stocks = await fetchStocksInSector(sector.code)
      for (const stockCode of stocks) {
        stockToSector[stockCode] = { code: sector.code, name: sector.name }
      }
      console.log(`[${sector.code}] ${sector.name}: ${stocks.length}개 종목`)
    } catch (e) {
      console.error(`[${sector.code}] ${sector.name} 실패: ${e.message}`)
    }
    await delay(DELAY_MS)
  }

  const output = {
    updatedAt: new Date().toISOString(),
    sectorCount: sectors.length,
    stockCount: Object.keys(stockToSector).length,
    data: stockToSector,
  }

  const outDir = join(ROOT, "public", "data")
  mkdirSync(outDir, { recursive: true })

  await writeFile(join(outDir, "sector.json"), JSON.stringify(output))
  console.log(`\n완료: ${Object.keys(stockToSector).length}개 종목 업종 매핑 저장`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
