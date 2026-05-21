"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useDownloadStore } from "@/store/download"

const QUARTER_LABELS: Record<string, string> = {
  Q1: "1분기", Q2: "2분기", Q3: "3분기", Q4: "4분기",
}
const FS_DIVS = [
  { label: "연결재무제표", value: "CFS" },
  { label: "별도재무제표", value: "OFS" },
]

interface AvailableEntry { year: string; quarter: string; fsDiv: string }

export default function DownloadPanel() {
  const [available, setAvailable] = useState<AvailableEntry[]>([])
  const [year, setYear] = useState("")
  const [quarter, setQuarter] = useState("")
  const [fsDiv, setFsDiv] = useState("CFS")

  useEffect(() => {
    fetch("/api/available-data")
      .then((r) => r.json())
      .then((data: AvailableEntry[]) => {
        setAvailable(data)
        if (data.length > 0) {
          const first = data[0]
          setYear(first.year)
          setQuarter(first.quarter)
          setFsDiv(first.fsDiv)
        }
      })
  }, [])

  const years = [...new Set(available.map((e) => e.year))]
  const quarters = [...new Set(available.filter((e) => e.year === year).map((e) => e.quarter))]

  const { status, total, done, failed, currentCompany, errorMessage, setProgress, setStatus, setError, reset } =
    useDownloadStore()

  const abortRef = useRef<(() => void) | null>(null)

  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0

  const handleStart = () => {
    reset()
    setStatus("running")

    const params = new URLSearchParams({ year, quarter, fsDiv })
    const es = new EventSource(`/api/download/progress?${params}`)

    abortRef.current = () => es.close()

    es.onmessage = (e) => {
      const data = JSON.parse(e.data)

      if (data.type === "progress") {
        setProgress(data.done, data.total, data.failed, data.current ?? "")
      } else if (data.type === "status") {
        // 상태 메시지만 (엑셀 생성 중 등)
      } else if (data.type === "done") {
        setStatus("done")
        es.close()
        // base64 → Blob → 다운로드
        const binary = atob(data.base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = data.filename
        a.click()
        URL.revokeObjectURL(url)
      } else if (data.type === "error") {
        setError(data.message)
        es.close()
      }
    }

    es.onerror = () => {
      if (status !== "done") {
        setError("서버 연결이 끊어졌습니다.")
      }
      es.close()
    }
  }

  const handleCancel = () => {
    abortRef.current?.()
    setStatus("cancelled")
  }

  const quarterLabel = QUARTER_LABELS[quarter] ?? quarter
  const fsDivLabel = FS_DIVS.find((f) => f.value === fsDiv)?.label ?? fsDiv

  return (
    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-8">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">상장사 분기 실적 다운로드</h1>
        <p className="mt-1 text-sm text-gray-500">
          기업명 · 매출액 · 영업이익 · 당기순이익 기준
        </p>
      </div>

      {/* 선택 폼 */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">연도</label>
          <Select value={year} onValueChange={(v) => { if (!v) return; setYear(v); const entry = available.find((e) => e.year === v); if (entry) setQuarter(entry.quarter) }} disabled={status === "running"}>
            <SelectTrigger className="w-28">
              <SelectValue>{year ? `${year}년` : "선택"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>{y}년</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">분기</label>
          <Select value={quarter} onValueChange={(v) => v && setQuarter(v)} disabled={status === "running"}>
            <SelectTrigger className="w-28">
              <SelectValue>{QUARTER_LABELS[quarter] ?? "선택"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {quarters.map((q) => (
                <SelectItem key={q} value={q}>{QUARTER_LABELS[q]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">재무구분</label>
          <Select value={fsDiv} onValueChange={(v) => v && setFsDiv(v)} disabled={status === "running"}>
            <SelectTrigger className="w-40">
              <SelectValue>{FS_DIVS.find((f) => f.value === fsDiv)?.label ?? fsDiv}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FS_DIVS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex gap-3">
        {status !== "running" ? (
          <Button onClick={handleStart} className="w-full" size="lg">
            {status === "idle" ? "다운로드 시작" : "다시 다운로드"}
          </Button>
        ) : (
          <Button onClick={handleCancel} variant="outline" className="w-full" size="lg">
            취소
          </Button>
        )}
      </div>

      {/* 진행 상태 */}
      {status !== "idle" && (
        <div className="border border-gray-100 rounded-xl p-5 space-y-4 bg-gray-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">진행 상태</span>
            <StatusBadge status={status} />
          </div>

          {status === "running" && (
            <>
              <Progress value={progressPercent} className="h-2" />
              <div className="flex justify-between text-xs text-gray-500">
                <span>{progressPercent}% 완료</span>
                <span>{done.toLocaleString()} / {total.toLocaleString()}개사</span>
              </div>
              {currentCompany && (
                <p className="text-xs text-gray-500">처리 중: {currentCompany}</p>
              )}
              {failed > 0 && (
                <p className="text-xs text-red-500">실패: {failed.toLocaleString()}개사</p>
              )}
            </>
          )}

          {status === "done" && (
            <div className="text-sm text-gray-600 space-y-1">
              <p>✓ 전체 {total.toLocaleString()}개사 처리 완료</p>
              {failed > 0 && <p className="text-red-500">- 조회 실패: {failed.toLocaleString()}개사</p>}
              <p className="text-gray-400 text-xs mt-2">
                파일명: 상장사_분기실적_{year}_{quarterLabel}_{fsDivLabel === "연결재무제표" ? "연결" : "별도"}.xlsx
              </p>
            </div>
          )}

          {status === "cancelled" && (
            <p className="text-sm text-gray-500">다운로드가 취소되었습니다.</p>
          )}

          {status === "error" && (
            <p className="text-sm text-red-600">{errorMessage}</p>
          )}
        </div>
      )}

      {/* 안내 */}
      <div className="text-xs text-gray-400 space-y-1 border-t pt-4">
        <p>• Open DART API를 서버에서 직접 호출합니다.</p>
        <p>• 상장사 전체 조회 시 수 분 이상 소요될 수 있습니다.</p>
        <p>• 다운로드 중 탭을 닫으면 작업이 중단됩니다.</p>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    running: { label: "처리 중", variant: "default" },
    done: { label: "완료", variant: "secondary" },
    cancelled: { label: "취소됨", variant: "outline" },
    error: { label: "오류", variant: "destructive" },
  }
  const cfg = map[status]
  if (!cfg) return null
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}
