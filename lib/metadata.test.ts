// Citation-grade metadata: every author, DOI, journal details, and the exports built from them.
// Run: npm test
import assert from "node:assert"
import { JSDOM } from "jsdom"

import { toBibliography, toBibTeX, toRIS } from "./cite"
import { DEFAULT_OPTIONS, extractFromDom, type Meta } from "./convert"

function metaFor(head: string): Meta {
  const body = `<article>${"<p>Real article prose that carries the substance of the page. </p>".repeat(30)}</article>`
  const doc = new JSDOM(`<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>`, {
    url: "https://journal.example.com/article/1"
  }).window.document
  const res = extractFromDom(DEFAULT_OPTIONS, doc)
  if ("error" in res) throw new Error(res.error)
  return res.meta
}

// --- every citation_author survives, in order ---
{
  const meta = metaFor(`
    <meta name="citation_author" content="Vaswani, Ashish">
    <meta name="citation_author" content="Shazeer, Noam">
    <meta name="citation_author" content="Parmar, Niki">`)
  assert.equal(meta.author, "Vaswani, Ashish and Shazeer, Noam and Parmar, Niki", "all authors kept in order")
}

// --- citation tags beat a site-level author tag ---
{
  const meta = metaFor(`
    <meta name="author" content="Example Journal Editors">
    <meta name="citation_author" content="Doe, Jane">`)
  assert.equal(meta.author, "Doe, Jane", "paper author wins over site author")
}

// --- PubMed's semicolon-separated citation_authors ---
{
  const meta = metaFor(`<meta name="citation_authors" content="Smith J;Doe K;">`)
  assert.equal(meta.author, "Smith J and Doe K", "semicolon list split, empty tail dropped")
}

// --- JSON-LD author arrays keep everyone ---
{
  const ld = JSON.stringify({ "@type": "Article", author: [{ name: "Jane Doe" }, "John Smith"] })
  const meta = metaFor(`<script type="application/ld+json">${ld}</script>`)
  assert.equal(meta.author, "Jane Doe and John Smith", "JSON-LD author array fully read")
}

// --- journal fields and DOI ---
{
  const meta = metaFor(`
    <meta name="citation_doi" content="https://doi.org/10.1000/xyz.123">
    <meta name="citation_journal_title" content="Journal of Tests">
    <meta name="citation_volume" content="12">
    <meta name="citation_issue" content="3">
    <meta name="citation_firstpage" content="101">
    <meta name="citation_lastpage" content="118">`)
  assert.equal(meta.doi, "10.1000/xyz.123", "DOI normalized to bare form")
  assert.equal(meta.journal, "Journal of Tests")
  assert.equal(meta.volume, "12")
  assert.equal(meta.issue, "3")
  assert.equal(meta.pages, "101-118")
}

// --- a non-DOI dc.identifier is ignored ---
{
  const meta = metaFor(`<meta name="DC.Identifier" content="urn:isbn:12345">`)
  assert.equal(meta.doi, undefined, "only a real DOI counts")
}

const paper: Meta = {
  title: "A Study of Tests",
  url: "https://journal.example.com/article/1",
  author: "Doe, Jane and Smith, John",
  date: "2021-05-01",
  doi: "10.1000/xyz_123",
  journal: "Journal of Tests & Trials",
  volume: "12",
  issue: "3",
  pages: "101-118"
}

// --- journal papers export as articles ---
{
  const bib = toBibTeX(paper)
  assert.match(bib, /^@article\{Doe2021A,/, "journal paper is @article")
  assert.match(bib, /journal = \{Journal of Tests \\& Trials\}/, "journal escaped")
  assert.match(bib, /doi = \{10\.1000\/xyz_123\}/, "DOI left unescaped so it still resolves")
  assert.match(bib, /volume = \{12\}/)
  assert.match(bib, /number = \{3\}/)
  assert.match(bib, /pages = \{101--118\}/, "BibTeX page range uses --")

  const ris = toRIS(paper)
  assert.match(ris, /^TY {2}- JOUR/, "journal paper is JOUR")
  assert.match(ris, /JO {2}- Journal of Tests & Trials/)
  assert.match(ris, /DO {2}- 10\.1000\/xyz_123/)
  assert.match(ris, /VL {2}- 12/)
  assert.match(ris, /IS {2}- 3/)
  assert.match(ris, /SP {2}- 101/)
  assert.match(ris, /EP {2}- 118/)
  assert.equal((ris.match(/^AU {2}- /gm) || []).length, 2, "one AU per author")
}

// --- web pages stay @online ---
assert.match(toBibTeX({ title: "Post", url: "https://a.example/" }), /^@online\{/, "no journal -> @online")

// --- two people in a comma byline are two people; "Last, First" is one ---
{
  assert.match(toBibTeX({ ...paper, author: "Jane Doe, John Smith" }), /author = \{Jane Doe and John Smith\}/, "two full names")
  assert.match(toBibTeX({ ...paper, author: "Doe, Jane" }), /author = \{Doe, Jane\}/, "Last, First")
  assert.match(toBibTeX({ ...paper, author: "Doe, Jane Marie" }), /author = \{Doe, Jane Marie\}/, "Last, First Middle")
  assert.match(toBibTeX({ ...paper, author: "van der Berg, Jan" }), /author = \{van der Berg, Jan\}/, "multi-word surname")
  assert.match(toBibTeX({ ...paper, author: "Jane Doe; John Smith" }), /author = \{Jane Doe and John Smith\}/, "semicolons")
}

// --- a captured file has no URL, and the exports must not invent one ---
{
  const local: Meta = { title: "Local Paper", url: "" }
  assert.doesNotMatch(toBibTeX(local), /\burl = /, "no empty BibTeX url")
  assert.doesNotMatch(toRIS(local), /^UR /m, "no empty RIS UR")
}

// --- a whole session exports with unique cite keys ---
{
  const a: Meta = { title: "Same Start One", url: "https://a.example/", author: "Doe, Jane", date: "2020" }
  const b: Meta = { title: "Same Start Two", url: "https://b.example/", author: "Doe, Jane", date: "2020" }
  const c: Meta = { title: "Other", url: "https://c.example/", author: "Roe, Rick", date: "2019" }
  const bib = toBibliography([a, b, c])
  const keys = [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1])
  assert.deepEqual(keys, ["Doe2020Same", "Doe2020Samea", "Roe2019Other"], "duplicates get a suffix, order kept")
}

// --- the DOI is found among several DC.Identifier tags ---
{
  const meta = metaFor(`<meta name="DC.Identifier" content="pmid:123"><meta name="DC.Identifier" content="doi:10.1000/found">`)
  assert.equal(meta.doi, "10.1000/found", "later identifier used")
}

// --- metadata from the page is one line by the time anything uses it ---
{
  const meta = metaFor(`<meta name="citation_journal_title" content="J&#10;ER  - ">`)
  assert.equal(meta.journal, "J ER -", "newline flattened at extraction")
}

// --- a captured file has no URL, so it can't be @online ---
assert.match(toBibTeX({ title: "Local", url: "" }), /^@misc\{/, "no url -> @misc")
assert.match(toRIS({ title: "Local", url: "" }), /^TY {2}- GEN/, "no url -> GEN")

// --- a brace in a URL can't close the field ---
assert.match(toBibTeX({ title: "T", url: "https://a.example/?q=}x" }), /url = \{https:\/\/a\.example\/\?q=%7Dx\}/, "brace encoded")

console.log("ok: all metadata checks passed")
