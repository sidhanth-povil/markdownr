// Rebuild reading order and structure from positioned PDF text. Pure and testable:
// lib/pdf-read.ts gets the items out of the file, this decides what they mean.
import { extractDoi, singleLineMeta, type Meta } from "./frontmatter"

export interface PdfItem {
  text: string
  x: number
  y: number // PDF space: larger is higher on the page
  size: number
  width: number
}

export interface PdfPage {
  width: number
  height: number
  items: PdfItem[]
}

export interface PdfInfo {
  title?: string
  author?: string
}

interface Segment {
  text: string
  x: number
  right: number
  y: number
  size: number
}

interface Paragraph {
  text: string
  size: number
  lines: number
  right: number
}

const ROW_TOLERANCE = 0.5 // of font size: keeps superscripts on their line
const WORD_GAP = 0.15 // of font size: a wider gap between items is a space
const SEGMENT_GAP = 1.5 // of font size: a wider gap is a separate block (column, table cell)
const PARAGRAPH_GAP = 1.6 // of font size
const INDENT = 0.8 // of font size
const SHORT_LINE = 3 // font sizes short of the paragraph's right edge
const MARGIN_ZONE = 0.08 // of page height, top and bottom
const REPEAT_SHARE = 0.4 // of pages, for a margin line to count as a running header
const MIN_REPEAT_PAGES = 3
const MIN_SEGMENTS_FOR_COLUMNS = 10
const GUTTER_SEARCH = [0.35, 0.65] // of page width
const GUTTER_STEP = 2
const MAX_GUTTER_CROSSING = 0.15 // of segments
const MIN_COLUMN_SHARE = 0.3 // of segments on each side
const HEADING_SIZE_RATIO = 1.15
const SIZE_SHIFT_RATIO = 1.1
const MAX_HEADING_CHARS = 120
const MAX_HEADING_LINES = 3
const MAX_NUMBERED_HEADING_CHARS = 80
const TITLE_SEARCH_PARAGRAPHS = 12

const BULLET = /^[•●▪◦∙·]\s*/
const TERMINAL = /[.?!:;]["')\]]?$/
const BARE_PAGE_NUMBER = /^\d{1,4}$/
const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2})*)\.?\s+[A-Z]/
const KNOWN_SECTION =
  /^(abstract|introduction|background|related work|methods?|materials and methods|results|discussion|conclusions?|acknowledge?ments?|references|bibliography|appendix)$/i
const ALL_CAPS_HEADING = /^[A-Z][A-Z \-:&]{3,50}$/

function joinItems(items: PdfItem[]): string {
  let text = ""
  let end = 0
  for (const item of items) {
    const needsSpace = text && item.x - end > WORD_GAP * item.size
    text += (needsSpace ? " " : "") + item.text
    end = item.x + item.width
  }
  return text.replace(/\s+/g, " ").trim()
}

function toRows(items: PdfItem[]): PdfItem[][] {
  const rows: { y: number; size: number; items: PdfItem[] }[] = []
  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(item.y - row.y) <= ROW_TOLERANCE * Math.max(item.size, row.size)) {
      row.items.push(item)
      // Line position follows the body text, not a superscript that sorted first.
      if (item.size > row.size) Object.assign(row, { y: item.y, size: item.size })
    } else {
      rows.push({ y: item.y, size: item.size, items: [item] })
    }
  }
  return rows.map((r) => [...r.items].sort((a, b) => a.x - b.x))
}

function toSegment(items: PdfItem[]): Segment {
  const main = items.reduce((a, b) => (b.text.length > a.text.length ? b : a))
  const last = items[items.length - 1]
  return { text: joinItems(items), x: items[0].x, right: last.x + last.width, y: main.y, size: main.size }
}

function splitRow(row: PdfItem[]): PdfItem[][] {
  const groups: PdfItem[][] = []
  row.forEach((item, i) => {
    const prev = row[i - 1]
    if (prev && item.x - (prev.x + prev.width) <= SEGMENT_GAP * item.size) groups[groups.length - 1].push(item)
    else groups.push([item])
  })
  return groups
}

const marginKey = (text: string): string => text.replace(/\d+/g, "#").toLowerCase()
const inMargin = (s: { y: number }, height: number): boolean =>
  s.y > height * (1 - MARGIN_ZONE) || s.y < height * MARGIN_ZONE

/** Lines that recur in the margins of many pages, so they are furniture rather than text. */
function runningLines(pages: Segment[][][], heights: number[]): Set<string> {
  const seenOnPages = new Map<string, number>()
  pages.forEach((rows, i) => {
    const keys = new Set(rows.flat().filter((s) => inMargin(s, heights[i])).map((s) => marginKey(s.text)))
    keys.forEach((key) => seenOnPages.set(key, (seenOnPages.get(key) ?? 0) + 1))
  })
  const needed = Math.max(MIN_REPEAT_PAGES, Math.ceil(pages.length * REPEAT_SHARE))
  return new Set([...seenOnPages].filter(([, n]) => n >= needed).map(([key]) => key))
}

// ponytail: finds one gutter, so three-column pages read as one. Add recursive splitting if real files need it.
function findGutter(segments: Segment[], width: number): number | null {
  if (segments.length < MIN_SEGMENTS_FOR_COLUMNS) return null
  const crossingAt = (x: number) => segments.filter((s) => s.x < x - 1 && s.right > x + 1).length

  const candidates: { x: number; crossing: number }[] = []
  for (let x = width * GUTTER_SEARCH[0]; x <= width * GUTTER_SEARCH[1]; x += GUTTER_STEP) {
    candidates.push({ x, crossing: crossingAt(x) })
  }
  const fewest = Math.min(...candidates.map((c) => c.crossing))
  if (fewest > segments.length * MAX_GUTTER_CROSSING) return null

  const clear = candidates.filter((c) => c.crossing === fewest)
  const gutter = clear[Math.floor(clear.length / 2)].x
  const left = segments.filter((s) => s.right <= gutter).length
  const right = segments.filter((s) => s.x >= gutter).length
  const minimum = segments.length * MIN_COLUMN_SHARE
  return left >= minimum && right >= minimum ? gutter : null
}

/** Reading order: full-width lines split the page into bands, each read left column then right. */
function readingOrder(rows: Segment[][], width: number): Segment[] {
  const segments = rows.flat()
  const gutter = findGutter(segments, width)
  if (gutter === null) {
    return rows.map((row) => ({ ...row[0], text: row.map((s) => s.text).join(" "), right: row[row.length - 1].right }))
  }
  const ordered: Segment[] = []
  let left: Segment[] = []
  let right: Segment[] = []
  const flush = () => {
    ordered.push(...left, ...right)
    left = []
    right = []
  }
  for (const segment of segments) {
    if (segment.right <= gutter) left.push(segment)
    else if (segment.x >= gutter) right.push(segment)
    else {
      flush()
      ordered.push(segment)
    }
  }
  flush()
  return ordered
}

const sizeShifted = (a: number, b: number): boolean => Math.max(a, b) / Math.min(a, b) > SIZE_SHIFT_RATIO

function startsParagraph(prev: Segment, line: Segment, paragraphRight: number): boolean {
  if (BULLET.test(line.text) || sizeShifted(prev.size, line.size)) return true
  // "3. Method" directly followed by "3.1. Setup": two headings, not one line.
  if (NUMBERED_HEADING.test(prev.text) && NUMBERED_HEADING.test(line.text)) return true
  const ended = TERMINAL.test(prev.text)
  // Moved up the page: a new column or page. Carry on only mid-sentence.
  if (line.y >= prev.y) return ended || !/^[a-z]/.test(line.text)
  if (prev.y - line.y > PARAGRAPH_GAP * Math.max(prev.size, line.size)) return true
  if (ended && line.x > prev.x + INDENT * line.size) return true
  return ended && prev.right < paragraphRight - SHORT_LINE * prev.size
}

function appendLine(text: string, line: string): string {
  return /[a-z]-$/.test(text) && /^[a-z]/.test(line) ? text.slice(0, -1) + line : `${text} ${line}`
}

function toParagraphs(lines: Segment[]): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let prev: Segment | undefined
  for (const line of lines) {
    const current = paragraphs[paragraphs.length - 1]
    if (!prev || !current || startsParagraph(prev, line, current.right)) {
      paragraphs.push({ text: line.text, size: line.size, lines: 1, right: line.right })
    } else {
      paragraphs[paragraphs.length - 1] = {
        ...current,
        text: appendLine(current.text, line.text),
        lines: current.lines + 1,
        right: Math.max(current.right, line.right)
      }
    }
    prev = line
  }
  return paragraphs
}

const roundedSize = (size: number): number => Math.round(size * 2) / 2

function bodySize(paragraphs: Paragraph[]): number {
  const chars = new Map<number, number>()
  for (const p of paragraphs) chars.set(roundedSize(p.size), (chars.get(roundedSize(p.size)) ?? 0) + p.text.length)
  return [...chars].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [0, 0])[0]
}

function isSizeHeading(p: Paragraph, body: number): boolean {
  return (
    p.size >= body * HEADING_SIZE_RATIO &&
    p.text.length <= MAX_HEADING_CHARS &&
    p.lines <= MAX_HEADING_LINES &&
    !TERMINAL.test(p.text) &&
    /[a-z]{3}/i.test(p.text) &&
    /^[A-Z0-9]/.test(p.text)
  )
}

/** Heading level by what the text says about itself, or 0 when it is ordinary text. */
function namedHeadingLevel(p: Paragraph): number {
  if (p.lines !== 1 || TERMINAL.test(p.text)) return 0
  const numbered = NUMBERED_HEADING.exec(p.text)
  if (numbered && p.text.length <= MAX_NUMBERED_HEADING_CHARS) return Math.min(numbered[1].split(".").length + 1, 4)
  // Capitalized only: a lowercase "method" is a table column, not a section.
  return (/^[A-Z]/.test(p.text) && KNOWN_SECTION.test(p.text)) || ALL_CAPS_HEADING.test(p.text) ? 2 : 0
}

/** The biggest heading near the start. Oversized labels in a late figure can't claim it. */
function findTitle(paragraphs: Paragraph[], isHeading: (p: Paragraph) => boolean): Paragraph | undefined {
  return paragraphs
    .slice(0, TITLE_SEARCH_PARAGRAPHS)
    .filter((p) => isHeading(p) && !KNOWN_SECTION.test(p.text))
    .reduce<Paragraph | undefined>((best, p) => (!best || p.size > best.size ? p : best), undefined)
}

// PDF text never passes through Turndown, so it needs its own escaping. Otherwise a
// line in a file could become a live link, image or raw HTML wherever it's pasted.
const escapeInline = (text: string): string => text.replace(/[\\*_`[\]<]/g, "\\$&")
const escapeBlockStart = (text: string): string =>
  text.replace(/^(#{1,6}\s|>|[-+]\s|=+\s*$|-{3,}\s*$)/, "\\$1").replace(/^(\d+)([.)]\s)/, "$1\\$2")
const unescapeMarkdown = (markdown: string): string => markdown.replace(/\\(.)/g, "$1")

function renderParagraph(p: Paragraph, isTitle: boolean, isHeading: boolean): string {
  const text = escapeInline(p.text)
  if (isTitle) return `# ${text}`
  const named = namedHeadingLevel(p)
  if (named) return `${"#".repeat(named)} ${text}`
  if (isHeading) return `## ${text}`
  if (BULLET.test(p.text)) return `- ${escapeInline(p.text.replace(BULLET, ""))}`
  return escapeBlockStart(text)
}

export function pagesToMarkdown(pages: PdfPage[]): string {
  const pageRows = pages.map((page) =>
    toRows(page.items.filter((item) => item.text.trim())).map((row) => splitRow(row).map(toSegment))
  )
  const running = runningLines(pageRows, pages.map((p) => p.height))

  const lines = pageRows.flatMap((rows, i) => {
    const isFurniture = (s: Segment) =>
      inMargin(s, pages[i].height) && (BARE_PAGE_NUMBER.test(s.text) || running.has(marginKey(s.text)))
    const kept = rows.map((row) => row.filter((s) => !isFurniture(s))).filter((row) => row.length)
    return kept.length ? readingOrder(kept, pages[i].width) : []
  })
  if (!lines.length) return ""

  const paragraphs = toParagraphs(lines)
  const body = bodySize(paragraphs)
  // The same large text several times over is a figure label, not a section.
  const uses = new Map<string, number>()
  for (const p of paragraphs) uses.set(p.text, (uses.get(p.text) ?? 0) + 1)
  const isHeading = (p: Paragraph) => isSizeHeading(p, body) && uses.get(p.text) === 1

  const title = findTitle(paragraphs, isHeading)
  // Between the title and the first real section sit the author names, often set large.
  const titleIndex = title ? paragraphs.indexOf(title) : -1
  const firstSection = paragraphs.findIndex((p, i) => i > titleIndex && namedHeadingLevel(p) > 0)
  const isByline = (i: number) => titleIndex >= 0 && i > titleIndex && i < firstSection

  return paragraphs.map((p, i) => renderParagraph(p, p === title, isHeading(p) && !isByline(i))).join("\n\n") + "\n"
}

const JUNK_TITLE = /^(untitled|microsoft word\b)|\.(docx?|tex|pdf|indd|dvi|qxd)$/i
const MIN_TITLE_CHARS = 4
const DOI_SEARCH_CHARS = 6000

export function pdfMeta(info: PdfInfo, markdown: string, filename: string): Meta {
  const declared = info.title?.trim()
  const usable = declared && declared.length >= MIN_TITLE_CHARS && !JUNK_TITLE.test(declared)
  const plain = unescapeMarkdown(markdown)
  const title = usable ? declared : (/^# (.+)$/m.exec(plain)?.[1] ?? filename.replace(/\.pdf$/i, ""))
  return singleLineMeta({
    title,
    url: "",
    file: filename,
    author: info.author?.trim() || undefined,
    // No date on purpose: a PDF only records when the file was made, and citing
    // that as the publication date gives a 2017 paper the year 2024.
    doi: extractDoi(plain.slice(0, DOI_SEARCH_CHARS))
  })
}
