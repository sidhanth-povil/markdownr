// Turn captured page metadata into a citation a researcher can paste into a
// reference manager. Pure functions over Meta — no DOM, no network, fully testable.
// BibTeX (LaTeX / Overleaf / most managers) and RIS (Zotero, EndNote, Mendeley).
import type { Meta } from "./convert"

/** First 4-digit run in a date string. Handles ISO ("2017-06-12T…") and "2017/06/12". */
function year(date?: string): string | undefined {
  return date?.match(/\d{4}/)?.[0]
}

/**
 * Split an author string into individual authors.
 * We store one author today, but a value may be "Doe, Jane and Smith, John" or
 * "Jane Doe, John Smith" — handle both without pretending to be a name parser.
 */
function authors(author?: string): string[] {
  if (!author) return []
  const s = author.trim()
  if (/\band\b/.test(s)) return s.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean)
  // "Last, First" is a single author (one comma, no obvious list) — keep it whole.
  if ((s.match(/,/g) || []).length === 1) return [s]
  // Otherwise treat commas as separators between people.
  return s.split(",").map((a) => a.trim()).filter(Boolean)
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

/** BibTeX @online entry (biblatex) — the right type for a captured web page. */
export function toBibTeX(meta: Meta): string {
  const fields: [string, string | undefined][] = [
    ["author", authors(meta.author).map(bibEscape).join(" and ") || undefined],
    ["title", meta.title ? bibEscape(meta.title) : undefined],
    ["year", year(meta.date)],
    ["url", meta.url], // URLs are not brace-escaped — backslashes would corrupt them
    ["urldate", new Date().toISOString().slice(0, 10)],
    ["note", meta.description ? bibEscape(meta.description) : undefined]
  ]
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n")
  return `@online{${citeKey(meta)},\n${body}\n}\n`
}

/** RIS entry — for Zotero / EndNote / Mendeley import. */
export function toRIS(meta: Meta): string {
  const lines = ["TY  - ELEC"]
  for (const a of authors(meta.author)) lines.push(`AU  - ${a}`)
  if (meta.title) lines.push(`TI  - ${meta.title}`)
  if (year(meta.date)) lines.push(`PY  - ${year(meta.date)}`)
  if (meta.description) lines.push(`AB  - ${meta.description}`)
  lines.push(`UR  - ${meta.url}`)
  lines.push(`Y2  - ${new Date().toISOString().slice(0, 10)}`) // access date
  lines.push("ER  - ")
  return lines.join("\n") + "\n"
}
