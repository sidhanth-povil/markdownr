// Shared by the popup and the PDF page.
import { useState, type ReactNode } from "react"

const COPIED_FLASH_MS = 1200
const BLOB_REVOKE_DELAY_MS = 10_000

export const asPrompt = (markdown: string): string =>
  `Below is the content of a document in Markdown. Read it, then help me with it.\n\n---\n\n${markdown}`

export function downloadText(text: string, filename: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  // revoking synchronously can cancel the download before it starts
  setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY_MS)
}

export function useCopy(onBlocked: (message: string) => void) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (text: string, label: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), COPIED_FLASH_MS)
      return true
    } catch {
      onBlocked("Copy blocked. Use Download, or select the text and copy manually.")
      return false
    }
  }
  return { copied, copy }
}

export function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 select-none">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="accent-[#fb411f]" />
      <span>{label}</span>
    </label>
  )
}

interface ActionProps {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}

export function Action({ children, onClick, disabled, primary }: ActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-[#fb411f] text-white hover:bg-[#e23c1c]"
          : "bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
      }`}>
      {children}
    </button>
  )
}

export function TextAction({ children, onClick, disabled }: Omit<ActionProps, "primary">) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="underline underline-offset-2 hover:text-[#fb411f] disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline">
      {children}
    </button>
  )
}
