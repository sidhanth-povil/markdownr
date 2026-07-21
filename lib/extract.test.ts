// DOM extraction checks against the bug classes reported on competing extensions.
// Run: npm test
import assert from "node:assert"
import { JSDOM } from "jsdom"

import { DEFAULT_OPTIONS, extractFromDom, htmlToMarkdown, type Options } from "./convert"

const URL_BASE = "https://example.com/blog/post"

function dom(body: string, head = "") {
  return new JSDOM(`<!doctype html><html><head><title>Test Post</title>${head}</head><body>${body}</body></html>`, {
    url: URL_BASE
  }).window.document
}

function run(doc: Document, opts: Partial<Options> = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts }
  const res = extractFromDom(o, doc)
  if ("error" in res) return { error: res.error, md: "" }
  return { error: null, md: htmlToMarkdown(res.html, o, res.meta), meta: res.meta }
}

const LONG = (marker: string) =>
  `<p>${marker} ` + "This is a real paragraph of article prose that carries the substance of the page. ".repeat(6) + "</p>"

// --- 1. CookieYes consent banner must not be captured instead of the article ---
{
  const doc = dom(`
    <div class="cky-consent-container" id="cookieyes-banner">
      <p>We use cookies to improve your experience. ${"Accept all cookies and tracking technologies. ".repeat(20)}</p>
      <button>Accept</button>
    </div>
    <article>${LONG("ARTICLEBODY")}${LONG("more")}${LONG("more")}</article>
  `)
  const { md } = run(doc)
  assert.match(md, /ARTICLEBODY/, "1: captures the article")
  assert.doesNotMatch(md, /Accept all cookies/, "1: consent banner stripped")
}

// --- 2. Page-builder page must not truncate to a sliver ---
{
  const sections = Array.from({ length: 12 }, (_, i) =>
    `<div class="elementor-widget elementor-widget-text-editor"><div class="elementor-widget-container">${LONG("SEC" + i)}</div></div>`
  ).join("")
  const doc = dom(`<div class="elementor elementor-page">${sections}</div>`)
  const { md } = run(doc)
  assert.match(md, /SEC0/, "2: keeps first section")
  assert.match(md, /SEC11/, "2: keeps LAST section (no truncation)")
}

// --- 3. Reader mode falls back to full page when extraction yields almost nothing ---
{
  // content lives in a structure Readability scores poorly (bare divs, no article/p semantics)
  const doc = dom(`<div id="app"><div>${"DEEPCONTENT payload text. ".repeat(80)}</div></div>`)
  const { md } = run(doc, { mode: "reader" })
  assert.match(md, /DEEPCONTENT/, "3: fallback recovered the content")
}

// --- 4. Selection mode with nothing selected returns a clear error, not junk ---
{
  const doc = dom(`<article>${LONG("x")}</article>`)
  const { error, md } = run(doc, { mode: "selection" })
  assert.ok(error, "4: reports an error")
  assert.match(error!, /select/i, "4: error tells user what to do")
  assert.equal(md, "", "4: no output")
}

// --- 5. Relative URLs resolved against the page, and frontmatter carries real url ---
{
  const doc = dom(`<article>${LONG("y")}<p><a href="/other">link</a> <img src="../img/a.png" alt="pic"></p></article>`)
  const { md, meta } = run(doc, { absoluteUrls: true })
  assert.match(md, /\(https:\/\/example\.com\/other\)/, "5: link absolutized")
  assert.match(md, /https:\/\/example\.com\/img\/a\.png/, "5: image absolutized")
  assert.equal(meta!.url, URL_BASE, "5: meta url is the page url")
  assert.match(md, /^---\ntitle: "Test Post"/, "5: frontmatter present")
}

// --- 6. Full mode keeps everything except junk ---
{
  const doc = dom(`
    <div class="cookie-notice"><p>COOKIEJUNK accept our cookies</p></div>
    <nav><a href="/home">Home</a></nav>
    <article>${LONG("FULLBODY")}</article>
    <footer>FOOTERTEXT</footer>
  `)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /FULLBODY/, "6: article kept")
  assert.match(md, /FOOTERTEXT/, "6: footer kept in full mode")
  assert.doesNotMatch(md, /COOKIEJUNK/, "6: consent still stripped in full mode")
}

// --- 7. Scripts/styles never leak into output ---
{
  const doc = dom(`<script>var SECRET="leak"</script><style>.a{color:red}</style><article>${LONG("z")}</article>`)
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /SECRET|leak|color:red/, "7: script/style stripped")
}

// --- 8. Live page is never mutated by extraction ---
{
  const doc = dom(`<div class="cookie-bar">C</div><article>${LONG("w")}</article>`)
  const before = doc.body.innerHTML.length
  run(doc)
  assert.equal(doc.body.innerHTML.length, before, "8: source DOM untouched")
}

// --- 9. REGRESSION: a loose junk selector must never wipe <html>/<body> ---
// Real bug: [class*='cky'] matched Wikipedia's "vector-feature-sticky-header-enabled"
// on <html>, deleting documentElement and crashing Readability.
{
  const d = new JSDOM(
    `<!doctype html><html class="client-nojs vector-feature-sticky-header-enabled"><head><title>Wiki</title></head>` +
      `<body class="skin-vector"><article>${LONG("STICKYPAGE")}</article></body></html>`,
    { url: URL_BASE }
  ).window.document
  const { error, md } = run(d)
  assert.equal(error, null, "9: no crash on sticky-header class")
  assert.match(md, /STICKYPAGE/, "9: content survives")
}

// --- 10. Genuine CookieYes markup is still stripped (selector didn't over-tighten) ---
{
  const doc = dom(
    `<div class="cky-consent-container"><p>CKYJUNK accept cookies</p></div>` +
      `<div id="cky-policy">CKYPOLICY</div>` +
      `<div class="wrapper cky-modal">CKYMODAL</div>` +
      `<article>${LONG("REALPOST")}</article>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /REALPOST/, "10: article kept")
  assert.doesNotMatch(md, /CKYJUNK|CKYPOLICY|CKYMODAL/, "10: CookieYes markup stripped")
}

// --- 11. A class merely containing "cky" is NOT stripped ---
{
  const doc = dom(`<div class="sticky-sidebar-widget">STICKYKEEP</div><article>${LONG("p")}</article>`)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /STICKYKEEP/, "11: 'sticky' not treated as CookieYes")
}

// --- 12. REGRESSION: reader-mode fallback must return the WHOLE page, not a
// document Readability already gutted. Real bug: fallback yielded ~30% of the page.
{
  // nav-heavy index page: Readability scores poorly -> fallback path is taken
  const cards = Array.from({ length: 20 }, (_, i) => `<div class="card"><h3>CARD${i}</h3><p>Short blurb ${i}.</p></div>`).join("")
  const nav = `<nav>${Array.from({ length: 40 }, (_, i) => `<a href="/c/${i}">Category ${i}</a>`).join("")}</nav>`
  const html = `${nav}<div class="listing">${cards}</div>`

  const readerMd = run(dom(html), { mode: "reader" }).md
  const fullMd = run(dom(html), { mode: "full" }).md

  assert.match(readerMd, /CARD0/, "12: fallback keeps first card")
  assert.match(readerMd, /CARD19/, "12: fallback keeps LAST card")
  // fallback output must be materially the full page, not a gutted remnant
  assert.ok(
    readerMd.length > fullMd.length * 0.9,
    `12: fallback returned ${readerMd.length} chars vs full ${fullMd.length} — document was mutated`
  )
}

// --- 13. Junk bylines rejected, real ones kept ---
{
  const junk = "Authority control databases InternationalFASTNationalUnited StatesIsraelCzech Republic"
  const d1 = dom(`<article><p class="byline">${junk}</p>${LONG("a")}${LONG("b")}</article>`)
  assert.ok((run(d1).meta?.author ?? "").length <= 60, "13: junk byline rejected")

  const d2 = dom(`<article>${LONG("c")}</article>`, `<meta name="author" content="Jane Doe">`)
  assert.equal(run(d2).meta?.author, "Jane Doe", "13: real author kept")
}

// --- 14. REGRESSION (Substack): a content wrapper whose class merely contains a
// junk-ish word must never be stripped. Real bug: [class*='newsletter'] deleted the
// whole post body, so the output was comments + footer only.
{
  const doc = dom(
    `<div class="newsletter-post-wrapper"><article>${LONG("POSTBODY")}${LONG("more")}</article></div>` +
      `<div class="comments">Discussion about this post</div>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /POSTBODY/, "14: newsletter-classed wrapper survives")
}

// --- 15. REGRESSION (Substack): section headings must survive Readability's
// negative-class culling (its NEGATIVE regex matches ANY hyphenated class).
{
  const doc = dom(
    `<article>${LONG("intro")}` +
      `<h2 class="header-anchor-post"><span>The Mistake</span></h2>${LONG("s1")}` +
      `<h2 class="header-anchor-post"><span>What The Harness Does</span></h2>${LONG("s2")}` +
      `</article>`
  )
  const { md } = run(doc, { mode: "reader" })
  assert.match(md, /^## The Mistake$/m, "15: first heading kept")
  assert.match(md, /^## What The Harness Does$/m, "15: second heading kept")
}

// --- 16. Size guard: a consent-matching selector wrapping the whole page is kept ---
{
  const doc = dom(`<div id="gdpr-wrapper"><article>${LONG("WRAPPED")}${LONG("x")}</article></div>`)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /WRAPPED/, "16: oversized 'junk' match preserved by size guard")
}

// --- 17. Small genuine consent banner still stripped ---
{
  const doc = dom(`<div id="gdpr-banner"><p>GDPRJUNK accept</p></div><article>${LONG("REAL")}${LONG("y")}</article>`)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /REAL/, "17: article kept")
  assert.doesNotMatch(md, /GDPRJUNK/, "17: small consent banner stripped")
}

// --- 18. Images injected by OTHER extensions never leak into output ---
{
  const doc = dom(`<article>${LONG("z")}<img src="chrome-extension://abc123/icon/icon_32.png" alt=""></article>`)
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /chrome-extension:/, "18: extension image dropped")
}

// --- 19. Unsafe URL schemes never reach the output ---
// new URL() preserves "javascript:", so without a scheme check a hostile page
// could plant a live payload in the markdown the user pastes elsewhere.
{
  const doc = dom(
    `<article>${LONG("q")}` +
      `<p><a href="javascript:alert(1)">CLICKTEXT</a></p>` +
      `<p><a href="data:text/html,<script>alert(1)</script>">DATATEXT</a></p>` +
      `<p><a href="https://example.com/ok">SAFETEXT</a></p>` +
      `</article>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /javascript:/i, "19: javascript: link dropped")
  assert.doesNotMatch(md, /data:text\/html/i, "19: data: link dropped")
  assert.match(md, /CLICKTEXT/, "19: unsafe link's TEXT is kept")
  assert.match(md, /\[SAFETEXT\]\(https:\/\/example\.com\/ok\)/, "19: safe link untouched")
}

// --- 20. REGRESSION: scheme sanitizing must NOT depend on the absoluteUrls toggle.
// It used to live inside absolutize(), so turning absolute URLs off disabled it.
{
  const doc = dom(`<article>${LONG("r")}<p><a href="javascript:alert(1)">XTEXT</a></p></article>`)
  const { md } = run(doc, { mode: "full", absoluteUrls: false })
  assert.doesNotMatch(md, /javascript:/i, "20: sanitized even with absoluteUrls off")
  assert.match(md, /XTEXT/, "20: text kept")
}

// --- 21. Relative URLs still work when absoluteUrls is off ---
{
  const doc = dom(`<article>${LONG("s")}<p><a href="/other">REL</a></p></article>`)
  const { md } = run(doc, { mode: "full", absoluteUrls: false })
  assert.match(md, /\[REL\]\(\/other\)/, "21: relative link left relative")
}

// --- 22. data: images survive (legit inline content), javascript: images do not ---
{
  const px = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
  const doc = dom(`<article>${LONG("t")}<p><img src="${px}" alt="INLINEPIC"></p></article>`)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /INLINEPIC/, "22: data: image kept")
}

// --- 23. REGRESSION (Substack): publish date must survive.
// Real capture of thenuancedperspective.substack.com came back with no `date:`.
// Cause: Substack ships article:modified_time as a meta tag and the real
// datePublished only in JSON-LD, and we only looked for article:published_time.
{
  const head =
    `<meta data-rh="true" property="article:modified_time" content="2026-07-18T00:21:43.724Z"/>` +
    `<meta name="author" content="Ravi Yenduri" />` +
    `<meta data-rh="true" name="description" content="Harness Engineering: Part 1 of 3"/>` +
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: "The Model Is Not The Product",
      description: "Harness Engineering: Part 1 of 3",
      datePublished: "2026-07-18T00:11:25+00:00",
      dateModified: "2026-07-18T00:11:25+00:00",
      author: { "@type": "Person", name: "Ravi Yenduri" }
    })}</script>`
  const doc = dom(`<article>${LONG("SUBSTACKBODY")}${LONG("more")}</article>`, head)
  const { md, meta } = run(doc, { mode: "reader" })

  assert.equal(meta!.date, "2026-07-18T00:11:25+00:00", "23: JSON-LD datePublished preferred over modified_time")
  assert.equal(meta!.author, "Ravi Yenduri", "23: author kept")
  assert.equal(meta!.description, "Harness Engineering: Part 1 of 3", "23: subtitle captured")
  assert.match(md, /^date: "2026-07-18T00:11:25\+00:00"$/m, "23: date reaches frontmatter")
  assert.match(md, /^description: "Harness Engineering: Part 1 of 3"$/m, "23: description reaches frontmatter")
}

// --- 24. Date source precedence: a real published_time wins over JSON-LD ---
{
  const head =
    `<meta property="article:published_time" content="2020-01-01T00:00:00Z">` +
    `<script type="application/ld+json">${JSON.stringify({ "@type": "Article", datePublished: "2099-12-31T00:00:00Z" })}</script>`
  const doc = dom(`<article>${LONG("u")}</article>`, head)
  assert.equal(run(doc).meta!.date, "2020-01-01T00:00:00Z", "24: meta published_time wins")
}

// --- 25. JSON-LD in an @graph wrapper, and malformed JSON-LD, must not break ---
{
  const graph = `<script type="application/ld+json">${JSON.stringify({
    "@graph": [{ "@type": "WebSite" }, { "@type": "BlogPosting", datePublished: "2025-05-05T00:00:00Z" }]
  })}</script>`
  const doc = dom(`<article>${LONG("v")}</article>`, graph)
  assert.equal(run(doc).meta!.date, "2025-05-05T00:00:00Z", "25: @graph traversed")

  const bad = `<script type="application/ld+json">{ this is not json }</script>`
  const doc2 = dom(`<article>${LONG("BADLD")}</article>`, bad)
  const r2 = run(doc2)
  assert.equal(r2.error, null, "25: malformed JSON-LD does not throw")
  assert.match(r2.md, /BADLD/, "25: content still extracted")
}

// --- 26. A description dumping the whole article is skipped, not carried ---
{
  const head = `<meta name="description" content="${"very long boilerplate ".repeat(30)}">`
  const doc = dom(`<article>${LONG("w2")}</article>`, head)
  assert.equal(run(doc).meta!.description, undefined, "26: oversized description dropped")
}

// --- 27. Frontmatter stays valid YAML when metadata contains quotes ---
{
  const head = `<meta name="description" content='He said "hi" \\ there'>`
  const doc = dom(`<article>${LONG("x2")}</article>`, head)
  const { md } = run(doc)
  const line = md.split("\n").find((l) => l.startsWith("description:"))!
  assert.doesNotThrow(() => JSON.parse(line.slice("description: ".length)), "27: description is a valid quoted scalar")
}

// --- 28. REGRESSION: Reader mode must keep code-fence languages.
// Readability's cleanup strips class attributes, so Reader emitted bare ``` while
// Full page kept the language. Found on MDN: 18 tagged fences in full, 0 in reader.
{
  const block = `<pre class="brush: js notranslate"><code>const x = 1</code></pre>`
  const doc = dom(`<article>${LONG("code intro")}${block}${LONG("outro")}</article>`)
  const { md } = run(doc, { mode: "reader" })
  assert.match(md, /```js\n/, "28: language survives Readability in reader mode")
}

// --- 29. MDN's `brush: js` convention carries the language ---
{
  const doc = dom(`<article>${LONG("m")}<pre class="brush: python notranslate"><code>def f(): pass</code></pre></article>`)
  assert.match(run(doc, { mode: "full" }).md, /```python\n/, "29: brush: syntax parsed")
}

// --- 30. Accessibility skip-links are stripped, real links are not.
// MDN ships these with NO class, so this must match on text + in-page href.
{
  const doc = dom(
    `<a href="#content">Skip to main content</a>` +
      `<a href="#search">Skip to search</a>` +
      `<article>${LONG("n")}` +
      `<p><a href="#section-2">Skip to the good part of this very long article title</a></p>` +
      `<p><a href="/guide">Skipping Rope Guide</a></p>` +
      `</article>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /Skip to main content/, "30: skip-link removed")
  assert.doesNotMatch(md, /Skip to search/, "30: second skip-link removed")
  assert.match(md, /Skipping Rope Guide/, "30: unrelated link starting with 'Skip' kept")
  assert.match(md, /Skip to the good part/, "30: long in-page link kept (not a skip-link)")
}

// --- 31. citation_* metadata (arXiv, PubMed, journals) ---
{
  const head =
    `<meta name="citation_title" content="Attention Is All You Need" />` +
    `<meta name="citation_author" content="Vaswani, Ashish" />` +
    `<meta name="citation_date" content="2017/06/12" />`
  const doc = dom(`<article>${LONG("o")}</article>`, head)
  const { meta } = run(doc)
  assert.equal(meta!.author, "Vaswani, Ashish", "31: citation_author read")
  assert.equal(meta!.date, "2017/06/12", "31: citation_date read")
}

// --- 32. REGRESSION: a title containing ": " must not lose its leading part.
// Readability's _getArticleTitle splits <title> on ": " and keeps only the tail,
// assuming a "Site Name: Article" pattern — but it skips that split when an h1/h2
// exactly matches the title. On a live WordPress/Elementor page no heading matched,
// so "Jakob's Law: Why AI Products Fail..." was captured as "Why AI Products Fail...",
// dropping the actual subject. og:title is the publisher's declared title, so it wins.
{
  const full = "Jakob's Law: Why AI Products Fail Without It"
  const d = new JSDOM(
    `<!doctype html><html><head><title>${full}</title>` +
      `<meta property="og:title" content="${full}">` +
      `</head><body><article><h1>A Completely Different Heading</h1>` +
      `${LONG("TITLEBODY")}${LONG("more")}</article></body></html>`,
    { url: URL_BASE }
  ).window.document
  const { meta, md } = run(d, { mode: "reader" })
  assert.equal(meta!.title, full, "32: leading part of a colon title preserved")
  assert.match(md, /^title: "Jakob's Law: Why AI Products Fail Without It"$/m, "32: full title in frontmatter")
}

// --- 33. og:title must NOT reintroduce a site-name suffix that Readability stripped.
// The mirror case of 32: when Readability's title is a PREFIX of og:title it removed
// a trailing " | Site", which is correct and must be kept.
{
  const d = new JSDOM(
    `<!doctype html><html><head><title>Array.prototype.map() | MDN</title>` +
      `<meta property="og:title" content="Array.prototype.map() | MDN">` +
      `</head><body><article>${LONG("SUFFIXBODY")}${LONG("more")}</article></body></html>`,
    { url: URL_BASE }
  ).window.document
  const title = run(d, { mode: "reader" }).meta!.title
  assert.ok(!/\|\s*MDN\s*$/.test(title) || title === "Array.prototype.map() | MDN",
    "33: site suffix not reintroduced when Readability stripped it")
}

// --- 34. REGRESSION: hidden content must never be extracted.
// Real bug (optimalworkshop.com, Webflow): the full body of every related post was
// embedded in a hidden `div.hidden-blog-content`. Readability scored that decoy
// above the real article, so a FAQ page captured as a completely different post —
// correct title, wrong body, no error. Worst possible failure: silently plausible.
{
  const decoy = `<div style="display:none"><h2>DECOYHEADING</h2>${LONG("DECOYBODY")}${LONG("decoy2")}${LONG("decoy3")}</div>`
  const real = `<article><h2>Real Section</h2>${LONG("REALBODY")}</article>`
  const doc = dom(decoy + real)
  const { md } = run(doc, { mode: "reader" })
  assert.match(md, /REALBODY/, "34: real article captured")
  assert.doesNotMatch(md, /DECOYBODY/, "34: hidden decoy body excluded")
  assert.doesNotMatch(md, /DECOYHEADING/, "34: hidden decoy heading excluded")
}

// --- 35. visibility:hidden is also skipped, and full mode honours it too ---
{
  const doc = dom(`<div style="visibility:hidden">${LONG("INVISIBLE")}</div><article>${LONG("VISIBLE")}</article>`)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /VISIBLE/, "35: visible content kept")
  assert.doesNotMatch(md, /INVISIBLE/, "35: visibility:hidden content dropped")
}

// --- 36. The live document is still never mutated by the hidden-content pass ---
{
  const doc = dom(`<div style="display:none">${LONG("HIDDEN")}</div><article>${LONG("body")}</article>`)
  const before = doc.body.innerHTML.length
  run(doc, { mode: "reader" })
  assert.equal(doc.body.innerHTML.length, before, "36: source DOM untouched")
}

// --- 39. REGRESSION: native <details> accordion answers must not be dropped as
// "hidden". A collapsed FAQ answer is real content the user reveals with a click,
// and some browsers compute the closed panel as hidden. Dropping it returns the
// questions with no answers (found on aardvarkbookclub.com/faq). The decoy fix
// (tests 34-36) targets plain hidden divs, not disclosure widgets.
{
  const faq =
    Array.from({ length: 6 }, (_, i) =>
      `<details><summary><h3>Question ${i}?</h3></summary>` +
      `<div style="display:none"><p>ANSWER${i} ${"detail text ".repeat(20)}</p></div></details>`
    ).join("")
  const doc = dom(faq)
  const { md } = run(doc, { mode: "full" })
  assert.match(md, /ANSWER0/, "39: first collapsed answer kept")
  assert.match(md, /ANSWER5/, "39: last collapsed answer kept")
  assert.match(md, /Question 3\?/, "39: questions kept too")
}

// --- 40. The decoy exemption is scoped: a hidden div OUTSIDE any <details> is
// still dropped, so tests 34-36 keep holding alongside 39. ---
{
  const doc = dom(
    `<div style="display:none"><h2>DECOY2</h2>${LONG("decoybody")}${LONG("d2")}${LONG("d3")}</div>` +
      `<details><summary><h3>Q</h3></summary><div style="display:none"><p>KEPTANSWER ${"x ".repeat(120)}</p></div></details>` +
      `<article>${LONG("MAINBODY")}</article>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /DECOY2/, "40: hidden decoy outside <details> still dropped")
  assert.match(md, /KEPTANSWER/, "40: hidden answer inside <details> kept")
}

// --- 37. Empty / content-free page returns a clear message, not a blank preview ---
{
  const blank = dom(`<div></div>`)
  const r = run(blank, { mode: "full" })
  assert.ok(r.error, "37: empty page reports an error")
  assert.match(r.error!, /nothing to convert/i, "37: message is actionable")

  // whitespace-and-scripts only, no real content
  const noise = dom(`<script>var x=1</script><style>.a{}</style><div>   </div>`)
  assert.ok(run(noise, { mode: "full" }).error, "37: whitespace/script-only page also errors")
}

// --- 38. An image-only page (no text) is still worth converting ---
{
  const gallery = dom(`<div><img src="/a.png" alt="one"><img src="/b.png" alt="two"></div>`)
  const { error, md } = run(gallery, { mode: "full" })
  assert.equal(error, null, "38: image-only page not treated as empty")
  assert.match(md, /!\[one\]/, "38: images converted")
}

// --- 41. Medium image-zoom UI text ("Press enter or click to view image in full
// size") is stripped, but the image and real captions survive. Medium repeats this
// ~15x per article — pure noise in an LLM paste.
{
  const doc = dom(
    `<article>${LONG("intro")}` +
      `<figure><img src="/pic.png" alt="a real diagram">` +
      `<div>Press enter or click to view image in full size</div>` +
      `<figcaption>Figure 1: the actual caption</figcaption></figure>` +
      `<p>Press enter or click to view image — but this sentence keeps going so it is not the exact phrase.</p>` +
      `</article>`
  )
  const { md } = run(doc, { mode: "full" })
  assert.doesNotMatch(md, /Press enter or click to view image in full size/, "41: zoom UI text stripped")
  assert.match(md, /a real diagram/, "41: image preserved")
  assert.match(md, /Figure 1: the actual caption/, "41: real caption preserved")
  assert.match(md, /this sentence keeps going/, "41: a paragraph merely containing the words is NOT removed")
}

console.log("ok: all extraction checks passed")
