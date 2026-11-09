import { useEffect, useState, type DragEvent } from "react"

import { toBibTeX, toRIS } from "~lib/cite"
import { buildFrontmatter, finishMarkdown, vaultFilename, type Meta } from "~lib/frontmatter"
import { pagesToMarkdown, pdfMeta } from "~lib/pdf"
import { PdfReadError, readPdf } from "~lib/pdf-read"
import { Action, asPrompt, downloadText, TextAction, useCopy } from "~lib/ui"

import "~style.css"

interface Settings {
  frontmatter: boolean
  tags: string
  template: string
}

const isPdfFile = (file: File): boolean => file.type === "application/pdf" || /\.pdf$/i.test(file.name)

export default function PdfPage() {
  const [settings, setSettings] = useState<Settings>({ frontmatter: true, tags: "", template: "" })
  const [output, setOutput] = useState("")
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const { copied, copy } = useCopy(setError)

  useEffect(() => {
    chrome.storage.sync
      .get(["options", "tags", "template"])
      .then(({ options, tags, template }) =>
        setSettings({ frontmatter: options?.frontmatter ?? true, tags: tags ?? "", template: template ?? "" })
      )
      .catch(() => setError("Couldn't load your saved settings. Using the defaults."))
  }, [])

  const convert = async (file: File | undefined) => {
    if (!file || isReading) return
    setError(null)
    setOutput("")
    setMeta(null)
    if (!isPdfFile(file)) {
      setError("That isn't a PDF file.")
      return
    }
    setIsReading(true)
    try {
      const { pages, info } = await readPdf(file)
      const body = pagesToMarkdown(pages)
      if (!body) {
        setError("No text found. This looks like a scanned PDF, which needs OCR first.")
        return
      }
      const details = pdfMeta(info, body, file.name)
      const markdown = settings.frontmatter ? buildFrontmatter(details) + body : body
      setMeta(details)
      setOutput(finishMarkdown(markdown, settings.tags, settings.template, details))
    } catch (e) {
      setError(e instanceof PdfReadError ? e.message : "Couldn't read this PDF.")
    } finally {
      setIsReading(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    convert(e.dataTransfer.files[0])
  }

  return (
    <main className="min-h-screen bg-white px-4 py-10 text-gray-900 dark:bg-neutral-900 dark:text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">Convert a PDF to Markdown</h1>
        <p className="pt-1 text-sm text-gray-500 dark:text-neutral-400">
          The file is read on this page and is never uploaded. Tables, figures and equations aren't rebuilt.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`mt-5 block cursor-pointer rounded-lg border-2 border-dashed p-10 text-center text-sm transition focus-within:border-[#fb411f] ${
            isDragging ? "border-[#fb411f]" : "border-gray-300 dark:border-neutral-700"
          }`}>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={isReading}
            className="sr-only"
            onChange={(e) => {
              convert(e.target.files?.[0])
              e.target.value = "" // lets the same file be chosen again
            }}
          />
          {isReading ? "Reading…" : "Drop a PDF here, or click to choose one"}
        </label>

        {error && (
          <p role="alert" className="pt-3 text-sm text-red-500">
            {error}
          </p>
        )}

        {output && meta && (
          <>
            <textarea
              readOnly
              aria-label="Markdown preview"
              value={output}
              className="mt-5 h-96 w-full resize-y rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            />
            <p className="pt-1 text-right text-xs text-gray-400 dark:text-neutral-500">
              {output.length.toLocaleString()} chars · ~{Math.ceil(output.length / 4).toLocaleString()} tokens
            </p>
            <div className="grid grid-cols-3 gap-2 pt-3">
              <Action primary onClick={() => copy(output, "copy")}>
                {copied === "copy" ? "Copied ✓" : "Copy"}
              </Action>
              <Action onClick={() => downloadText(output, `${vaultFilename(meta.title)}.md`)}>Download</Action>
              <Action onClick={() => copy(asPrompt(output), "prompt")}>{copied === "prompt" ? "Copied ✓" : "As prompt"}</Action>
            </div>
            <div className="flex items-center gap-3 pt-3 text-xs text-gray-500 dark:text-neutral-400">
              <span>Cite:</span>
              <TextAction onClick={() => copy(toBibTeX(meta), "bibtex")}>{copied === "bibtex" ? "Copied ✓" : "BibTeX"}</TextAction>
              <TextAction onClick={() => copy(toRIS(meta), "ris")}>{copied === "ris" ? "Copied ✓" : "RIS"}</TextAction>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
