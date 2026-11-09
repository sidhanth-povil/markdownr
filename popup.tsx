import { useEffect, useState } from "react"

import { combineTabs, type TabCapture } from "~lib/batch"
import { toBibliography, toBibTeX, toRIS } from "~lib/cite"
import { DEFAULT_OPTIONS, type CaptureMode, type Options } from "~lib/convert"
import { finishMarkdown, vaultFilename, type Meta } from "~lib/frontmatter"
import { convertInTab } from "~lib/page"
import { Action, asPrompt, downloadText, TextAction, Toggle, useCopy } from "~lib/ui"

import "./style.css"

const MODES: { id: CaptureMode; label: string; hint: string }[] = [
  { id: "reader", label: "Reader", hint: "Just the article, cleaned" },
  { id: "full", label: "Full page", hint: "Everything on the page" },
  { id: "selection", label: "Selection", hint: "Only highlighted text" }
]

const ALL_SITES = "<all_urls>"
const OPEN_COMMAND = "_execute_action"
const STATUS_CLEAR_MS = 3000
const MAX_SKIPPED_NAMES = 3
const MAX_TEMPLATE_CHARS = 2000
const TEMPLATE_PLACEHOLDER = "status: to-read\nsource: {{domain}}"

type BatchDelivery = "copy" | "download" | "bib"

const openPdfConverter = () => chrome.tabs.create({ url: chrome.runtime.getURL("tabs/pdf.html") })
const openShortcutSettings = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })

function skippedSummary(names: string[]): string {
  if (!names.length) return ""
  const shown = names.slice(0, MAX_SKIPPED_NAMES).join(", ")
  const more = names.length > MAX_SKIPPED_NAMES ? ` +${names.length - MAX_SKIPPED_NAMES} more` : ""
  return `, ${names.length} skipped: ${shown}${more}`
}

export default function Popup() {
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [markdown, setMarkdown] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPdfTab, setIsPdfTab] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tabTitle, setTabTitle] = useState("page")
  const [meta, setMeta] = useState<Meta | null>(null)
  const [tagsText, setTagsText] = useState("")
  const [template, setTemplate] = useState("")
  const [batchStatus, setBatchStatus] = useState<string | null>(null)
  const [batching, setBatching] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [shortcut, setShortcut] = useState("")
  const { copied, copy } = useCopy(setError)

  // Blank when Chrome couldn't register it, e.g. another extension already holds the
  // keys, so the hint must come from Chrome rather than from what the manifest suggests.
  useEffect(() => {
    chrome.commands.getAll().then((commands) => setShortcut(commands.find((c) => c.name === OPEN_COMMAND)?.shortcut ?? ""))
  }, [])

  // load saved settings once
  useEffect(() => {
    chrome.storage.sync.get(["options", "tags", "template"]).then(({ options: saved, tags, template: savedTemplate }) => {
      if (saved) setOptions((o) => ({ ...o, ...saved }))
      if (typeof tags === "string") setTagsText(tags)
      if (typeof savedTemplate === "string") setTemplate(savedTemplate)
      setHydrated(true)
    })
  }, [])

  // persist these separately — they don't trigger a reconvert (see finishMarkdown)
  useEffect(() => {
    if (hydrated) chrome.storage.sync.set({ tags: tagsText, template })
  }, [tagsText, template, hydrated])

  // run conversion whenever options change
  useEffect(() => {
    // Wait for stored options before the first convert, or every popup open does
    // the work twice: once with defaults, again once storage resolves.
    if (!hydrated) return
    let alive = true
    setLoading(true)
    setError(null)
    setIsPdfTab(false)
    chrome.storage.sync.set({ options })
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) {
        if (!alive) return
        // returning here used to leave the popup stuck on "Converting…" forever
        setLoading(false)
        setError("No active tab.")
        return
      }
      setTabTitle(tab.title || "page")
      const res = await convertInTab(tab.id, options)
      if (!alive) return
      setLoading(false)
      if (!res) {
        setError("Can't run on this page. Try a normal website tab (not chrome:// or the Web Store).")
        setMarkdown("")
      } else if (res.ok === true) {
        setMarkdown(res.markdown)
        setMeta(res.meta)
      } else {
        setError(res.error)
        setIsPdfTab(!!res.isPdf)
        setMarkdown("")
        setMeta(null)
      }
    })
    return () => {
      alive = false
    }
  }, [options, hydrated])

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOptions((o) => ({ ...o, [k]: v }))

  // What actually gets shown/exported: the markdown with the user's tags and fields
  // folded into the frontmatter. Recomputed locally on edits — no reconvert.
  const output = meta ? finishMarkdown(markdown, tagsText, template, meta) : markdown

  const deliverBatch = async (caps: TabCapture[], delivery: BatchDelivery): Promise<boolean> => {
    const date = new Date().toISOString().slice(0, 10)
    if (delivery === "bib") {
      downloadText(toBibliography(caps.map((c) => c.meta)), `sources-${date}.bib`, "application/x-bibtex")
      return true
    }
    const doc = finishMarkdown(combineTabs(caps, { frontmatter: options.frontmatter }), tagsText, template, {
      title: "Captured sources",
      url: ""
    })
    if (delivery === "copy") return copy(doc, "batch")
    downloadText(doc, `sources-${date}.md`)
    return true
  }

  // Capture every tab in this window into one research doc. Site access is requested
  // here, on the click, because Chrome only allows that during a user gesture.
  const captureAllTabs = async (delivery: BatchDelivery) => {
    // Problems here go in the status line. setError would blank this tab's preview.
    setBatchStatus(null)
    const granted = await chrome.permissions.request({ origins: [ALL_SITES] }).catch(() => false)
    if (!granted) {
      setBatchStatus("All tabs needs access to your open sites. Nothing was captured.")
      return
    }
    setBatching(true)
    setBatchStatus("Capturing all tabs…")
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true })
      // Body-only (frontmatter off): combineTabs adds per-source details instead.
      const results = await Promise.all(tabs.map((t) => (t.id ? convertInTab(t.id, { ...options, frontmatter: false }) : null)))
      const caps = results.flatMap((r): TabCapture[] => (r?.ok === true ? [{ markdown: r.markdown, meta: r.meta }] : []))
      if (!caps.length) {
        setBatchStatus("No tabs could be captured. chrome:// and Web Store pages can't be read.")
        return
      }
      if (!(await deliverBatch(caps, delivery))) {
        setBatchStatus(null)
        return
      }
      const skipped = tabs.filter((_, i) => !results[i]?.ok).map((t) => t.title || t.url || "browser page")
      setBatchStatus(`${caps.length} captured${skippedSummary(skipped)}`)
      // Names of skipped tabs stay up: they're what the user has to go and fix.
      if (!skipped.length) setTimeout(() => setBatchStatus(null), STATUS_CLEAR_MS)
    } catch {
      setBatchStatus("Capture failed. Try again.")
    } finally {
      setBatching(false)
    }
  }

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
        <span className="text-xs text-gray-400">
          {shortcut || <TextAction onClick={openShortcutSettings}>Set shortcut</TextAction>}
        </span>
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
        <details className="pt-2 text-xs text-gray-500 dark:text-neutral-400">
          <summary className="cursor-pointer select-none">Custom frontmatter fields</summary>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            disabled={!options.frontmatter}
            maxLength={MAX_TEMPLATE_CHARS}
            rows={3}
            placeholder={TEMPLATE_PLACEHOLDER}
            aria-label="Custom frontmatter fields, one key and value per line"
            className="mt-1 w-full resize-y rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-800 outline-none placeholder:text-gray-400 focus:border-[#fb411f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          />
          <p>
            One <code>key: value</code> per line. Fill-ins: {"{{title}} {{url}} {{domain}} {{author}} {{date}} {{doi}} {{journal}} {{captured}}"}
          </p>
        </details>
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
          <p className="pt-1 text-xs text-red-500">
            {error}{" "}
            {isPdfTab && <TextAction onClick={openPdfConverter}>Open PDF converter</TextAction>}
          </p>
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
        <Action disabled={!canExport} onClick={() => downloadText(output, `${vaultFilename(meta?.title || tabTitle)}.md`)}>
          Download
        </Action>
        <Action disabled={!canExport} onClick={() => copy(asPrompt(output), "prompt")}>
          {copied === "prompt" ? "Copied ✓" : "As prompt"}
        </Action>
      </div>

      {/* citation row — the researcher's payoff: paste straight into a reference manager */}
      <div className="flex items-center gap-3 px-4 pb-4 text-xs text-gray-500 dark:text-neutral-400">
        <span>Cite:</span>
        <TextAction disabled={!canExport || !meta} onClick={() => meta && copy(toBibTeX(meta), "bibtex")}>
          {copied === "bibtex" ? "Copied ✓" : "BibTeX"}
        </TextAction>
        <TextAction disabled={!canExport || !meta} onClick={() => meta && copy(toRIS(meta), "ris")}>
          {copied === "ris" ? "Copied ✓" : "RIS"}
        </TextAction>
        <span className="ml-auto">
          <TextAction onClick={openPdfConverter}>Convert a PDF</TextAction>
        </span>
      </div>

      {/* multi-tab batch — capture the whole research session into one file */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-neutral-800 dark:text-neutral-400">
        <span>All tabs:</span>
        <TextAction disabled={batching} onClick={() => captureAllTabs("copy")}>
          {copied === "batch" ? "Copied ✓" : "Copy"}
        </TextAction>
        <TextAction disabled={batching} onClick={() => captureAllTabs("download")}>
          Download
        </TextAction>
        <TextAction disabled={batching} onClick={() => captureAllTabs("bib")}>
          .bib
        </TextAction>
        {batchStatus && <span className="basis-full text-gray-400 dark:text-neutral-500">{batchStatus}</span>}
      </div>
    </div>
  )
}
