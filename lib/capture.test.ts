// Fidelity of the captured body: footnotes, lazy images, Wikipedia headings. Run: npm test
import assert from "node:assert"
import { JSDOM } from "jsdom"

import { DEFAULT_OPTIONS, extractFromDom, htmlToMarkdown, type Options } from "./convert"

const URL_BASE = "https://example.com/blog/post"
const PROSE = "This is a real paragraph of article prose that carries the substance of the page. ".repeat(6)

function run(body: string, opts: Partial<Options> = {}): string {
  const doc = new JSDOM(`<!doctype html><html><head><title>Post</title></head><body>${body}</body></html>`, {
    url: URL_BASE
  }).window.document
  const options = { ...DEFAULT_OPTIONS, frontmatter: false, ...opts }
  const res = extractFromDom(options, doc)
  if ("error" in res) throw new Error(res.error)
  return htmlToMarkdown(res.html, options, res.meta)
}

// --- markdown-generator footnotes (Hugo, Ghost, kramdown, GitHub) ---
{
  const md = run(`<article><p>${PROSE}</p>
    <p>A claim.<sup id="fnref:1"><a href="#fn:1" class="footnote-ref">1</a></sup> Another.<sup id="fnref:2"><a href="#fn:2" class="footnote-ref">2</a></sup></p>
    <section class="footnotes"><ol>
      <li id="fn:1"><p>First source. <a href="https://src.example/a">link</a> <a href="#fnref:1" class="footnote-backref">↩</a></p></li>
      <li id="fn:2"><p>Second source. <a href="#fnref:2" class="footnote-backref">↩</a></p></li>
    </ol></section></article>`, { mode: "full" })
  assert.match(md, /A claim\.\[\^1\] Another\.\[\^2\]/, "references become [^n]")
  assert.match(md, /^\[\^1\]: First source\. \[link\]\(https:\/\/src\.example\/a\)$/m, "definition 1 keeps its link")
  assert.match(md, /^\[\^2\]: Second source\.$/m, "definition 2, backlink gone")
  assert.doesNotMatch(md, /↩/, "no backlink arrows")
}

// --- Wikipedia references ---
{
  const md = run(`<div><p>${PROSE}</p>
    <p>Fact.<sup id="cite_ref-a_1-0" class="reference"><a href="#cite_note-a-1">[1]</a></sup> Again.<sup id="cite_ref-a_1-1" class="reference"><a href="#cite_note-a-1">[1]</a></sup></p>
    <ol class="references"><li id="cite_note-a-1"><span class="mw-cite-backlink">^ <a href="#cite_ref-a_1-0">a</a> <a href="#cite_ref-a_1-1">b</a></span> <span class="reference-text">Doe 2020.</span></li></ol></div>`, { mode: "full" })
  assert.match(md, /Fact\.\[\^1\] Again\.\[\^1\]/, "repeat references share a label")
  assert.match(md, /^\[\^1\]: Doe 2020\.$/m, "definition has no backlink letters")
  assert.equal((md.match(/^\[\^1\]:/gm) || []).length, 1, "one definition")
}

// --- Substack footnotes ---
{
  const md = run(`<div><p>${PROSE}</p>
    <p>Point<a class="footnote-anchor" id="footnote-anchor-1" href="#footnote-1">1</a>.</p>
    <div class="footnote" id="footnote-1"><a id="footnote-1-link" href="#footnote-anchor-1" class="footnote-number">1</a><div class="footnote-content"><p>Substack note.</p></div></div></div>`, { mode: "full" })
  assert.match(md, /Point\[\^1\]\./, "anchor becomes a reference")
  assert.match(md, /^\[\^1\]: Substack note\.$/m, "note becomes a definition without its number link")
}

// --- labels follow first appearance; a multi-paragraph note stays attached ---
{
  const md = run(`<article><p>${PROSE}</p>
    <p>B<sup><a href="#n7">7</a></sup> A<sup><a href="#n3">3</a></sup></p>
    <ol><li id="n3"><p>Three.</p></li><li id="n7"><p>Seven one.</p><p>Seven two.</p></li></ol></article>`, { mode: "full" })
  assert.match(md, /B\[\^1\] A\[\^2\]/, "numbered by first use")
  assert.match(md, /^\[\^1\]: Seven one\.\n\n {4}Seven two\.$/m, "continuation paragraph indented")
}

// --- an in-page link to a list item is not a footnote ---
{
  const md = run(`<article><p>${PROSE}</p><p>See <a href="#step-3">3</a> below.</p>
    <ol><li id="step-3">Do the thing.</li></ol></article>`, { mode: "full" })
  assert.doesNotMatch(md, /\[\^/, "plain cross-reference left alone")
  assert.match(md, /Do the thing\./)
}

// --- a reference whose note is outside the capture stays a link ---
{
  const md = run(`<article><p>${PROSE}</p><p>X<sup><a href="#missing">1</a></sup></p></article>`, { mode: "full" })
  assert.doesNotMatch(md, /\[\^/, "no dangling footnote")
}

// --- footnotes survive Reader mode with Absolute URLs on ---
{
  const md = run(`<article><p>${PROSE}</p><p>${PROSE}</p><p>${PROSE}</p>
    <p>${PROSE} Claim<sup id="fnref:1"><a href="#fn:1">1</a></sup>.</p>
    <ol><li id="fn:1"><p>The note text is here.</p></li></ol></article>`, { mode: "reader", absoluteUrls: true })
  assert.match(md, /Claim\[\^1\]\./, "reader keeps the reference")
  assert.match(md, /^\[\^1\]: The note text is here\.$/m, "reader keeps the definition")
}

// --- a page can't use our marker attributes to smuggle raw Markdown past the link sanitizer ---
{
  const md = run(`<article><p>${PROSE}</p>
    <span data-md-fn="x](javascript:alert(1))">visible</span>
    <div data-md-fn-def="y](javascript:alert(2))">also visible</div></article>`, { mode: "full" })
  assert.doesNotMatch(md, /javascript:/, "attribute value never reaches the output")
  assert.match(md, /visible/, "the text itself is kept")
}

const LARGE = "https://cdn.example/big.jpg"
const body = (img: string) => `<article><p>${PROSE}</p>${img}<p>${PROSE}</p></article>`

// --- lazy images resolve to the real file ---
for (const [name, img] of [
  ["data-src, no src", `<img data-src="${LARGE}" alt="x">`],
  ["data: placeholder", `<img src="data:image/gif;base64,R0lGOD" data-src="${LARGE}" alt="x">`],
  ["named placeholder", `<img src="/img/placeholder.png" data-original="${LARGE}" alt="x">`],
  ["data-srcset, largest wins", `<img src="/img/blank.gif" data-srcset="https://cdn.example/s.jpg 200w, ${LARGE} 1200w" alt="x">`],
  ["srcset only", `<img srcset="https://cdn.example/s.jpg 1x, ${LARGE} 2x" alt="x">`],
  ["picture source", `<picture><source srcset="${LARGE} 800w"><img alt="x"></picture>`]
] as const) {
  const md = run(body(img), { mode: "full" })
  assert.ok(md.includes(`![x](${LARGE})`), `lazy image: ${name}\n${md}`)
}

// --- a real src is never replaced ---
{
  const md = run(body(`<img src="https://cdn.example/real.jpg" data-src="${LARGE}" alt="x">`), { mode: "full" })
  assert.ok(md.includes("![x](https://cdn.example/real.jpg)"), "real src kept")
}

// --- Wikipedia's heading wrappers survive Reader mode ---
{
  const sections = ["History", "Design", "Reception"]
    .map(
      (h) => `<div class="mw-heading mw-heading2"><h2 id="${h}">${h}</h2><span class="mw-editsection">[<a href="/edit">edit</a>]</span></div>
        <p>${PROSE}</p><p>${PROSE}</p>`
    )
    .join("")
  const md = run(`<div class="mw-parser-output"><p>${PROSE}</p>${sections}</div>`, { mode: "reader" })
  for (const h of ["History", "Design", "Reception"]) assert.match(md, new RegExp(`^## ${h}$`, "m"), `${h} heading kept`)
  assert.doesNotMatch(md, /\[edit\]/, "edit links gone")
}

console.log("ok: all capture checks passed")
