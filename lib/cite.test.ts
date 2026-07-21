// Runnable check for the citation exporters. Run: npm test
import assert from "node:assert"
import { toBibTeX, toRIS } from "./cite"
import type { Meta } from "./convert"

const arxiv: Meta = {
  title: "Attention Is All You Need",
  url: "https://arxiv.org/abs/1706.03762",
  author: "Vaswani, Ashish",
  date: "2017/06/12",
  description: "The Transformer architecture."
}

// --- BibTeX ---
{
  const bib = toBibTeX(arxiv)
  assert.match(bib, /^@online\{Vaswani2017Attention,/, "cite key = surname + year + first title word")
  assert.match(bib, /author = \{Vaswani, Ashish\}/, "author preserved")
  assert.match(bib, /title = \{Attention Is All You Need\}/, "title")
  assert.match(bib, /year = \{2017\}/, "year pulled from date")
  assert.match(bib, /url = \{https:\/\/arxiv\.org\/abs\/1706\.03762\}/, "url unescaped and intact")
  assert.match(bib, /urldate = \{\d{4}-\d{2}-\d{2}\}/, "access date present")
  assert.ok(bib.trimEnd().endsWith("}"), "closes the entry")
}

// --- author splitting ---
{
  // Explicit "and" list -> multiple authors.
  const b1 = toBibTeX({ ...arxiv, author: "Doe, Jane and Smith, John" })
  assert.match(b1, /author = \{Doe, Jane and Smith, John\}/, "explicit 'and' list kept")

  // One comma is ambiguous: "Doe, Jane" (one person, Last-First) vs "Jane Doe, John Smith"
  // (two people). Our data resolves it: citation_author emits "Surname, Given" for a single
  // author, which is the dominant one-comma shape. So one comma = one "Last, First" author.
  const b2 = toBibTeX({ ...arxiv, author: "Vaswani, Ashish" })
  assert.match(b2, /author = \{Vaswani, Ashish\}/, "single 'Last, First' author kept whole")

  // Two+ commas with no "and" -> a comma-separated list of people.
  const b3 = toBibTeX({ ...arxiv, author: "Jane Doe, John Smith, Amy Lee" })
  assert.match(b3, /author = \{Jane Doe and John Smith and Amy Lee\}/, "comma list -> 'and' join")
}

// --- LaTeX specials in the title are escaped so the .bib doesn't break ---
{
  const bib = toBibTeX({ ...arxiv, title: "Cost & Scale: 100% of the $ Problem #1" })
  assert.match(bib, /title = \{Cost \\& Scale: 100\\% of the \\\$ Problem \\#1\}/, "specials escaped")
}

// --- missing metadata degrades cleanly, still valid ---
{
  const bib = toBibTeX({ title: "", url: "https://example.com/x" })
  assert.match(bib, /^@online\{/, "still an entry with no author/date")
  assert.match(bib, /url = \{https:\/\/example\.com\/x\}/, "url always present")
  assert.doesNotMatch(bib, /author = /, "no empty author field")
  assert.doesNotMatch(bib, /year = /, "no empty year field")
}

// --- RIS ---
{
  const ris = toRIS(arxiv)
  assert.match(ris, /^TY {2}- ELEC/m, "type tag")
  assert.match(ris, /^AU {2}- Vaswani, Ashish$/m, "author line")
  assert.match(ris, /^TI {2}- Attention Is All You Need$/m, "title line")
  assert.match(ris, /^PY {2}- 2017$/m, "year line")
  assert.match(ris, /^UR {2}- https:\/\/arxiv\.org\/abs\/1706\.03762$/m, "url line")
  assert.match(ris, /^ER {2}- $/m, "end-of-record tag")
  // one AU line per author
  const two = toRIS({ ...arxiv, author: "Doe, Jane and Smith, John" })
  assert.equal((two.match(/^AU {2}- /gm) || []).length, 2, "one AU per author")
}

console.log("ok: all citation checks passed")
