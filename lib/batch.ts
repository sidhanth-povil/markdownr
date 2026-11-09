// Combine several captured tabs into one research document. Pure + testable.
// Each source gets a numbered section with its details rather than stacked
// YAML frontmatter blocks (which aren't valid concatenated) — this reads cleanly
// for both a human and an LLM being asked to reason across the sources.
import type { Meta } from "./frontmatter"

export interface TabCapture {
  meta: Meta
  markdown: string // the body only — captured with frontmatter off
}

// Two trailing spaces: a Markdown line break, so these don't merge into one line.
function provenance({ url, author, date, doi, journal }: Meta): string {
  const lines: [string, string | undefined][] = [
    ["Source", url],
    ["Author", author],
    ["Published", date],
    ["DOI", doi],
    ["Journal", journal]
  ]
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("  \n")
}

export function combineTabs(caps: TabCapture[], { frontmatter = false }: { frontmatter?: boolean } = {}): string {
  const date = new Date().toISOString().slice(0, 10)
  const label = (c: TabCapture) => c.meta.title?.trim() || c.meta.url || "Untitled"

  const toc = caps.map((c, i) => `${i + 1}. [${label(c)}](${c.meta.url})`).join("\n")

  const sections = caps
    .map((c, i) => `## ${i + 1}. ${label(c)}\n\n${provenance(c.meta)}\n\n${c.markdown.trim()}`)
    .join("\n\n---\n\n")

  // One block for the whole document, so tags and custom fields have somewhere to go.
  const block = frontmatter
    ? `---\ntitle: "Captured sources (${caps.length})"\ncaptured: "${new Date().toISOString()}"\n---\n`
    : ""

  return `${block}# Captured sources (${caps.length}) — ${date}\n\n${toc}\n\n---\n\n${sections}\n`
}
