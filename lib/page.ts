// Runs the converter inside a tab on demand. activeTab covers the tab the user clicked
// on, including tabs that were open before the extension was installed. "All tabs"
// asks for the optional site access first.
import pageScriptUrl from "url:./page-script"

import type { Options } from "./convert"
import type { Meta } from "./frontmatter"

export type ConvertResult =
  | { ok: true; markdown: string; meta: Meta }
  | { ok: false; error: string; isPdf?: boolean }

export type QuickCopyResult = { ok: true } | { ok: false; error: string }

export interface PageApi {
  convert: (options: Options) => ConvertResult
  quickCopy: (hasSelection: boolean) => Promise<QuickCopyResult>
}

const pageScriptPath = new URL(pageScriptUrl).pathname.slice(1)

/** null means Chrome refused the tab: a chrome:// page, the Web Store, a discarded tab. */
async function callPage<T>(tabId: number, method: keyof PageApi, arg: unknown): Promise<T | null> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [pageScriptPath] })
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (name: string, value: unknown) =>
        (globalThis as unknown as { __markdownr: Record<string, (v: unknown) => unknown> }).__markdownr[name](value),
      args: [method, arg]
    })
    return (frame?.result as T | undefined) ?? null
  } catch {
    return null
  }
}

export const convertInTab = (tabId: number, options: Options): Promise<ConvertResult | null> =>
  callPage<ConvertResult>(tabId, "convert", options)

export const quickCopyInTab = (tabId: number, hasSelection: boolean): Promise<QuickCopyResult | null> =>
  callPage<QuickCopyResult>(tabId, "quickCopy", hasSelection)
