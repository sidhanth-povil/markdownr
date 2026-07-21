# Agentic Workflow — Markdownr

**Owner: Claude.** I run this loop and I'm answerable for what ships. Sidhanth's only required inputs
are the browser-only tests (things headless can't reach) and product-direction calls. Everything else
— code, tests, monitoring, go/no-go — is mine.

## The two layers

### 1. Automatic guardrail (runs with no prompting) — settings.json hooks

| Hook | Fires | Does |
|---|---|---|
| `PostToolUse` (Edit\|Write) → `.claude/hooks/mark-dirty.sh` | every file edit | flags the turn as "code changed" if the file is `lib/*.ts`, `content.ts`, `background.ts`, `popup.tsx`, or `package.json` |
| `Stop` → `.claude/hooks/run-guard.sh` | end of every turn | if the flag is set, runs the full suite (`npm test`). Failure exits 2 and surfaces the error, so a regression can't be silently handed off. Green clears the flag. |

This is the real "monitor changes" mechanism: deterministic, unskippable, no model judgment required.
Verified working — a deliberately broken test made the Stop hook exit 2 and block. Manage via `/hooks`.

### 2. On-demand review agents — `.claude/monitoring/*.md`

Invoked (by me, or by you asking) via the Agent tool with the playbook file as the brief. These carry
judgment the hook can't: the live-DOM blind spots, permission justification, release go/no-go.

| Agent | Brief | Invoke before |
|---|---|---|
| **extraction-guardian** | `.claude/monitoring/extraction-guardian.md` | calling any `lib/convert.ts` / extraction change done |
| **privacy-sentinel** | `.claude/monitoring/privacy-sentinel.md` | any release, or any manifest/dependency change |
| **release-captain** | `.claude/monitoring/release-captain.md` | shipping a build or handing off "done" |

> Note: these live in `.claude/monitoring/`, not `.claude/agents/`, because this environment blocks
> direct writes to `.claude/agents/`. Functionally identical — invoke with the general-purpose agent
> and point it at the file. If you want them as first-class `/agents`, create them through the
> environment's mandated agent-creation path and paste these bodies in.

## The loop, per change

```
1. I make the change (code + a regression test pinned to the real case).
2. PostToolUse flags the turn.
3. I run `npm test` inline; the Stop hook re-runs it as a backstop.
4. If it touched extraction  -> extraction-guardian review.
   If it touched manifest/deps -> privacy-sentinel review.
5. Anything a headless test can't prove is logged in the plan as
   "requires manual browser verification" and routed to you.
6. Before a build ships -> release-captain gate (GO / GO-with-caveats / NO-GO).
```

## What I own vs what needs you

**Mine:** every code change, its test, running the guardrail, the three reviews, the release gate,
keeping README claims honest, the plan docs.

**Yours (headless can't do it):**
- Browser verification of anything in the plan marked so — currently: the hidden-content and
  accordion fixes behave per real CSS, and the `activeTab` download-filename check.
- The two wedge tests that gate the researcher-first repositioning claims: a logged-in page and
  `localhost` (see `repositioning-researcher-first.md`, Phase B).
- Product direction: which Phase C feature is next.

## Deployment reality (stated plainly)

There is **no git repo and no CI** here. "Deployment" = `npm run build` → load unpacked / Chrome Web
Store upload. So "monitor deployments" means: release-captain gates the build before it leaves, and
the manifest/README-match check is the closest thing to a deploy check available. If you want true
deploy monitoring, the prerequisite is `git init` + a CI workflow — say the word and I'll set both up.
