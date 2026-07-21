import { useEffect, useState } from "react"

import { applyTags, DEFAULT_OPTIONS, type CaptureMode, type Meta, type Options } from "~lib/convert"
import { toBibTeX, toRIS } from "~lib/cite"
import { combineTabs, type TabCapture } from "~lib/batch"

import "./style.css"

const MODES: { id: CaptureMode; label: string; hint: string }[] = [
  { id: "reader", label: "Reader", hint: "Just the article, cleaned" },
  { id: "full", label: "Full page", hint: "Everything on the page" },
  { id: "selection", label: "Selection", hint: "Only highlighted text" }
]

function slug(s: string) {
  return (s || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page"
}

export default function Popup() {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [markdown, setMarkdown] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [title, setTitle] = useState("page")
  const [meta, setMeta] = useState<Meta | null>(null)
  const [tagsText, setTagsText] = useState("")
  const [batchStatus, setBatchStatus] = useState<string | null>(null)
  const [batching, setBatching] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // load saved options + tags once
  useEffect(() => {
    chrome.storage.sync.get(["options", "tags"]).then(({ options: saved, tags }) => {
      if (saved) setOptions((o) => ({ ...o, ...saved }))
      if (typeof tags === "string") setTagsText(tags)
      setHydrated(true)
    })
  }, [])

  // persist tags separately — they don't trigger a reconvert (see applyTags)
  useEffect(() => {
    if (hydrated) chrome.storage.sync.set({ tags: tagsText })
  }, [tagsText, hydrated])

  // run conversion whenever options change
  useEffect(() => {
    // Wait for stored options before the first convert, or every popup open does
    // the work twice: once with defaults, again once storage resolves.
    if (!hydrated) return
    let alive = true
    setLoading(true)
    setError(null)
    chrome.storage.sync.set({ options })
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) {
        // returning here used to leave the popup stuck on "Converting…" forever
        setLoading(false)
        setError("No active tab.")
        return
      }
      setTitle(slug(tab.title || "page"))
      chrome.tabs.sendMessage(tab.id, { type: "CONVERT", options }, (res) => {
        if (!alive) return
        setLoading(false)
        if (chrome.runtime.lastError || !res) {
          setError("Can't run on this page. Try a normal website tab (not chrome:// or the Web Store).")
          setMarkdown("")
        } else if (res.ok) {
          setMarkdown(res.markdown)
          setMeta(res.meta)
        } else {
          setError(res.error)
          setMarkdown("")
          setMeta(null)
        }
      })
    })
    return () => {
      alive = false
    }
  }, [options, hydrated])

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOptions((o) => ({ ...o, [k]: v }))

  const flash = (label: string) => {
    setCopied(label)
    setTimeout(() => setCopied(null), 1200)
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(label)
    } catch {
      setError("Copy blocked. Select the text below and copy manually.")
    }
  }

  // What actually gets shown/exported: the markdown with the user's tags folded
  // into the frontmatter. Recomputed locally on tag edits — no reconvert.
  const output = applyTags(markdown, tagsText)

  const downloadText = (text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    // revoking synchronously can cancel the download before it starts
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const download = () => downloadText(output, `${title}.md`)

  // Ask one tab's content script to convert. Resolves null on any failure
  // (chrome:// page, Web Store, no content script) so batch capture skips it.
  const convertTab = (tabId: number, opts: Options): Promise<{ markdown: string; meta: Meta } | null> =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "CONVERT", options: opts }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) resolve(null)
        else resolve({ markdown: res.markdown, meta: res.meta })
      })
    })

  // C1 — capture every tab in this window into one research doc. No new permission:
  // tab IDs come from tabs.query (no gating), and messaging works via the host access
  // the content script already holds. Body-only (frontmatter off) — combineTabs adds
  // a per-source header instead. Tags apply to the combined doc if set.
  const captureAllTabs = async (deliver: "copy" | "download") => {
    setBatching(true)
    setBatchStatus("Capturing all tabs…")
    setError(null)
    const tabs = await chrome.tabs.query({ currentWindow: true })
    const opts: Options = { ...options, frontmatter: false }
    const results = await Promise.all(tabs.map((t) => (t.id ? convertTab(t.id, opts) : Promise.resolve(null))))
    const caps = results.filter((r): r is TabCapture => !!r)
    const skipped = tabs.length - caps.length
    setBatching(false)
    if (!caps.length) {
      setBatchStatus(null)
      setError("No tabs could be captured. chrome:// and Web Store pages can't be read.")
      return
    }
    // combined doc uses per-source headings, not a frontmatter block, so tags
    // (which live in frontmatter) don't apply here by design.
    const doc = combineTabs(caps)
    if (deliver === "copy") await navigator.clipboard.writeText(doc).catch(() => {})
    else downloadText(doc, `sources-${new Date().toISOString().slice(0, 10)}.md`)
    setBatchStatus(`${caps.length} captured${skipped ? `, ${skipped} skipped` : ""}`)
    setTimeout(() => setBatchStatus(null), 3000)
  }

  const asPrompt = () =>
    copy(
      `Below is the content of a web page in Markdown. Read it, then help me with it.\n\n---\n\n${output}`,
      "prompt"
    )

  const canExport = !!markdown && !error

  return (
    <div className="w-[420px] bg-white text-gray-900 dark:bg-neutral-900 dark:text-neutral-100">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5" viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" rx="10" fill="#fb411f" />
            <path d="M7.5 30V12L13.25 21L19 12V30" fill="none" stroke="#fff" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M32.5 11V30" fill="none" stroke="#fff" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="27.8" cy="25.3" r="4.7" fill="none" stroke="#fff" strokeWidth="3.8" />
          </svg>
          <span className="font-semibold">Markdownr</span>
        </div>
        <span className="text-xs text-gray-400">Alt+M</span>
      </div>

      {/* mode tabs */}
      <div className="flex gap-1 px-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            aria-pressed={options.mode === m.id}
            onClick={() => set("mode", m.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm transition ${
              options.mode === m.id
                ? "bg-[#fb411f] text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            }`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* toggles */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-sm">
        <Toggle label="Images" v={options.images} on={(v) => set("images", v)} />
        <Toggle label="Links" v={options.links} on={(v) => set("links", v)} />
        <Toggle label="Frontmatter" v={options.frontmatter} on={(v) => set("frontmatter", v)} />
        <Toggle label="Absolute URLs" v={options.absoluteUrls} on={(v) => set("absoluteUrls", v)} />
      </div>

      {/* Obsidian tags — folded into the frontmatter, no reconvert */}
      <div className="px-4 pt-3">
        <input
          type="text"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          disabled={!options.frontmatter}
          placeholder={options.frontmatter ? "Tags: research, ai/transformers" : "Enable Frontmatter to add tags"}
          aria-label="Frontmatter tags, comma-separated"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#fb411f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        />
      </div>

      {/* preview */}
      <div className="px-4 pt-3">
        <textarea
          readOnly
          aria-label="Markdown preview"
          value={loading ? "Converting…" : error ? "" : output}
          placeholder={error ?? ""}
          className="h-56 w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs leading-relaxed text-gray-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        />
        {error ? (
          <p className="pt-1 text-xs text-red-500">{error}</p>
        ) : (
          canExport && (
            // ~chars/4 is the standard rough token estimate — enough to answer
            // "will this fit in the context window", which is the real question.
            <p className="pt-1 text-right text-xs text-gray-400 dark:text-neutral-500">
              {output.length.toLocaleString()} chars · ~{Math.ceil(output.length / 4).toLocaleString()} tokens
            </p>
          )
        )}
      </div>

      {/* actions */}
      <div className="grid grid-cols-3 gap-2 p-4">
        <Action disabled={!canExport} onClick={() => copy(output, "copy")} primary>
          {copied === "copy" ? "Copied ✓" : "Copy"}
        </Action>
        <Action disabled={!canExport} onClick={download}>
          Download
        </Action>
        <Action disabled={!canExport} onClick={asPrompt}>
          {copied === "prompt" ? "Copied ✓" : "As prompt"}
        </Action>
      </div>

      {/* citation row — the researcher's payoff: paste straight into a reference manager */}
      <div className="flex items-center gap-3 px-4 pb-4 text-xs text-gray-500 dark:text-neutral-400">
        <span>Cite:</span>
        <button
          type="button"
          disabled={!canExport || !meta}
          onClick={() => meta && copy(toBibTeX(meta), "bibtex")}
          className="underline underline-offset-2 hover:text-[#fb411f] disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline">
          {copied === "bibtex" ? "Copied ✓" : "BibTeX"}
        </button>
        <button
          type="button"
          disabled={!canExport || !meta}
          onClick={() => meta && copy(toRIS(meta), "ris")}
          className="underline underline-offset-2 hover:text-[#fb411f] disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline">
          {copied === "ris" ? "Copied ✓" : "RIS"}
        </button>
      </div>

      {/* multi-tab batch — capture the whole research session into one file */}
      <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-neutral-800 dark:text-neutral-400">
        <span>All tabs:</span>
        <button
          type="button"
          disabled={batching}
          onClick={() => captureAllTabs("copy")}
          className="underline underline-offset-2 hover:text-[#fb411f] disabled:cursor-not-allowed disabled:opacity-40">
          Copy
        </button>
        <button
          type="button"
          disabled={batching}
          onClick={() => captureAllTabs("download")}
          className="underline underline-offset-2 hover:text-[#fb411f] disabled:cursor-not-allowed disabled:opacity-40">
          Download
        </button>
        {batchStatus && <span className="text-gray-400 dark:text-neutral-500">{batchStatus}</span>}
      </div>
    </div>
  )
}

function Toggle({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 select-none">
      <input type="checkbox" checked={v} onChange={(e) => on(e.target.checked)} className="accent-[#fb411f]" />
      <span>{label}</span>
    </label>
  )
}

function Action({
  children,
  onClick,
  disabled,
  primary
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}) {
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
