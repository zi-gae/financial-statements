import { readdir } from "fs/promises"
import path from "path"

export const dynamic = "force-dynamic"

export async function GET() {
  const dataDir = path.join(process.cwd(), "public", "data")

  let files: string[]
  try {
    files = await readdir(dataDir)
  } catch {
    return Response.json([])
  }

  const fileSet = new Set(files.filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")))

  const entries = [...fileSet]
    .map((name) => {
      const [year, quarter, fsDiv] = name.split("_")
      return { year, quarter, fsDiv }
    })
    .filter((e) => e.year && e.quarter && e.fsDiv && e.quarter.startsWith("Q"))
    .map((e) => {
      const prevYear = String(parseInt(e.year) - 1)
      return { ...e, hasYoY: fileSet.has(`${prevYear}_${e.quarter}_${e.fsDiv}`) }
    })
    .sort((a, b) => {
      if (a.year !== b.year) return b.year.localeCompare(a.year)
      return b.quarter.localeCompare(a.quarter)
    })

  return Response.json(entries)
}
