import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import { gfm } from "turndown-plugin-gfm"

export type CaptureMode = "reader" | "full" | "selection"

export interface Options {
  mode: CaptureMode
  images: boolean // include images
  links: boolean // include links
  frontmatter: boolean // prepend YAML metadata
  absoluteUrls: boolean // resolve relative -> absolute
}

export const DEFAULT_OPTIONS: Options = {
  mode: "reader",
  images: true,
  links: true,
  frontmatter: true,
  absoluteUrls: true
}

export interface Meta {
  title: string
  url: string
  author?: string
  date?: string
  description?: string
}

// Never-rendered markup. Always safe to drop.
const NON_CONTENT = ["script", "style", "noscript", "template", "svg", "link", "meta"]

// Fixed UI/affordance strings that platforms render as visible text around media —
// pure noise in a Markdown capture (Medium repeats the first one ~15x per article).
// Matched only against a LEAF element whose ENTIRE text equals the phrase, so an
// image, caption, or real paragraph is never removed. Lowercased for comparison.
const JUNK_PHRASES = new Set([
  "press enter or click to view image in full size",
  "press enter or click to view image in full screen"
])

// Consent/cookie banners only. Readability already handles nav, ads and sidebars —
// measured identical output with and without stripping them — so anything broader
// here is pure downside. Two production bugs came from over-broad entries:
//   [class*='cky']        matched "sticky-header"  -> deleted <html> on Wikipedia
//   [class*='newsletter'] matched Substack's post wrapper -> deleted the article
// Keep this list narrow and token-anchored. The size guard below is the real backstop.
const CONSENT_SELECTORS = [
  "[id*='cookie-banner' i]", "[class*='cookie-banner' i]",
  "[id*='cookie-notice' i]", "[class*='cookie-notice' i]",
  "[id*='cookie-consent' i]", "[class*='cookie-consent' i]",
  "[id*='consent-banner' i]", "[class*='consent-banner' i]",
  "[id*='cookieyes' i]", "[class^='cky-' i]", "[class*=' cky-' i]", "[id^='cky-' i]",
  "[class*='onetrust' i]", "[id*='onetrust' i]",
  "[id*='gdpr' i]", "[class*='gdpr' i]"
]

const JUNK_SELECTORS = [...NON_CONTENT, ...CONSENT_SELECTORS]

// An element holding this much of the page's text is content, not a banner.
const CONTENT_SHARE_LIMIT = 0.25

const textLen = (n: Node | null) => (n?.textContent || "").replace(/\s+/g, " ").trim().length

function stripJunk(root: ParentNode) {
  const doc = (root as Element).ownerDocument ?? (root as Document)
  const pageText = textLen((doc.body ?? root) as Node)

  root.querySelectorAll(NON_CONTENT.join(",")).forEach((el) => el.remove())

  // Accessibility skip-links ("Skip to main content") are visually hidden, so they
  // read as pure noise in the output. Matched on text rather than class: MDN and
  // others ship them with no class at all. Deliberately narrow — must be an in-page
  // anchor, start with "skip to", and be short — so a real link that happens to
  // begin with the word "skip" is never touched.
  root.querySelectorAll("a[href^='#']").forEach((a) => {
    const text = (a.textContent || "").trim()
    if (text.length <= 40 && /^skip to\b/i.test(text)) a.remove()
  })

  // Platform image-zoom affordance text ("Press enter or click to view image in
  // full size"). Only a leaf element whose whole text is the exact phrase — never
  // an element containing an <img>, so the image itself always survives.
  root.querySelectorAll("*").forEach((el) => {
    if (el.children.length === 0 && JUNK_PHRASES.has((el.textContent || "").trim().toLowerCase())) el.remove()
  })

  // Images injected by other browser extensions are never page content.
  root.querySelectorAll("img[src]").forEach((img) => {
    const src = (img as HTMLImageElement).getAttribute("src") || ""
    if (/^(chrome|moz|safari-web)-extension:/i.test(src)) img.remove()
  })

  root.querySelectorAll(CONSENT_SELECTORS.join(",")).forEach((el) => {
    // Never remove structural roots — a loose selector matching <html> wipes the document.
    const tag = el.tagName
    if (el === doc.documentElement || el === doc.body || tag === "HTML" || tag === "BODY" || tag === "HEAD") return
    // Never remove something that holds a big share of the page. A consent banner is
    // small; if this element isn't, the selector matched real content by accident.
    if (pageText > 0 && textLen(el) > pageText * CONTENT_SHARE_LIMIT) return
    el.remove()
  })
}

// new URL() happily preserves "javascript:" and "data:", so without a check a
// hostile page can plant a live payload in the markdown we hand the user. We
// never render it, but whatever they paste it into might.
// Links: no data: — a data: link is only ever an exfil/payload trick.
// Images: data: allowed, inline chart/logo images are legitimate page content.
const LINK_SCHEMES = ["http:", "https:", "mailto:"]
const IMG_SCHEMES = ["http:", "https:", "data:"]

/**
 * Resolve `raw` against `base` and reject unsafe schemes.
 * Returns the resolved href, the original (when not absolutizing), or null to drop.
 */
function safeUrl(raw: string, base: string, allowed: string[], absolute: boolean): string | null {
  try {
    const url = new URL(raw, base)
    if (!allowed.includes(url.protocol)) return null
    return absolute ? url.href : raw
  } catch {
    // Unparseable even with a base — a relative path on a page with no base URI.
    // Not a scheme risk (no colon), so keep it as-is rather than losing the link.
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? null : raw
  }
}

/**
 * Scheme-sanitize every URL, and optionally rewrite relative -> absolute.
 * Always runs: sanitizing must not be conditional on the absoluteUrls toggle.
 */
// Only blocks big enough to hijack extraction are worth a style lookup.
const HIDDEN_CHECK_MIN_CHARS = 200

/**
 * Remove from `clone` every element that is invisible in the live page.
 *
 * Real bug: a Webflow blog embedded the full body of each related post in a
 * `div.hidden-blog-content` (hidden by an external stylesheet). Readability scored
 * that block above the real article, so capturing a FAQ page returned a completely
 * different post — correct title, wrong body, no error. Extracting content the
 * user cannot see is never right.
 *
 * Reads computed style from the LIVE document (a detached clone has neither layout
 * nor stylesheets) but only ever mutates the clone, so the page itself is untouched.
 * Bails out if the two trees don't line up 1:1 — better to keep hidden content than
 * to delete the wrong nodes on a guess.
 */
function dropHiddenContent(live: Document, clone: Document) {
  const view = live.defaultView
  if (!view?.getComputedStyle) return // no layout engine (jsdom): skip rather than guess

  const liveEls = live.querySelectorAll("*")
  const cloneEls = clone.querySelectorAll("*")
  if (liveEls.length !== cloneEls.length) return

  for (let i = 0; i < liveEls.length; i++) {
    const el = liveEls[i]
    // Document order puts an ancestor before its children, so hiding a container
    // takes its whole subtree with it and the children cost nothing to skip.
    if ((el.textContent || "").length < HIDDEN_CHECK_MIN_CHARS) continue
    // Never drop content inside a native <details>: a collapsed accordion answer
    // is real, user-revealable content, and some browsers compute its panel as
    // hidden while closed. FAQ pages are built entirely from these — dropping them
    // returns the questions with no answers. Decoys like hidden-blog-content live
    // in plain divs, so the decoy fix is unaffected.
    if (el.closest("details")) continue
    let style: CSSStyleDeclaration
    try {
      style = view.getComputedStyle(el)
    } catch {
      continue
    }
    if (style.display === "none" || style.visibility === "hidden") cloneEls[i].remove()
  }
}

function normalizeUrls(root: ParentNode, base: string, absolute: boolean) {
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = safeUrl(a.getAttribute("href")!, base, LINK_SCHEMES, absolute)
    // turndown renders an <a> with no href as its bare text, which is what we want
    if (href === null) a.removeAttribute("href")
    else a.setAttribute("href", href)
  })
  root.querySelectorAll("img[src]").forEach((img) => {
    const src = safeUrl(img.getAttribute("src")!, base, IMG_SCHEMES, absolute)
    if (src === null) img.remove()
    else img.setAttribute("src", src)
  })
}

function makeTurndown(opts: Options): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "_",
    linkStyle: "inlined"
  })
  td.use(gfm)

  // Math renderers paint the same expression twice: a MathML tree for screen
  // readers AND a visual HTML tree. Turndown reads both, so "E=mc^2" arrives as
  // "E\=mc2E=mc^2E\=mc2". Both KaTeX and MathJax stash the original TeX in an
  // <annotation>, so we can emit real LaTeX instead — which is what an LLM wants.
  td.addRule("math", {
    filter: (node) =>
      node.nodeName === "MJX-CONTAINER" ||
      node.nodeName === "MATH" ||
      (typeof node.className === "string" && /(^|\s)katex(\s|$)/.test(node.className)),
    replacement: (content, node) => {
      const el = node as unknown as Element
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
      if (!tex) {
        // No TeX available: fall back to the accessible layer only, never both.
        const mathml = el.querySelector("math")?.textContent?.trim()
        return mathml || content
      }
      const display =
        /katex-display/.test(el.className || "") ||
        el.getAttribute("display") === "block" ||
        el.querySelector("math")?.getAttribute("display") === "block"
      return display ? `\n\n$$${tex}$$\n\n` : `$${tex}$`
    }
  })

  // Prism puts the language on the <pre>, not the <code>, so the GFM plugin's
  // fence rule finds no language and emits a bare ``` — losing syntax context.
  td.addRule("fencedCodeBlockWithLang", {
    filter: (node) => node.nodeName === "PRE" && node.firstChild?.nodeName === "CODE",
    replacement: (_content, node) => {
      const el = node as unknown as Element
      const code = el.firstChild as Element
      // Check the <code> first (hljs/standard), then the <pre> (Prism).
      const classes = `${code.getAttribute?.("class") || ""} ${el.getAttribute("class") || ""}`
      // `brush: js` is MDN's convention (SyntaxHighlighter legacy) — 17 of the 18
      // code blocks on a typical MDN reference page use it, so without this every
      // MDN capture loses its language tags.
      const lang = (/(?:language|lang)-(\S+)/.exec(classes) || /brush:\s*([\w+#-]+)/.exec(classes))?.[1] || ""
      const text = (code.textContent || "").replace(/\n+$/, "")
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
    }
  })

  if (!opts.images) td.addRule("dropImages", { filter: "img", replacement: () => "" })
  if (!opts.links) {
    td.addRule("unwrapLinks", { filter: "a", replacement: (content) => content })
  }
  return td
}

/**
 * Pull article metadata out of the first JSON-LD block that describes the page.
 * Modern CMSs (Substack, Ghost, most news sites) put the real publish date here
 * and expose only `article:modified_time` as a meta tag — so without this, a
 * republished post reports the wrong date and most Substack posts report none.
 * Never throws: malformed JSON-LD is common and must not break extraction.
 */
function readJsonLd(doc: Document): { date?: string; description?: string; author?: string } {
  const ARTICLE_TYPES = ["Article", "NewsArticle", "BlogPosting", "TechArticle", "Report"]
  const out: { date?: string; description?: string; author?: string } = {}

  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let parsed: unknown
    try {
      parsed = JSON.parse(script.textContent || "")
    } catch {
      continue
    }
    // A page may ship a bare object, an array, or an @graph wrapper.
    const graph = (parsed as { "@graph"?: unknown })?.["@graph"]
    const nodes = (Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed]) as Record<string, any>[]

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue
      const types = [node["@type"]].flat().filter((t) => typeof t === "string")
      if (!types.some((t) => ARTICLE_TYPES.includes(t))) continue

      out.date ||= typeof node.datePublished === "string" ? node.datePublished : undefined
      out.description ||= typeof node.description === "string" ? node.description : undefined
      // author is either a string, an object with .name, or an array of either
      const author = [node.author].flat()[0]
      const name = typeof author === "string" ? author : author?.name
      out.author ||= typeof name === "string" ? name : undefined

      if (out.date && out.description && out.author) return out
    }
  }
  return out
}

/** First non-empty `content` attribute among the given meta selectors. */
function metaContent(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const content = doc.querySelector(sel)?.getAttribute("content")?.trim()
    if (content) return content
  }
  return undefined
}

export function buildFrontmatter(meta: Meta): string {
  // A YAML double-quoted scalar treats \ as an escape character, so escaping only
  // the quotes leaves a title like 'C:\path' or one containing a real newline
  // producing invalid YAML — which breaks every downstream parser silently.
  // Order matters: backslashes first, or we escape the ones we just added.
  const esc = (s: string) =>
    `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n")}"`
  const lines = ["---", `title: ${esc(meta.title || "")}`, `url: ${esc(meta.url || "")}`]
  if (meta.description) lines.push(`description: ${esc(meta.description)}`)
  if (meta.author) lines.push(`author: ${esc(meta.author)}`)
  if (meta.date) lines.push(`date: ${esc(meta.date)}`)
  lines.push(`captured: ${esc(new Date().toISOString())}`)
  lines.push("---", "")
  return lines.join("\n")
}

/**
 * Insert an Obsidian-style `tags:` line into an existing frontmatter block.
 *
 * Kept popup-side (applied to the finished markdown) rather than in the conversion
 * options on purpose: tags are a labelling choice, not an extraction one, so a
 * researcher typing tags should not re-trigger a full DOM re-extract per keystroke.
 *
 * `tagsText` is the raw comma-separated input. Tags are normalized to what Obsidian
 * accepts: no leading '#', spaces -> hyphens, only word chars / hyphen / slash
 * (slash = Obsidian nested tags). No frontmatter block (frontmatter toggle off) or
 * no valid tags -> markdown returned untouched.
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
  if (!clean.length || !markdown.startsWith("---\n")) return markdown
  // The frontmatter closing fence is the first "\n---" after the opening one.
  // Values are single-line quoted scalars (newlines escaped), so a "\n---" can't
  // appear inside them — this never matches a horizontal rule in the body.
  const close = markdown.indexOf("\n---", 4)
  if (close === -1) return markdown
  return `${markdown.slice(0, close)}\ntags: [${clean.join(", ")}]${markdown.slice(close)}`
}

/** Pure: HTML string -> Markdown. Works in Node (Turndown ships a parser). */
export function htmlToMarkdown(html: string, opts: Options, meta?: Meta): string {
  const md = makeTurndown(opts).turndown(html).trim()
  const body = md.replace(/\n{3,}/g, "\n\n")
  return opts.frontmatter && meta ? buildFrontmatter(meta) + body + "\n" : body + "\n"
}

/**
 * Guard the return path: empty output should say so rather than handing back a
 * blank preview with no explanation. Images count as content — a gallery page
 * has no text but is still worth converting.
 */
function resultOrEmpty(html: string, meta: Meta, doc: Document): { html: string; meta: Meta } | { error: string } {
  const probe = doc.createElement("div")
  probe.innerHTML = html
  const hasText = (probe.textContent || "").trim().length > 0
  const hasMedia = !!probe.querySelector("img, picture, video, table")
  if (!hasText && !hasMedia) return { error: "Nothing to convert on this page." }
  return { html, meta }
}

/** DOM-side: pull HTML + metadata from the live page per mode. Content-script only. */
export function extractFromDom(opts: Options, doc: Document = document): { html: string; meta: Meta } | { error: string } {
  const base = doc.baseURI || doc.location?.href || ""
  const ld = readJsonLd(doc)

  // og:title is the publisher's declared title. Prefer it over Readability's guess,
  // which splits <title> on ": " and keeps only the tail — assuming a
  // "Site Name: Article" pattern. On "Jakob's Law: Why AI Products Fail" that
  // heuristic eats the actual subject of the piece.
  const ogTitle = metaContent(doc, ["meta[property='og:title']"])
  const meta: Meta = { title: ogTitle || doc.title, url: doc.location?.href || base }

  // citation_* are the Google Scholar tags used by arXiv, PubMed and most journals.
  meta.author =
    metaContent(doc, [
      "meta[name='author']",
      "meta[property='article:author']",
      "meta[name='citation_author']"
    ]) ?? ld.author

  // Order matters: a real published date beats JSON-LD, which beats a modified
  // date. Substack ships only modified_time as a meta tag, so without the
  // JSON-LD step in the middle every Substack capture loses its date.
  meta.date =
    metaContent(doc, [
      "meta[property='article:published_time']",
      "meta[name='date']",
      "meta[name='citation_publication_date']",
      "meta[name='citation_date']"
    ]) ??
    ld.date ??
    metaContent(doc, ["meta[property='article:modified_time']"]) ??
    doc.querySelector("time[datetime]")?.getAttribute("datetime")?.trim() ??
    undefined

  // The subtitle/deck. Real context for an LLM ("Part 1 of 3"), and cheap.
  // Skip oversized ones: some sites dump the whole article into description.
  const description = metaContent(doc, [
    "meta[name='description']",
    "meta[property='og:description']"
  ]) ?? ld.description
  if (description && description.length <= 300) meta.description = description

  if (opts.mode === "selection") {
    const sel = doc.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return { error: "Nothing selected. Highlight text first." }
    const div = doc.createElement("div")
    for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents())
    stripJunk(div)
    normalizeUrls(div, base, opts.absoluteUrls)
    return resultOrEmpty(div.innerHTML, meta, doc)
  }

  // clone so we never mutate the live page
  const clone = doc.cloneNode(true) as Document
  // Must run before stripJunk, while clone and live tree still line up 1:1.
  dropHiddenContent(doc, clone)
  stripJunk(clone)

  if (opts.mode === "reader") {
    // Readability throws on malformed/stripped documents. Never fail the whole
    // conversion for it — fall through to full-page instead.
    // Readability DESTRUCTIVELY mutates the document it parses. Give it a throwaway
    // copy, or the full-page fallback below returns a gutted DOM (half the page).
    let article: ReturnType<Readability["parse"]> = null
    try {
      const rdDoc = clone.cloneNode(true) as Document
      // Readability culls H1/H2 whose class/id scores negative, and its NEGATIVE regex
      // begins with a literal "-" — so ANY hyphenated class (Substack's
      // "header-anchor-post") deletes the heading. Blank the attributes on this
      // throwaway copy so section headings survive; structure matters for Markdown.
      rdDoc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
        h.removeAttribute("class")
        h.removeAttribute("id")
      })
      // keepClasses: Readability's cleanup strips class attributes, which takes the
      // language off every <pre>/<code> — so Reader mode emitted bare fences while
      // Full page kept them. Classes are invisible to Markdown output otherwise;
      // our fence and math rules are the only things that read them.
      article = new Readability(rdDoc, { keepClasses: true }).parse()
    } catch {
      article = null
    }
    // Compare against the STRIPPED clone: the live body's textContent counts inline
    // <style>/<script> source, which on page-builder sites dwarfs the real prose and
    // would make this ratio meaningless.
    const bodyText = clone.body?.textContent || ""
    const bodyLen = bodyText.replace(/\s+/g, " ").trim().length
    const artLen = (article?.textContent || "").replace(/\s+/g, " ").trim().length
    // Fallback: Readability missing OR grabbed a tiny sliver (consent div / page-builder truncation)
    if (article && artLen > 200 && (bodyLen === 0 || artLen > bodyLen * 0.25)) {
      // Reconcile the two title sources. Readability cleans <title> heuristically:
      // good at dropping a trailing " | Site Name", bad at ": " which it assumes is
      // a site prefix. Compare against og:title to tell the two cases apart:
      //   og "Jakob's Law: Why AI Products Fail"  vs  rd "Why AI Products Fail"
      //     -> rd is a SUFFIX: it chopped a real leading part, keep og
      //   og "Array.prototype.map() - JavaScript | MDN"  vs  rd "...- JavaScript"
      //     -> rd is a PREFIX: it stripped the site name, keep rd
      const rdTitle = article.title?.trim()
      if (rdTitle) {
        const chompedLeadingPart = !!ogTitle && ogTitle !== rdTitle && ogTitle.endsWith(rdTitle)
        if (!chompedLeadingPart) meta.title = rdTitle
      }
      // Readability bylines can pick up footer junk ("Authority control databases…").
      // A real byline is short; anything else is noise.
      const byline = article.byline?.trim()
      const plausible = !!byline && byline.length <= 60 && byline.split(/\s+/).length <= 6
      if (!meta.author && plausible) meta.author = byline
      const wrap = clone.createElement("div")
      wrap.innerHTML = article.content
      normalizeUrls(wrap, base, opts.absoluteUrls)
      return { html: wrap.innerHTML, meta }
    }
    // fall through to full-page
  }

  const bodyClone = clone.body || clone.documentElement
  normalizeUrls(bodyClone, base, opts.absoluteUrls)
  return resultOrEmpty(bodyClone.innerHTML, meta, doc)
}
