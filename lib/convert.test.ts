// Runnable check for the pure output pipeline. Run: npm test
// Covers the money path (formatting + option handling); DOM extraction is
// verified by loading the built extension. ponytail: no jsdom dep for extractFromDom.
import assert from "node:assert"
import { htmlToMarkdown, buildFrontmatter, applyTags, DEFAULT_OPTIONS, type Options } from "./convert"

const html = `<h1>Title</h1><p>Hello <a href="/page">link</a> and <img src="/i.png" alt="pic"></p><ul><li>a</li><li>b</li></ul>`

// default: keep links + images
let md = htmlToMarkdown(html, { ...DEFAULT_OPTIONS, frontmatter: false })
assert.match(md, /# Title/, "heading")
assert.match(md, /\[link\]\(\/page\)/, "keeps link")
assert.match(md, /!\[pic\]\(\/i\.png\)/, "keeps image")
assert.match(md, /-\s+a/, "list")

// drop links -> text stays, no markdown link
md = htmlToMarkdown(html, { ...DEFAULT_OPTIONS, frontmatter: false, links: false })
assert.doesNotMatch(md, /\[link\]\(/, "link dropped")
assert.match(md, /link/, "link text kept")

// drop images
md = htmlToMarkdown(html, { ...DEFAULT_OPTIONS, frontmatter: false, images: false })
assert.doesNotMatch(md, /!\[/, "image dropped")

// frontmatter
md = htmlToMarkdown(html, DEFAULT_OPTIONS, { title: "T", url: "https://x.com" })
assert.match(md, /^---\ntitle: "T"\nurl: "https:\/\/x\.com"/, "frontmatter block")

// GFM table
const table = `<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`
md = htmlToMarkdown(table, { ...DEFAULT_OPTIONS, frontmatter: false })
assert.match(md, /\| a \| b \|/, "gfm table header")
assert.match(md, /\| --- \| --- \|/, "gfm table divider")

// frontmatter escapes quotes
assert.match(buildFrontmatter({ title: 'He said "hi"', url: "u" }), /title: "He said \\"hi\\""/, "escaped quotes")

// REGRESSION: a YAML double-quoted scalar treats \ as an escape char, so a title
// containing a backslash or a newline used to emit invalid YAML.
{
  const fm = buildFrontmatter({ title: 'C:\\Users\\dev', url: "u" })
  assert.match(fm, /title: "C:\\\\Users\\\\dev"/, "backslash doubled")

  const nl = buildFrontmatter({ title: "line one\nline two", url: "u" })
  assert.match(nl, /title: "line one\\nline two"/, "newline escaped, not literal")
  assert.equal(nl.split("\n")[1], 'title: "line one\\nline two"', "title stays on one line")

  // the escaped forms must round-trip back to the original strings
  assert.equal(JSON.parse(/title: (".*")/.exec(fm)![1]), "C:\\Users\\dev", "backslash round-trips")
  assert.equal(JSON.parse(/title: (".*")/.exec(nl)![1]), "line one\nline two", "newline round-trips")
}

// --- code fence languages: the tag is what makes output useful to an LLM ---
{
  const fence = (h: string) => htmlToMarkdown(h, { ...DEFAULT_OPTIONS, frontmatter: false })

  // language on the <code> (standard / highlight.js)
  assert.match(fence(`<pre><code class="language-js">const x = 1</code></pre>`), /```js\n/, "fence: language-js")
  assert.match(
    fence(`<pre><code class="hljs language-ts"><span class="hljs-keyword">const</span> a = 1</code></pre>`),
    /```ts\nconst a = 1/,
    "fence: hljs spans flattened, language kept"
  )

  // REGRESSION: Prism puts the language on the <pre>, so this used to emit a
  // bare ``` and the LLM lost all syntax context.
  assert.match(fence(`<pre class="language-python"><code>def f():\n    return 1</code></pre>`), /```python\n/, "fence: prism pre-level language")

  // indentation inside the block must survive
  assert.match(fence(`<pre class="language-python"><code>def f():\n    return 1</code></pre>`), /\n    return 1/, "fence: indentation kept")

  // no language anywhere is still a valid bare fence
  assert.match(fence(`<pre><code>plain text</code></pre>`), /```\nplain text\n```/, "fence: bare fence when no language")
}

// --- math: renderers emit MathML + a visual layer, so naive conversion duplicates ---
{
  const katex = (tex: string, cls = "katex") =>
    `<span class="${cls}"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow>` +
    `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
    `<span class="katex-html" aria-hidden="true"><span class="base">E</span></span></span>`

  let out = htmlToMarkdown(`<p>Inline ${katex("E=mc^2")} done.</p>`, { ...DEFAULT_OPTIONS, frontmatter: false })
  // REGRESSION: used to render as "E\=mc2E=mc^2E\=mc2" — every layer concatenated.
  assert.equal(out.trim(), "Inline $E=mc^2$ done.", "math: inline katex -> single clean LaTeX")

  out = htmlToMarkdown(`<p>${katex("\\sum_{i=1}^n i", "katex katex-display")}</p>`, { ...DEFAULT_OPTIONS, frontmatter: false })
  assert.match(out, /\$\$\\sum_\{i=1\}\^n i\$\$/, "math: display math uses $$")

  // no TeX annotation available -> accessible layer only, never duplicated
  const noTex = `<span class="katex"><span class="katex-mathml"><math>xyz</math></span>` +
    `<span class="katex-html" aria-hidden="true">xyz</span></span>`
  out = htmlToMarkdown(`<p>${noTex}</p>`, { ...DEFAULT_OPTIONS, frontmatter: false })
  assert.equal(out.trim(), "xyz", "math: fallback emits the expression once, not twice")
}

// --- applyTags: Obsidian tags injected into frontmatter, body untouched ---
{
  const fm = htmlToMarkdown("<h1>T</h1><p>body</p>", DEFAULT_OPTIONS, { title: "T", url: "https://x.com" })

  const tagged = applyTags(fm, "research, ai")
  assert.match(tagged, /\ntags: \[research, ai\]\n---/, "tags land as the last frontmatter field")
  assert.match(tagged, /^---\ntitle: "T"/, "title still first")
  assert.ok(tagged.includes("body"), "body preserved")

  // normalization: strip #, spaces->hyphens, drop junk chars, dedupe
  assert.match(applyTags(fm, "#ai, machine learning, ai"), /tags: \[ai, machine-learning\]/, "normalized + deduped")

  // nested Obsidian tags keep their slash
  assert.match(applyTags(fm, "topic/ml"), /tags: \[topic\/ml\]/, "slash kept for nested tags")

  // empty / whitespace-only input -> unchanged
  assert.equal(applyTags(fm, ""), fm, "no tags -> unchanged")
  assert.equal(applyTags(fm, "  ,  , "), fm, "blank tags -> unchanged")

  // no frontmatter block (frontmatter toggle off) -> unchanged
  const bodyOnly = htmlToMarkdown("<p>hi</p>", { ...DEFAULT_OPTIONS, frontmatter: false })
  assert.equal(applyTags(bodyOnly, "ai"), bodyOnly, "no frontmatter -> tags no-op")

  // REGRESSION: a --- horizontal rule in the BODY must not be mistaken for the
  // frontmatter fence. Tags go in the frontmatter; the body hr stays put.
  const withHr = htmlToMarkdown("<p>intro</p><hr><p>after</p>", DEFAULT_OPTIONS, { title: "T", url: "u" })
  const t = applyTags(withHr, "x")
  assert.match(t, /\ntags: \[x\]\n---\n/, "tags in the frontmatter block")
  assert.equal((t.match(/^tags: /gm) || []).length, 1, "tags inserted exactly once")
  assert.ok(t.includes("after"), "body after the hr preserved")
}

console.log("ok: all convert checks passed")
