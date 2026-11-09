// Gets positioned text out of a PDF file with pdf.js. Bytes only: nothing is fetched,
// and the file never leaves the browser.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import * as pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs"

import type { PdfInfo, PdfItem, PdfPage } from "./pdf"

// Setting this runs pdf.js's worker code on this page rather than loading a separate
// worker file, which is simple to bundle. A very long PDF blocks only this tab.
;(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfWorker

export const MAX_PDF_BYTES = 100 * 1024 * 1024
const MAX_ROTATION = 0.01 // rotated text is margin stamps, like arXiv's identifier

export class PdfReadError extends Error {}

interface RawItem {
  str?: string
  transform?: number[]
  width?: number
}

function toItem(raw: RawItem): PdfItem | null {
  const t = raw.transform
  if (!raw.str || !t || Math.abs(t[1]) > MAX_ROTATION) return null
  return { text: raw.str, x: t[4], y: t[5], size: Math.hypot(t[2], t[3]), width: raw.width ?? 0 }
}

function friendlyError(error: unknown): PdfReadError {
  const name = (error as { name?: string })?.name
  if (name === "PasswordException") return new PdfReadError("This PDF is password protected. Remove the password, then try again.")
  if (name === "InvalidPDFException") return new PdfReadError("This file isn't a readable PDF.")
  return new PdfReadError("Couldn't read this PDF.")
}

export async function readPdf(file: File): Promise<{ pages: PdfPage[]; info: PdfInfo }> {
  if (file.size > MAX_PDF_BYTES) throw new PdfReadError("This PDF is over 100 MB, too large to convert here.")
  const data = new Uint8Array(await file.arrayBuffer())

  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
  try {
    const doc = await task.promise
    const pages: PdfPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const { width, height } = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      pages.push({ width, height, items: content.items.map((i) => toItem(i as RawItem)).filter((i): i is PdfItem => !!i) })
      page.cleanup()
    }
    const { info } = await doc.getMetadata()
    const fields = info as { Title?: string; Author?: string }
    return { pages, info: { title: fields.Title, author: fields.Author } }
  } catch (error) {
    throw friendlyError(error)
  } finally {
    await task.destroy()
  }
}
