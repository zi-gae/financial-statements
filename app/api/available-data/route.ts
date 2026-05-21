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

  const entries = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const [year, quarter, fsDiv] = f.replace(".json", "").split("_")
      return { year, quarter, fsDiv }
    })
    .filter((e) => e.year && e.quarter && e.fsDiv)
    .sort((a, b) => {
      if (a.year !== b.year) return b.year.localeCompare(a.year)
      return b.quarter.localeCompare(a.quarter)
    })

  return Response.json(entries)
}
