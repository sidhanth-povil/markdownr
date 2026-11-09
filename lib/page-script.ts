// Injected into a tab only when the user asks for a capture (see lib/page.ts). It adds
// no listener and has no presence on pages the user doesn't convert. It lives under
// lib/ on purpose: a root content.ts would make Plasmo register an always-on content script.
import { DEFAULT_OPTIONS, extractFromDom, htmlToMarkdown, type Options } from "./convert"
import { finishMarkdown } from "./frontmatter"
import type { ConvertResult, PageApi, QuickCopyResult } from "./page"

function convert(options: Options): ConvertResult {
  // Chrome's PDF viewer has no page HTML to read, so say what to do instead.
  if (document.contentType === "application/pdf") {
    return { ok: false, isPdf: true, error: "This tab is a PDF. Save it, then open it in the PDF converter." }
  }
  try {
    const res = extractFromDom(options)
    if ("error" in res) return { ok: false, error: res.error }
    // meta flows back so the popup can build a citation without re-extracting
    return { ok: true, markdown: htmlToMarkdown(res.html, options, res.meta), meta: res.meta }
  } catch {
    // Distinct from "Can't run on this page": we ran, and this page broke the converter.
    return { ok: false, error: "Couldn't convert this page. Try Full page mode." }
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // execCommand fallback for pages where the async API is blocked
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.cssText = "position:fixed;opacity:0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  }
}

async function quickCopy(hasSelection: boolean): Promise<QuickCopyResult> {
  try {
    const { options, tags, template } = await chrome.storage.sync.get(["options", "tags", "template"])
    const merged: Options = { ...DEFAULT_OPTIONS, ...(options ?? {}) }
    // Right-clicking a selection means "convert this", whatever the saved mode says.
    const res = convert(hasSelection ? { ...merged, mode: "selection" } : merged)
    if (res.ok === false) return { ok: false, error: res.error }
    const copied = await copyToClipboard(finishMarkdown(res.markdown, tags ?? "", template ?? "", res.meta))
    return copied ? { ok: true } : { ok: false, error: "Clipboard blocked on this page." }
  } catch {
    return { ok: false, error: "Conversion failed." }
  }
}

const api: PageApi = { convert, quickCopy }
;(globalThis as unknown as { __markdownr: PageApi }).__markdownr = api
