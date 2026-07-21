// Runnable check for the multi-tab combiner. Run: npm test
import assert from "node:assert"
import { combineTabs, type TabCapture } from "./batch"

const caps: TabCapture[] = [
  { meta: { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" }, markdown: "# Attention\n\nThe Transformer." },
  { meta: { title: "The Model Is Not The Product", url: "https://sub.example.com/p/x" }, markdown: "Most AI products fail." },
  { meta: { title: "", url: "https://no-title.example.com/" }, markdown: "Body without a title." }
]

const doc = combineTabs(caps)

// header + count
assert.match(doc, /^# Captured sources \(3\) — \d{4}-\d{2}-\d{2}/, "header shows the count and date")

// table of contents with links, in order
assert.match(doc, /1\. \[Attention Is All You Need\]\(https:\/\/arxiv\.org\/abs\/1706\.03762\)/, "TOC entry 1")
assert.match(doc, /2\. \[The Model Is Not The Product\]\(https:\/\/sub\.example\.com\/p\/x\)/, "TOC entry 2")

// numbered sections, each with a Source line and its body
assert.match(doc, /## 1\. Attention Is All You Need\n\nSource: https:\/\/arxiv\.org\/abs\/1706\.03762\n\n# Attention/, "section 1 header + source + body")
assert.match(doc, /## 2\. The Model Is Not The Product\n\nSource: https:\/\/sub\.example\.com\/p\/x/, "section 2")
assert.ok(doc.includes("Most AI products fail."), "section 2 body present")

// missing title falls back to the URL, never blank
assert.match(doc, /## 3\. https:\/\/no-title\.example\.com\//, "untitled source falls back to url")

// sources separated by a horizontal rule
assert.equal((doc.match(/\n---\n/g) || []).length, 3, "one rule after TOC + one between each of 3 sections' 2 gaps = 3")

// ordering preserved
assert.ok(doc.indexOf("## 1.") < doc.indexOf("## 2.") && doc.indexOf("## 2.") < doc.indexOf("## 3."), "sections in tab order")

// single capture still well-formed
const one = combineTabs([caps[0]])
assert.match(one, /^# Captured sources \(1\) —/, "single-tab header")
assert.match(one, /## 1\. Attention Is All You Need/, "single-tab section")

console.log("ok: all batch checks passed")
