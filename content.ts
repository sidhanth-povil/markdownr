import type { PlasmoCSConfig } from "plasmo"

import { DEFAULT_OPTIONS, extractFromDom, htmlToMarkdown, type Meta, type Options } from "~lib/convert"

// ponytail: broad match = host permission. Narrow to activeTab-injection in v2 if store review pushes back.
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
  run_at: "document_idle"
}

function convert(options: Options): { ok: true; markdown: string; meta: Meta } | { ok: false; error: string } {
  const res = extractFromDom(options)
  if ("error" in res) return { ok: false, error: res.error }
  // meta flows back so the popup can build a citation without re-extracting
  return { ok: true, markdown: htmlToMarkdown(res.html, options, res.meta), meta: res.meta }
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Defense in depth: without externally_connectable a page can't reach this
  // listener anyway, but that's a manifest fact we shouldn't depend on staying true.
  if (sender.id !== chrome.runtime.id) return

  if (msg?.type === "CONVERT") {
    sendResponse(convert(msg.options as Options))
    return // sync response
  }
  if (msg?.type === "QUICK_COPY") {
    chrome.storage.sync
      .get("options")
      .then(async ({ options }) => {
        const merged = { ...DEFAULT_OPTIONS, ...(options ?? {}) }
        const res = convert(msg.hasSelection ? { ...merged, mode: "selection" } : merged)
        if (!res.ok) return sendResponse(res)
        const copied = await copyToClipboard(res.markdown)
        sendResponse(copied ? { ok: true } : { ok: false, error: "Clipboard blocked on this page." })
      })
      // always answer: a dropped response shows the generic "Can't run on this page."
      .catch(() => sendResponse({ ok: false, error: "Conversion failed." }))
    return true // async response
  }
})
