// Guards the one claim the README makes that users can't verify themselves:
// "No data leaves your browser — conversion is 100% local."
// This fails the build the moment a network call appears in first-party source,
// so the claim stays true by construction instead of by good intentions.
// Run: npm test
import assert from "node:assert"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

// tsx may run this as CJS or ESM depending on the resolved config; support both.
const HERE = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..")
const SKIP_DIRS = new Set(["node_modules", "build", ".plasmo", ".git", "docs", "assets"])
const SOURCE_EXT = new Set([".ts", ".tsx"])

// Anything that can reach the network from an extension context.
const NETWORK_PATTERNS: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch()"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bsendBeacon\s*\(/, "navigator.sendBeacon()"],
  [/\bEventSource\b/, "EventSource"],
  [/\bimportScripts\s*\(/, "importScripts()"],
  [/\bnavigator\.connection\b/, "navigator.connection"]
]

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (SOURCE_EXT.has(extname(entry)) && !entry.endsWith(".test.ts")) acc.push(full)
  }
  return acc
}

const files = sourceFiles(ROOT)
assert.ok(files.length >= 4, `expected to scan the source files, found ${files.length}`)

const violations: string[] = []
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    if (line.trim().startsWith("//")) return
    for (const [pattern, name] of NETWORK_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${file.replace(ROOT + "/", "")}:${i + 1} — ${name}`)
      }
    }
  })
}

assert.deepEqual(
  violations,
  [],
  "Network call found in extension source. The README promises conversion is 100% local — " +
    "either remove the call, or update the README and the store listing before shipping:\n  " +
    violations.join("\n  ")
)

// Manifest must not request host permissions that would enable remote calls.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const perms: string[] = pkg.manifest?.permissions ?? []
const REMOTE_PERMS = ["webRequest", "proxy", "declarativeNetRequest"]
const flagged = perms.filter((p) => REMOTE_PERMS.includes(p))
assert.deepEqual(flagged, [], `unexpected network-capable permission: ${flagged.join(", ")}`)

console.log(`ok: privacy check passed — ${files.length} source files, zero network calls`)
