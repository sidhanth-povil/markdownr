// PDF layout -> Markdown, on positioned text items like the ones pdf.js returns. Run: npm test
import assert from "node:assert"

import { pagesToMarkdown, pdfMeta, type PdfItem, type PdfPage } from "./pdf"

const W = 612
const H = 792
const item = (text: string, x: number, y: number, size = 10, width = text.length * size * 0.5): PdfItem => ({
  text, x, y, size, width
})
const page = (items: PdfItem[]): PdfPage => ({ width: W, height: H, items })

// Lines of `n` body rows starting at y, 12pt apart.
const rows = (prefix: string, x: number, y: number, n: number, chars = 44) =>
  Array.from({ length: n }, (_, i) => item(`${prefix}${i}`.padEnd(chars, "x"), x, y - i * 12))

// --- paragraphs join, a blank gap splits ---
{
  const md = pagesToMarkdown([
    page([item("First line of text", 72, 700), item("continues here.", 72, 688), item("Second paragraph.", 72, 660)])
  ])
  assert.equal(md, "First line of text continues here.\n\nSecond paragraph.\n")
}

// --- hyphenated line breaks are repaired ---
assert.equal(pagesToMarkdown([page([item("An exam-", 72, 700), item("ple of it.", 72, 688)])]), "An example of it.\n")

// --- items on one line join; adjacent runs get no invented space ---
{
  const md = pagesToMarkdown([page([item("Hel", 72, 700, 10, 15), item("lo", 87, 700, 10, 10), item("world", 100, 700, 10, 25)])])
  assert.equal(md, "Hello world\n")
}

// --- two columns read left then right; spanning title comes first ---
{
  const left = rows("left", 72, 640, 30, 44)
  const right = rows("right", 330, 640, 30, 44)
  const md = pagesToMarkdown([
    page([item("A Paper Title That Spans the Whole Page Width Here", 72, 720, 20, 468), ...right, ...left])
  ])
  const pos = (s: string) => md.indexOf(s)
  assert.match(md, /^# A Paper Title/, "title first, as a heading")
  assert.ok(pos("left0") < pos("left29"), "left column in order")
  assert.ok(pos("left29") < pos("right0"), "left column finishes before right starts")
  assert.ok(pos("right0") < pos("right29"), "right column in order")
}

// --- a single-column page is not split, even with a table-like row ---
{
  const md = pagesToMarkdown([page([...rows("body", 72, 700, 20, 90)])])
  assert.equal(md.trim().split("\n\n").length, 1, "one flowing paragraph")
}

// --- headers, footers and page numbers are removed; body stays ---
{
  const pages = [1, 2, 3, 4].map((n) =>
    page([
      item(`Journal of Tests, Vol ${n}`, 72, 760),
      item(`Body of page ${n} ends here.`, 72, 400),
      item(String(n), 300, 30)
    ])
  )
  const md = pagesToMarkdown(pages)
  assert.doesNotMatch(md, /Journal of Tests/, "running header removed")
  assert.doesNotMatch(md, /^\d$/m, "page numbers removed")
  assert.match(md, /Body of page 4 ends here\./, "body kept")
}

// --- a repeated line in the BODY is not a header ---
{
  const pages = [1, 2, 3, 4].map(() => page([item("Repeated body sentence.", 72, 400)]))
  assert.equal((pagesToMarkdown(pages).match(/Repeated body sentence/g) || []).length, 4, "body repeats kept")
}

// --- rotated margin stamps are dropped by the reader; a sentence runs across pages ---
{
  const md = pagesToMarkdown([
    page([item("This sentence keeps", 72, 100)]),
    page([item("going on the next page.", 72, 700)])
  ])
  assert.equal(md, "This sentence keeps going on the next page.\n", "continuation joined across pages")
}

// --- headings by size, numbering, and well-known names ---
{
  const md = pagesToMarkdown([
    page([
      item("Big Title Of Paper", 72, 740, 22),
      item("Abstract", 72, 700),
      item("This is the abstract body text that ends properly.", 72, 680),
      item("1 Introduction", 72, 640),
      item("Body sentence of the introduction section is here.", 72, 620),
      item("2.1 Method Details", 72, 580),
      item("More body text of the method section goes here.", 72, 560),
      item("The year 2019 was good", 72, 520),
      item("References", 72, 480)
    ])
  ])
  assert.match(md, /^# Big Title Of Paper$/m, "size -> title")
  assert.match(md, /^## Abstract$/m, "known section name")
  assert.match(md, /^## 1 Introduction$/m, "numbered section")
  assert.match(md, /^### 2\.1 Method Details$/m, "numbered subsection")
  assert.match(md, /^## References$/m, "references")
  assert.doesNotMatch(md, /^#+ The year 2019/m, "ordinary sentence is not a heading")
}

// --- bullets become list items; a leading # cannot become a heading ---
{
  const md = pagesToMarkdown([page([item("• First point", 72, 700), item("• Second point", 72, 688), item("# not a heading.", 72, 660)])])
  assert.match(md, /^- First point\n\n- Second point$/m, "bullets")
  assert.match(md, /^\\# not a heading\.$/m, "markdown marker escaped")
}

assert.equal(pagesToMarkdown([page([])]), "", "no text -> empty string")

// --- oversized figure labels late in the paper are neither the title nor headings ---
{
  const filler = Array.from({ length: 14 }, (_, i) => page([item(`Body paragraph number ${i} ends here.`, 72, 400)]))
  const md = pagesToMarkdown([
    page([item("The Real Title", 72, 700, 18), item("Body text of the first page ends here.", 72, 660)]),
    ...filler,
    page([item("Input Layer5", 72, 600, 30)]),
    page([item("Input Layer5", 72, 600, 30)])
  ])
  assert.match(md, /^# The Real Title$/m, "title found near the start")
  assert.doesNotMatch(md, /^#+ Input Layer5/m, "repeated figure label is not a heading")
}

// --- author names are not sections; stacked numbered headings stay separate; lowercase labels aren't headings ---
{
  const md = pagesToMarkdown([
    page([
      item("The Paper Title", 72, 740, 20),
      item("Jane Doe", 72, 700, 13),
      item("Abstract", 72, 660),
      item("Abstract body text is written here and it ends.", 72, 640),
      item("3. Method", 72, 600),
      item("3.1. Setup", 72, 588),
      item("Method body text is written here and it ends.", 72, 560),
      item("method", 72, 520, 13)
    ])
  ])
  assert.doesNotMatch(md, /^#+ Jane Doe/m, "byline is plain text")
  assert.match(md, /^Jane Doe$/m, "byline kept")
  assert.match(md, /^## 3\. Method$/m, "first numbered heading")
  assert.match(md, /^### 3\.1\. Setup$/m, "second numbered heading")
  assert.doesNotMatch(md, /^#+ method/m, "lowercase table label is not a heading")
}

// --- text in a PDF can't become live Markdown or HTML ---
{
  const md = pagesToMarkdown([
    page([
      item("![](https://attacker.example/p.png)", 72, 700),
      item("[click](javascript:alert(1))", 72, 660),
      item("<img src=x onerror=alert(1)>", 72, 620),
      item("- not a bullet.", 72, 580),
      item("3. not a list.", 72, 540),
      item("---", 72, 500)
    ])
  ])
  assert.match(md, /^!\\\[\\\]\(https/m, "image syntax escaped")
  assert.match(md, /^\\\[click\\\]\(javascript/m, "link syntax escaped")
  assert.match(md, /^\\<img/m, "HTML escaped")
  assert.match(md, /^\\- not a bullet\.$/m, "dash escaped")
  assert.match(md, /^3\\\. not a list\.$/m, "number escaped")
  assert.match(md, /^\\---$/m, "rule escaped")
}

// --- escaping doesn't leak into a DOI or title read from the text ---
{
  const body = pagesToMarkdown([page([item("Snake_case Title Here", 72, 740, 20), item("See doi:10.1234/ab_cd for more.", 72, 700)])])
  const m = pdfMeta({}, body, "f.pdf")
  assert.equal(m.title, "Snake_case Title Here", "title unescaped")
  assert.equal(m.doi, "10.1234/ab_cd", "DOI unescaped")
}

// --- metadata ---
{
  const m = pdfMeta({ title: "Real Title", author: "Doe, Jane" }, "# Other\n\ndoi: 10.1234/abc\n", "file.pdf")
  assert.deepEqual(
    { title: m.title, author: m.author, date: m.date, doi: m.doi, url: m.url, file: m.file },
    { title: "Real Title", author: "Doe, Jane", date: undefined, doi: "10.1234/abc", url: "", file: "file.pdf" }
  )
  assert.equal(pdfMeta({ title: "Microsoft Word - draft7.docx" }, "# Heading Title\n\nBody\n", "f.pdf").title, "Heading Title", "junk title -> first heading")
  assert.equal(pdfMeta({}, "Body only\n", "My Paper.PDF").title, "My Paper", "no title -> filename")
}

console.log("ok: all pdf checks passed")
