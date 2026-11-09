// Custom frontmatter fields and vault-safe filenames. Run: npm test
import assert from "node:assert"

import { applyTags, applyTemplate, buildFrontmatter, extractDoi, finishMarkdown, singleLineMeta, vaultFilename, type Meta } from "./frontmatter"

const meta: Meta = {
  title: 'He said "hi"',
  url: "https://www.example.com/a/b",
  author: "Doe, Jane",
  doi: "10.1000/abc"
}
const base = buildFrontmatter(meta) + "Body\n"

// --- literal values pass through; placeholders are quoted and escaped ---
{
  const out = applyTemplate(base, "status: to-read\nrating: 5\nsource: {{domain}}\nheadline: {{title}}", meta)
  assert.match(out, /^status: to-read$/m, "literal value untouched")
  assert.match(out, /^rating: 5$/m, "number stays a number")
  assert.match(out, /^source: "www\.example\.com"$/m, "domain placeholder")
  assert.match(out, /^headline: "He said \\"hi\\""$/m, "page text cannot break the YAML")
  assert.ok(out.indexOf("status:") < out.indexOf("\n---\nBody"), "fields land inside the block")
  assert.ok(out.endsWith("---\nBody\n"), "body untouched")
}

// --- a value from the page cannot inject a new key ---
{
  const hostile: Meta = { ...meta, title: 'x"\nadmin: true' }
  const out = applyTemplate(buildFrontmatter(hostile) + "B\n", "headline: {{title}}", hostile)
  assert.doesNotMatch(out, /^admin: true/m, "newline in a value stays escaped")
}

// --- empty placeholder drops the line; unknown placeholder is empty ---
{
  const noDoi: Meta = { title: "T", url: "https://a.example/" }
  const out = applyTemplate(buildFrontmatter(noDoi) + "B\n", "ref: {{doi}}\nbad: {{nope}}\nkeep: yes", noDoi)
  assert.doesNotMatch(out, /^ref:/m, "missing value omitted")
  assert.doesNotMatch(out, /^bad:/m, "unknown placeholder omitted")
  assert.match(out, /^keep: yes$/m)
}

// --- duplicate keys would be invalid YAML, junk lines are ignored ---
{
  const out = applyTemplate(base, "title: mine\nfoo: 1\nfoo: 2\nnot a field\n: nope\n# comment", meta)
  assert.equal((out.match(/^title:/gm) || []).length, 1, "existing key not duplicated")
  assert.equal((out.match(/^foo:/gm) || []).length, 1, "template key not duplicated")
  assert.doesNotMatch(out, /not a field|nope|# comment/, "invalid lines ignored")
}

// --- no frontmatter block: nothing to add to ---
assert.equal(applyTemplate("Body\n", "a: 1", meta), "Body\n", "no block -> unchanged")
assert.equal(applyTemplate(base, "", meta), base, "empty template -> unchanged")

// --- tags typed in the popup win over a template tags line ---
{
  const out = finishMarkdown(base, "research", "tags: [from-template]\nstatus: new", meta)
  assert.match(out, /^tags: \[research\]$/m, "typed tags used")
  assert.equal((out.match(/^tags:/gm) || []).length, 1, "only one tags key")
  assert.match(out, /^status: new$/m, "other fields still applied")
  assert.match(finishMarkdown(base, "", "tags: [from-template]", meta), /^tags: \[from-template\]$/m, "template tags otherwise")
  assert.equal(finishMarkdown(base, "", "", meta), applyTags(base, ""), "no settings -> unchanged")
}

// --- files have no URL line ---
{
  const fm = buildFrontmatter({ title: "Local", url: "", file: "paper.pdf" })
  assert.doesNotMatch(fm, /^url:/m, "no empty url")
  assert.match(fm, /^file: "paper\.pdf"$/m, "file recorded")
}

// --- filenames ---
assert.equal(vaultFilename("Attention Is All You Need"), "Attention Is All You Need", "plain title kept")
assert.equal(vaultFilename('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), "a b c d e f g h i j k l m n", "link and OS-breaking characters removed")
assert.equal(vaultFilename("...hidden"), "hidden", "no leading dots")
assert.equal(vaultFilename("trailing. . "), "trailing", "no trailing dots or spaces")
assert.equal(vaultFilename("CON"), "CON_", "Windows reserved name")
assert.equal(vaultFilename("   "), "page", "blank falls back")
assert.ok([...vaultFilename("😀".repeat(200))].length <= 120, "length capped without splitting characters")
assert.ok(!vaultFilename("😀".repeat(200)).includes("�"), "no broken surrogate")

// --- DOI finder ---
assert.equal(extractDoi("doi:10.1234/abc.def."), "10.1234/abc.def", "prefix and trailing dot removed")
assert.equal(extractDoi("https://doi.org/10.1234/ABC(1)2"), "10.1234/ABC(1)2", "balanced brackets kept")
assert.equal(extractDoi("(see 10.1234/abc)"), "10.1234/abc", "closing bracket outside the DOI dropped")
assert.equal(extractDoi("page 10.5 of 20"), undefined, "not a DOI")

// --- a body that opens with a rule is not a frontmatter block ---
{
  const body = "---\n\nhello\n\n---\n\nx\n"
  assert.equal(finishMarkdown(body, "foo", "a: 1", meta), body, "Frontmatter off: tags and fields stay out of the body")
}

// --- page text is flattened to one line, and YAML-hostile characters can't get through ---
{
  const flat = singleLineMeta({ title: "x\nER  - \nTY  - ELEC", url: "u", author: "A\n# Injected" })
  assert.equal(flat.title, "x ER - TY - ELEC", "newlines collapsed")
  assert.equal(flat.author, "A # Injected", "no injected line")
  assert.equal(buildFrontmatter({ title: "a\u0000b c", url: "u" }).split("\n")[1], 'title: "a b c"', "control characters replaced")
}

// --- a DOI can't close its BibTeX field ---
assert.equal(extractDoi("10.1234/x},year={1999}"), "10.1234/x", "stops at a brace")

console.log("ok: all frontmatter checks passed")
