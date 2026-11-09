// Turn captured page metadata into a citation a researcher can paste into a
// reference manager. Pure functions over Meta — no DOM, no network, fully testable.
// BibTeX (LaTeX / Overleaf / most managers) and RIS (Zotero, EndNote, Mendeley).
import type { Meta } from "./frontmatter"

/** First 4-digit run in a date string. Handles ISO ("2017-06-12T…") and "2017/06/12". */
function year(date?: string): string | undefined {
  return date?.match(/\d{4}/)?.[0]
}

/**
 * Split an author string into individual authors, without pretending to be a name
 * parser. Handles "A and B", "A; B", "Jane Doe, John Smith" and "Doe, Jane".
 */
function authors(author?: string): string[] {
  if (!author) return []
  const s = author.trim()
  const list = (separator: RegExp) => s.split(separator).map((a) => a.trim()).filter(Boolean)
  if (s.includes(";")) return list(/;/)
  if (/\band\b/.test(s)) return list(/\s+and\s+/)
  if ((s.match(/,/g) || []).length !== 1) return list(/,/)
  // One comma is "Last, First" unless both sides are full names.
  const [left, right] = s.split(",").map((part) => part.trim().split(/\s+/).length)
  return left > 1 && right > 1 ? list(/,/) : [s]
}

/** BibTeX cite key: firstauthorsurname + year + first title word, alnum only. */
function citeKey(meta: Meta): string {
  const first = authors(meta.author)[0]
  const surname = first ? (first.includes(",") ? first.split(",")[0] : first.split(/\s+/).pop() || first) : ""
  const titleWord = (meta.title || "").split(/\s+/).find((w) => /[a-z0-9]/i.test(w)) || "web"
  const key = `${surname}${year(meta.date) || ""}${titleWord}`.replace(/[^a-z0-9]/gi, "")
  return key || "source"
}

// Escape the LaTeX specials that break a BibTeX braced value.
const bibEscape = (s: string) => s.replace(/([&%$#_{}])/g, "\\$1").replace(/[~^]/g, (c) => `\\${c}{}`)
const escaped = (s?: string) => (s ? bibEscape(s) : undefined)

const today = () => new Date().toISOString().slice(0, 10)

/** BibTeX entry: @article for a journal paper, otherwise biblatex @online. */
export function toBibTeX(meta: Meta, key: string = citeKey(meta)): string {
  const fields: [string, string | undefined][] = [
    ["author", authors(meta.author).map(bibEscape).join(" and ") || undefined],
    ["title", escaped(meta.title)],
    ["journal", escaped(meta.journal)],
    ["year", year(meta.date)],
    ["volume", escaped(meta.volume)],
    ["number", escaped(meta.issue)],
    ["pages", meta.pages?.replace(/[-–]+/, "--")],
    ["doi", meta.doi], // like URLs, not escaped: backslashes would corrupt them
    // A brace would close the field early, so it is percent-encoded instead.
    ["url", meta.url.replace(/\{/g, "%7B").replace(/\}/g, "%7D")],
    ["urldate", meta.url ? today() : undefined],
    ["note", escaped(meta.description)]
  ]
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n")
  // biblatex requires a url on @online, which a captured file doesn't have.
  const type = meta.journal ? "article" : meta.url ? "online" : "misc"
  return `@${type}{${key},\n${body}\n}\n`
}

const ALPHABET_SIZE = 26
const keySuffix = (n: number): string => (n <= ALPHABET_SIZE ? String.fromCharCode(96 + n) : String(n))

/** A whole .bib file. Reference managers reject or merge entries that share a key. */
export function toBibliography(metas: Meta[]): string {
  const seen = new Map<string, number>()
  return metas
    .map((meta) => {
      const key = citeKey(meta)
      const repeats = seen.get(key) ?? 0
      seen.set(key, repeats + 1)
      return toBibTeX(meta, repeats ? `${key}${keySuffix(repeats)}` : key)
    })
    .join("\n")
}

/** RIS entry — for Zotero / EndNote / Mendeley import. */
export function toRIS(meta: Meta): string {
  const [startPage, endPage] = meta.pages?.split(/[-–]+/) ?? []
  const fields: [string, string | undefined][] = [
    ["TI", meta.title],
    ["JO", meta.journal],
    ["PY", year(meta.date)],
    ["VL", meta.volume],
    ["IS", meta.issue],
    ["SP", startPage],
    ["EP", endPage],
    ["AB", meta.description],
    ["DO", meta.doi],
    ["UR", meta.url],
    ["Y2", meta.url ? today() : undefined] // access date
  ]
  const lines = [
    `TY  - ${meta.journal ? "JOUR" : meta.url ? "ELEC" : "GEN"}`,
    ...authors(meta.author).map((a) => `AU  - ${a}`),
    ...fields.filter(([, v]) => v).map(([k, v]) => `${k}  - ${v}`),
    "ER  - "
  ]
  return lines.join("\n") + "\n"
}
