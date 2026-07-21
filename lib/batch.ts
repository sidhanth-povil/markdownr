// Combine several captured tabs into one research document. Pure + testable.
// Each source gets a numbered section with its title and URL rather than stacked
// YAML frontmatter blocks (which aren't valid concatenated) — this reads cleanly
// for both a human and an LLM being asked to reason across the sources.
import type { Meta } from "./convert"

export interface TabCapture {
  meta: Meta
  markdown: string // the body only — captured with frontmatter off
}

export function combineTabs(caps: TabCapture[]): string {
  const date = new Date().toISOString().slice(0, 10)
  const label = (c: TabCapture) => c.meta.title?.trim() || c.meta.url || "Untitled"

  const toc = caps.map((c, i) => `${i + 1}. [${label(c)}](${c.meta.url})`).join("\n")

  const sections = caps
    .map((c, i) => `## ${i + 1}. ${label(c)}\n\nSource: ${c.meta.url}\n\n${c.markdown.trim()}`)
    .join("\n\n---\n\n")

  return `# Captured sources (${caps.length}) — ${date}\n\n${toc}\n\n---\n\n${sections}\n`
}
