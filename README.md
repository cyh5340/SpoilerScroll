# SpoilerScroll

A Chrome extension that flags posts and headlines, on any site, that look like pages you have already opened. It compares each post's title and visible text with the titles in your Chrome history. If you click a flagged post, a full-page notice lists the matching history pages before you decide to read it or skip it.

Everything runs in the extension. Nothing is sent anywhere.

## How matching works

Matching is plain word comparison: identical strings only, no stemming or fuzzy matching.

- **What is checked:** every `http(s)` link on the page except those in menus, page headers and footers, plus Reddit's post cards. When several links go to the same address (e.g. a search result's site-name link and its headline), the one with the longest text is its title.
- **Text that is compared:** the link's text as its title, plus up to 2,000 characters of visible text around it (the article, list item or parent). History only stores page titles, so that is what's on the other side. Every history page in the time range is used, titled or not.
- **The rule:** text is lowercased and split on anything that isn't a letter or digit. Common words ("the", "to", "what", "reddit", …) and single letters are ignored; everything else counts. Each word the history title shares with the post's **title** scores 1. Each word it shares only with the post's **visible text** scores ½. A history page matches when its score reaches **N**. Words must be identical: no stemming and no fuzzy matching.
- Only history from the chosen **time range** (1, 7 or 30 days) is searched.
- If the post itself is in your history, it always matches, including across `www`/`old.reddit.com` and different URL slugs. It is listed first as "this post".
- The page you are on is never matched against itself: not its URL, and not a history page with exactly its title (search engines add parameters to the URL after you click a result).

N defaults to 3 and the range to 7 days. You can change both in the popup. At N = 3, a match needs 3 shared title words, 2 title words plus 2 text words, or 6 text words. Raise N (up to 10) if too much gets flagged, or lower it to 2 to catch looser matches.

## What you see

- **Badge** on each matching post: "Similar to 3 pages in your history".
- **Bottom-right notice** with the count for the page while SpoilerScroll is on: "2 of 35 links here match pages from your history (last 7 days)".
- **Full-page notice** when you click a flagged post. It lists each matching history page with its URL, when you visited it, and the shared words, marked as title or text. You can choose **Skip this**, **Read anyway** or **Pause SpoilerScroll**. Every way of opening a flagged link is caught: plain click, links that open a new tab, Ctrl/⌘/Shift-click and middle click. **Read anyway** opens it the way you meant (same tab or new tab). Links with no match open normally.

## Install

```sh
cd extension
npm ci
npm run build
```

1. Open `chrome://extensions`, enable Developer mode, then **Load unpacked** and choose `extension/dist`.
2. Click the toolbar icon. While the pill says **Off**, the main button is **Turn on: allow sites and history**. Click it and accept Chrome's prompt; the pill turns **On**.
3. Refresh the pages you have open. A dark box in the bottom-right corner shows how many links on the page match your history. No box means SpoilerScroll is not running on that page.

A scripted demo page, which never reads your real history, is at `chrome-extension://<extension id>/fixture.html`.

Permissions are optional and requested only when you turn it on: `history` and access to all `http`/`https` sites. Incognito is excluded.

On real sites, the badge, notice and overlay use closed shadow roots, so the site's own page scripts cannot read the history titles or URLs shown to you.

## Checks

```sh
cd extension
npm run typecheck
npm test               # matcher and URL/navigation policy unit tests
npm run test:browser   # headless Chromium; npx playwright install chromium if needed, or set CHROMIUM_PATH
```

The browser test covers two things. It runs the demo with scripted history. It also checks real `chrome.history` matching on an old-Reddit feed and a generic news page. Playwright serves stand-in Reddit, YouTube and news pages so actual history entries exist without network access. On the news page, one post matches only through its preview text, a menu link that would match is ignored, and new-tab links and Ctrl/⌘-clicks are caught. That test copy of the extension gets the optional permissions up front, since headless Chrome cannot click permission prompts. It was also run once by hand against live Bing for “Apple Welcome Home Event”: after one result was read, clicking related results showed the notice.

## Layout

- `extension/src/match.ts`: word extraction, URL canonicalisation, `findMatches`.
- `extension/src/background.ts`: settings, permissions, `chrome.history` lookup (cached 5 s), demo history.
- `extension/src/content.ts`: finds posts, asks for matches, renders badges/notice, intercepts clicks.
- `extension/src/overlay.ts`: badge, bottom-right notice, full-page notice.
- `extension/src/adapter.ts`: post extraction (Reddit cards, generic headline links, demo cards).
- `extension/src/policy.ts`: supported pages, Reddit URL cleanup, which clicks may be intercepted.
- `extension/public/`: manifest, popup, demo page.

[Original design plan](docs/design-plan.md) (hackathon-era, superseded)
