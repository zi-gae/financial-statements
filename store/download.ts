import { create } from "zustand"

export type DownloadStatus = "idle" | "running" | "done" | "cancelled" | "error"

interface DownloadState {
  status: DownloadStatus
  total: number
  done: number
  failed: number
  currentCompany: string
  errorMessage: string | null
  setStatus: (status: DownloadStatus) => void
  setProgress: (done: number, total: number, failed: number, currentCompany: string) => void
  setError: (msg: string) => void
  reset: () => void
}

export const useDownloadStore = create<DownloadState>((set) => ({
  status: "idle",
  total: 0,
  done: 0,
  failed: 0,
  currentCompany: "",
  errorMessage: null,
  setStatus: (status) => set({ status }),
  setProgress: (done, total, failed, currentCompany) =>
    set({ done, total, failed, currentCompany }),
  setError: (msg) => set({ status: "error", errorMessage: msg }),
  reset: () =>
    set({
      status: "idle",
      total: 0,
      done: 0,
      failed: 0,
      currentCompany: "",
      errorMessage: null,
    }),
}))
