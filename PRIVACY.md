# Privacy Policy — Markdownr

**Last updated: 2026-07-21**

Markdownr ("the extension") converts web pages into Markdown. This policy explains
exactly what it accesses and what happens to that data. The short version:

**The extension collects nothing, sends nothing, and stores nothing on any server.
All conversion happens locally in your browser.**

## What the extension accesses

- **The content of a page you choose to convert.** Only when you invoke the
  extension — by clicking the toolbar icon, pressing `Alt+M`, or using the
  right-click "Copy page as Markdown" menu — does it read the current page's HTML
  to convert it to Markdown. It does not read pages in the background, and it does
  not monitor your browsing.

## What happens to that content

- It is converted to Markdown **entirely on your device**, inside your browser.
- The result is placed where you asked for it: your **clipboard**, a **downloaded
  `.md` file**, or the extension's preview.
- The page content is **never transmitted anywhere.** The extension makes **zero
  network requests** — no analytics, no telemetry, no external servers, no third
  parties. This is verified automatically by an automated test in the source code
  that fails the build if any network call is ever introduced.

## What the extension stores

- **Your settings only** — the capture mode, toggles (images, links, frontmatter,
  absolute URLs), and any tags you enter — are saved using the browser's built-in
  `storage.sync`. This data stays in your browser and, if you have browser sync
  enabled, is synced through your own browser account (e.g. your Google account).
  It is **never sent to the developer** or anyone else.
- No page content, no browsing history, and no personal information is stored.

## Accounts, tracking, and third parties

- There are **no accounts** and no login.
- There is **no tracking, advertising, or profiling** of any kind.
- **No data is shared with or sold to any third party**, because no data is
  collected in the first place.

## Permissions and why they are needed

| Permission | Why |
|---|---|
| Access to the current tab / page content | To read the page you choose to convert |
| `storage` | To remember your settings and tags in your browser |
| `contextMenus` | To provide the right-click "Copy page as Markdown" option |
| `notifications` | To confirm a copy succeeded when using the right-click menu |

Nothing is requested that is not used, and none of these permissions are used to
collect or transmit your data.

## Changes to this policy

If this policy changes, the "Last updated" date above will change. Because the
extension's design is "everything stays on your device," any future version that
would send data off your device would require a new, clearly disclosed policy.

## Contact

Questions about privacy: **anil35612@gmail.com**
