// Everything that shapes the frontmatter block and the saved filename. Pure, no DOM.

export interface Meta {
  title: string
  url: string // empty for a captured file
  file?: string // source filename, for a captured file
  author?: string // several people are joined with " and ", the BibTeX convention
  date?: string
  description?: string
  doi?: string
  journal?: string
  volume?: string
  issue?: string
  pages?: string
}

// A YAML double-quoted scalar treats \ as an escape character, so escaping only
// the quotes leaves a title like 'C:\path' or one containing a real newline
// producing invalid YAML — which breaks every downstream parser silently.
// Order matters: backslashes first, or we escape the ones we just added.
const yamlString = (s: string): string =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n").replace(YAML_UNSAFE, " ")}"`

// Control characters and the Unicode line breaks: invalid inside, or able to end, a YAML line.
const YAML_UNSAFE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x85\u2028\u2029]/g
const LINE_BREAKING = /[\s\x00-\x1f\x7f\x85\u2028\u2029]+/g

/**
 * Every Meta field is one line of page-supplied text. RIS and the combined document
 * are line-based, so a newline in a title could otherwise forge a record or a heading.
 */
export function singleLineMeta(meta: Meta): Meta {
  const entries = Object.entries(meta).map(([key, value]) => [key, typeof value === "string" ? value.replace(LINE_BREAKING, " ").trim() : value])
  return Object.fromEntries(entries) as unknown as Meta
}

export function buildFrontmatter(meta: Meta): string {
  const optional: [string, string | undefined][] = [
    ["url", meta.url],
    ["file", meta.file],
    ["description", meta.description],
    ["author", meta.author],
    ["date", meta.date],
    ["doi", meta.doi],
    ["journal", meta.journal],
    ["volume", meta.volume],
    ["issue", meta.issue],
    ["pages", meta.pages]
  ]
  const fields = optional.filter(([, value]) => value).map(([key, value]) => `${key}: ${yamlString(value!)}`)
  return ["---", `title: ${yamlString(meta.title || "")}`, ...fields, `captured: ${yamlString(new Date().toISOString())}`, "---", ""].join("\n")
}

// The closing fence is the first "\n---" after the opening one. Values are
// single-line quoted scalars (newlines escaped), so a "\n---" can't appear inside
// them — this never matches a horizontal rule in the body. Requiring the title line
// matters: with Frontmatter off, a page that opens with <hr> also starts with "---".
function frontmatterEnd(markdown: string): number {
  return markdown.startsWith("---\ntitle: ") ? markdown.indexOf("\n---", 4) : -1
}

function insertLines(markdown: string, lines: string[]): string {
  const close = frontmatterEnd(markdown)
  if (close === -1 || !lines.length) return markdown
  return `${markdown.slice(0, close)}\n${lines.join("\n")}${markdown.slice(close)}`
}

/**
 * Insert an Obsidian-style `tags:` line into an existing frontmatter block.
 *
 * Applied to the finished markdown rather than in the conversion options on
 * purpose: tags are a labelling choice, so a researcher typing tags should not
 * re-trigger a full DOM re-extract per keystroke.
 *
 * `tagsText` is the raw comma-separated input. Tags are normalized to what Obsidian
 * accepts: no leading '#', spaces -> hyphens, only word chars / hyphen / slash
 * (slash = Obsidian nested tags). No frontmatter block or no valid tags -> unchanged.
 */
export function applyTags(markdown: string, tagsText: string): string {
  const clean = [
    ...new Set(
      tagsText
        .split(",")
        .map((t) => t.replace(/^#/, "").trim().replace(/\s+/g, "-").replace(/[^\w/-]/g, ""))
        .filter(Boolean)
    )
  ]
  return clean.length ? insertLines(markdown, [`tags: [${clean.join(", ")}]`]) : markdown
}

const TEMPLATE_LINE = /^([A-Za-z_][\w-]*):\s*(.*)$/
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g

function templateValues(meta: Meta): Record<string, string | undefined> {
  let domain: string | undefined
  try {
    domain = new URL(meta.url).hostname
  } catch {
    domain = undefined // captured files have no URL
  }
  return {
    title: meta.title,
    url: meta.url,
    file: meta.file,
    author: meta.author,
    date: meta.date,
    doi: meta.doi,
    journal: meta.journal,
    domain,
    captured: new Date().toISOString().slice(0, 10)
  }
}

/**
 * Add the user's custom fields to the frontmatter block, one `key: value` per line.
 * A value written by hand is emitted as-is, so it can be any YAML the user wants.
 * A value using {{placeholders}} carries text from the page, so it is always quoted
 * and escaped. A placeholder with nothing to fill it drops the line.
 */
export function applyTemplate(markdown: string, template: string, meta: Meta): string {
  const close = frontmatterEnd(markdown)
  if (close === -1) return markdown

  const taken = new Set(
    markdown
      .slice(4, close)
      .split("\n")
      .map((line) => TEMPLATE_LINE.exec(line)?.[1])
  )
  const values = templateValues(meta)
  const lines: string[] = []

  for (const raw of template.split("\n")) {
    const match = TEMPLATE_LINE.exec(raw.trim())
    if (!match || taken.has(match[1])) continue
    const [, key, value] = match
    taken.add(key)
    if (!value.match(PLACEHOLDER)) {
      lines.push(`${key}: ${value}`.trimEnd())
      continue
    }
    const filled = value.replace(PLACEHOLDER, (_all, name: string) => values[name] ?? "").trim()
    if (filled) lines.push(`${key}: ${yamlString(filled)}`)
  }
  return insertLines(markdown, lines)
}

/** Tags first: a tag the user just typed beats a `tags:` line in their saved template. */
export function finishMarkdown(markdown: string, tagsText: string, template: string, meta: Meta): string {
  return applyTemplate(applyTags(markdown, tagsText), template, meta)
}

// Breaks a filename on some OS, or breaks an Obsidian [[wikilink]] to the note.
const UNSAFE_FILENAME = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g
const RESERVED_FILENAME = /^(con|prn|aux|nul|com\d|lpt\d)$/i
const MAX_FILENAME_CHARS = 120

/** A readable note name, without the extension, that any vault or OS accepts. */
export function vaultFilename(title: string): string {
  const cleaned = title.replace(UNSAFE_FILENAME, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "")
  // Spread splits by code point, so the cap can't cut an emoji in half.
  const capped = [...cleaned].slice(0, MAX_FILENAME_CHARS).join("").replace(/[. ]+$/, "")
  if (!capped) return "page"
  return RESERVED_FILENAME.test(capped) ? `${capped}_` : capped
}

/** First DOI in the text, bare. Drops sentence punctuation and an unmatched closing bracket. */
export function extractDoi(text: string): string | undefined {
  // Braces end the match: this value goes into a braced BibTeX field unescaped.
  let doi = /\b10\.\d{4,9}\/[^\s"'<>{}]+/i.exec(text)?.[0]
  if (!doi) return undefined
  for (;;) {
    const trimmed = doi.replace(/[.,;:]+$/, "")
    const unbalanced =
      (trimmed.endsWith(")") && count(trimmed, ")") > count(trimmed, "(")) ||
      (trimmed.endsWith("]") && count(trimmed, "]") > count(trimmed, "["))
    const next = unbalanced ? trimmed.slice(0, -1) : trimmed
    if (next === doi) return doi
    doi = next
  }
}

const count = (s: string, ch: string): number => s.split(ch).length - 1
