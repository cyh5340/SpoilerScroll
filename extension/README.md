# SpoilerScroll Chrome extension

Session 1 implementation. All source, tooling and documentation are isolated in `extension/`; root/backend files are unchanged.

## Load and try it

```sh
cd extension
npm ci
npm run build
```

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `SpoilerScroll/extension/dist`.
2. Open the SpoilerScroll toolbar popup and choose **Try the local demo**.
3. Keep each of the first three cards at least half visible in the focused tab for 3 seconds. The progress indicator reports qualified previews.
4. Scroll to card four, wait for the demo repetition badge, then click its headline (or focus it and press Enter).
5. Try Skip, Read anyway, feedback, Escape, or Pause. The fifth card introduces new information and receives no spoiler.

Fixture mode is explicitly labeled. It uses scripted decisions, no AI or sponsor calls, and skips the five-minute sustained-browsing gate. Only the fourth card matches the first three. Reset the demo to replay it; intervention cooldown is otherwise 60 seconds and each item is intercepted once per session.

The live site adapter supports public feed cards on `www.reddit.com` and `old.reddit.com`. It handles `shreddit-post`, older test-ID containers, and old Reddit `.thing.link` cards. Reddit selectors are subject to change and still require a signed-out live-site acceptance pass.

## Implemented

- Manifest V3 service worker, optional host permissions, and a 360px popup.
- Explicit consent and a dedicated backend pairing token before live monitoring.
- Public-feed allowlist; no profiles, inbox, chat, settings, post editors, or incognito support.
- IntersectionObserver qualification: at least 50% visible for 3 continuous seconds while document is visible and focused. Background verifies active tab/window too.
- Stable Reddit IDs, sanitized public URLs, bounded preview text, and no author/account details.
- Durable `chrome.storage.local` queue (max 500 pending items; 24-hour expiry on delivery), serialized state writes, background alarm retries, and same observation ID across retries.
- Separate live and fixture histories; ten-minute idle session boundary; session counters.
- Decision requests limited to two at once, cached per content snapshot, expiry checks, recycled-card checks, and no analysis on the navigation path.
- Scoped badge and native-modal overlay with screen reader labels, focus containment/restoration, Escape, feedback, pause, skip and read-anyway.
- Plain same-tab headline clicks and keyboard activations only; modified/middle clicks, new-tab links, downloads, votes and other links keep native behavior.
- Pause stops new capture and queued delivery. Already dispatched network requests may finish. Discard pending data clears only the local queue; remote history deletion is not claimed.

## Backend integration contract

Only `src/client.ts` knows HTTP endpoints. Requests originate in the service worker, use `credentials: omit`, no redirects, five-second timeouts, and:

```
Authorization: Bearer <dedicated pairing token>
Content-Type: application/json
```

Base URL is currently fixed to `http://127.0.0.1:8787`. Keep sponsor/model credentials on the server. Do not paste them into the popup.

### Required endpoints

`POST /observations`

```ts
{
  observationId: string; // stable UUID for idempotent retries
  installId: string;    // anonymous extension install UUID
  sessionId: string;    // browser session UUID, not the SDK's transport session
  contentId: string;    // reddit:<post ID>
  site: 'www.reddit.com' | 'old.reddit.com';
  url: string;          // public post permalink, tracking/query/hash removed
  title: string;        // max 500 characters
  visibleText: string;  // max 4000 characters
  scope: 'preview';
  dwellSeconds: 3;
}
```

Only qualified exposures reach this endpoint. The backend should idempotently persist by observationId, then own ContentViewed instrumentation and analysis. The extension deliberately does **not** also send ContentViewed to `/events`, to avoid double-counting. A 2xx means ownership has transferred to a durable backend queue/store. The backend must exclude the candidate itself from matching prior consumed content.

`GET /decisions?installId=...&observationId=...`

```ts
{
  status: 'pending' | 'ready' | 'unavailable';
  intervene: boolean;
  spoiler?: string;
  scope?: 'preview' | 'full';
  matchedContentIds: string[];
  reason?: string;
}
```

An intervention requires ready status, nonempty spoiler, scope, and matched prior IDs. The backend owns evidence validation, claim matching, sensitivity and the sustained-browsing gate. The extension imposes cooldown and once-per-item suppression. Missing/pending/failed decisions leave navigation unchanged. Until a separate candidate preparation endpoint exists, live decisions are queried by their persisted observation ID and exact evidence fingerprint; the backend may first learn an item from its qualified observation. The fixture can classify a candidate before its own dwell because the scripted content is already known locally. Pre-exposure candidate preparation is an explicit integration follow-up, not silently recorded consumption.

`POST /events`

```ts
{
  installId: string;
  contentId: string;
  site: 'www.reddit.com' | 'old.reddit.com';
  action: 'SpoilerShown' | 'SpoilerSkipped' | 'ReadAnyway' | 'FalsePositiveReported';
}
```

This is compatible with the existing analytics input shape. Network delivery is at least once: retries after a lost response could duplicate `/events` outcomes until the backend contract accepts an event/idempotency ID. Queued observations retain observationId for safe retries. This limit is important for interpreting metrics.

### Pairing and CORS handoff

The initial root backend rejects all Origin headers and does not implement `/observations`, `/decisions` or pairing. Its `/health` endpoint is not enough to enable live flow.

The integrator needs to:

- Configure a server-side pairing token and validate the Bearer header for **all** three endpoints.
- Allow only the loaded extension's exact `chrome-extension://<extension ID>` origin; handle preflight if Chrome sends it. Never use wildcard origins with this content API.
- Register the loaded extension ID, visible in `chrome://extensions`; development extension IDs may differ between checkouts.
- Return durable acceptance before 2xx for queued POSTs; document invalid/unauthorized responses. Current client retains failed deliveries, including 4xx, and shows the status instead of silently dropping data.
- Implement the history/summarization/decision modules and runtime gate in the backend.
- Define observation/event idempotency and a future non-consumption candidate preparation contract.

No extension permission is requested until the user explicitly enables Reddit. Permission includes only the two supported Reddit hosts and loopback; private paths are rejected in both content-script and worker policy. The script is dynamically registered after enablement and remains dormant while paused. Remote consent and permissions are rechecked by the worker before processing live observations.

## Checks

```sh
npm run typecheck
npm test
npx playwright install chromium  # if a compatible Chromium is not already installed
npm run test:browser
```

You may point `CHROMIUM_PATH` at an existing Chromium executable. Browser tests use a fresh temporary profile, load the actual extension, open the actual popup and fixture, and verify qualified previews, keyboard opening, modal focus/Escape, skip, read-anyway, new-information suppression, pause and zero remote fixture requests. They do not exercise actual Reddit or a real backend. Screenshots are written to ignored `dist/popup-preview.png`, `dist/demo-feed.png` and `dist/demo-spoiler.png`.

## Key files

- `src/background.ts`: consent/sender gates, storage, queue, sessions and global intervention claim.
- `src/content.ts`: visibility, adapter lifecycle, decision cache and navigation interception.
- `src/adapter.ts`: site and fixture DOM adapters.
- `src/overlay.ts`: scoped badge and accessible spoiler dialog.
- `src/popup.ts`, `public/popup.*`: setup, consent, mode, pause and pending-data UI.
- `src/client.ts`, `src/types.ts`: replaceable HTTP adapter and provisional contracts.
- `public/fixture.*`: labeled demo feed.

Contract reconciliation: the parallel content pipeline requires `site` to equal the public URL hostname and GET decisions by observationId. The adapter now sends the exact Reddit hostname, and the worker retains observation IDs plus evidence fingerprints. No stale decision is reused for changed evidence. This supersedes the initial provisional contentId query.

## Wiring update

The root backend now implements pairing, `/observations`, `/candidates`, `/decisions` and `/events`. This supersedes the initial unwired-backend and manual-token notes above. The popup pairs automatically after consent and site permission. The manifest public key establishes a stable extension ID; remove/reinstall an earlier unpacked build once if its ID differs.

Candidate preparation now posts an observation-shaped body with `dwellSeconds: 0` to `/candidates`. Its ID is scoped to the evidence fingerprint and current viewed-count/session, so new qualified exposures cause comparison refresh. Candidate records never emit ContentViewed. Qualified observations use their own UUIDs and `/observations`, and trigger Keewano ingestion once transferred to durable backend storage. No full text or private pages are fetched by the extension.

Real Reddit requires live Keewano-confirmed qualified exposures for detection. Local summaries provide evidence, but local-only exposures cannot trigger spoilers. With ingestion-only credentials, detection is unavailable. The root README has the current human browsing instructions.
