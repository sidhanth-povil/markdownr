// Turn web footnotes into Markdown footnotes. Runs on a detached copy of the page,
// before URLs are made absolute, because it matches same-page #fragment links.

export const FOOTNOTE_REF_ATTR = "data-md-fn"
export const FOOTNOTE_DEF_ATTR = "data-md-fn-def"

// "1", "[1]", "(a)", "*", "[note 2]": what a footnote marker looks like in the text.
const REF_TEXT = /^[[(]?(?:[a-z]+\s)?(?:\d{1,4}|[a-z]|[*†‡§])[\])]?$/i
const NOTE_ELEMENT = "li, .footnote, [role='doc-endnote'], [role='doc-footnote']"
const NOTE_ID = /(^|[-_:])(fn|footnote|endnote|note|cite)/i
const REF_ELEMENT = "[role='doc-noteref'], [class*='footnote' i], [class*='noteref' i]"
const BACKLINK = ".mw-cite-backlink, [role='doc-backlink']"

function fragmentOf(href: string, base: string): string | null {
  let fragment: string | null = null
  if (href.startsWith("#")) {
    fragment = href.slice(1)
  } else {
    try {
      const url = new URL(href, base)
      if (url.hash && url.href.split("#")[0] === base.split("#")[0]) fragment = url.hash.slice(1)
    } catch {
      return null
    }
  }
  if (fragment === null) return null
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

function isNote(el: Element): boolean {
  return el.matches(NOTE_ELEMENT) || (/^(P|DIV)$/.test(el.tagName) && NOTE_ID.test(el.id))
}

// A numbered link to a list item is only a footnote if something else says so:
// otherwise "see 3 below" pointing at step 3 of a tutorial would be rewritten.
function isNoteRef(link: Element, note: Element): boolean {
  if (!REF_TEXT.test((link.textContent || "").trim()) || note.contains(link)) return false
  return !!link.closest("sup") || link.matches(REF_ELEMENT) || NOTE_ID.test(note.id)
}

/** The element to swap for the marker: the <sup> around the link, when that's all it holds. */
function refShell(link: Element): Element {
  const sup = link.closest("sup")
  return sup && sup.textContent?.trim() === link.textContent?.trim() ? sup : link
}

export function convertFootnotes(root: ParentNode, base: string): void {
  const doc = (root as Element).ownerDocument ?? (root as Document)
  const byId = new Map(Array.from(root.querySelectorAll("[id]")).map((el) => [el.id, el]))
  const labels = new Map<Element, number>()
  const refIds = new Set<string>()

  root.querySelectorAll("a[href*='#']").forEach((link) => {
    const fragment = fragmentOf(link.getAttribute("href")!, base)
    const note = fragment === null ? undefined : byId.get(fragment)
    if (!note || !isNote(note) || !isNoteRef(link, note)) return

    const label = labels.get(note) ?? labels.size + 1
    labels.set(note, label)
    const shell = refShell(link)
    if (shell.id) refIds.add(shell.id)
    if (link.id) refIds.add(link.id)

    const marker = doc.createElement("span")
    marker.setAttribute(FOOTNOTE_REF_ATTR, String(label))
    marker.textContent = String(label) // Turndown discards empty elements before any rule sees them
    shell.replaceWith(marker)
  })

  const lists = new Set<Element>()
  labels.forEach((label, note) => {
    note.querySelectorAll(BACKLINK).forEach((el) => el.remove())
    note.querySelectorAll("a[href*='#']").forEach((a) => {
      const fragment = fragmentOf(a.getAttribute("href")!, base)
      if (fragment !== null && refIds.has(fragment)) a.remove()
    })
    const definition = doc.createElement("div")
    definition.setAttribute(FOOTNOTE_DEF_ATTR, String(label))
    definition.append(...Array.from(note.childNodes))
    if (note.parentElement?.matches("ol, ul")) lists.add(note.parentElement)
    note.replaceWith(definition)
  })

  // A list that held only notes would render its definitions as list items.
  lists.forEach((list) => {
    const children = Array.from(list.children)
    if (children.every((c) => c.hasAttribute(FOOTNOTE_DEF_ATTR))) list.replaceWith(...children)
  })
}
