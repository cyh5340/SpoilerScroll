# SpoilerScroll

A Chrome extension that records qualified public Reddit previews and offers evidence-grounded spoilers for repeated information.

## Use it on Reddit

The extension and backend routes are connected. Behavior detection requires **live Keewano history reads**. Local extractive summaries supply content evidence; only views confirmed by Keewano can support a spoiler. The current `.env` has an ingestion key but lacks SQL-read credentials, so views are queued and detection is unavailable until read access is configured.

```sh
npm ci
npm run build
npm start
```

Keep that terminal open. The backend listens on `http://127.0.0.1:8787`.

```sh
cd extension
npm ci
npm run build
```

1. Open `chrome://extensions` and enable Developer mode.
2. If an earlier SpoilerScroll build was installed before stable identity was added, remove it once. Load unpacked and choose `SpoilerScroll/extension/dist`.
3. Open the toolbar popup → **Set up Reddit monitoring**. Accept public-preview processing and click **Allow Reddit and connect**. Pairing is automatic; no sponsor keys or pairing token need to be pasted.
4. Open `https://old.reddit.com/r/technology/` or `https://www.reddit.com/r/technology/`. Scroll through public posts, holding each preview half visible for at least 3 seconds in the active tab.
5. The popup's viewed count rises. Ready repeated-information matches receive a badge; a plain headline click shows the spoiler. Read anyway, Skip, feedback and Pause are available.

A spoiler is not guaranteed on arbitrary posts. The current local detector requires exact repeated evidence across three distinct prior viewed posts. Paraphrased articles on the same subject will usually be missed. This is an intentionally conservative real-data baseline, not a demonstration of semantic similarity. Private pages and incognito are excluded. Reddit selectors may change; old Reddit is the simpler first acceptance target.

**Try the local demo** is separate: scripted fixture content never reaches the backend or sponsors. It is useful for seeing the overlay immediately.

## Connected architecture

- `POST /pair` issues a private per-install token to the exact stable extension origin, after consent.
- `POST /observations` persists qualified exposures, prepares decisions, and queues ContentViewed events to Keewano.
- `POST /candidates` prepares evidence with zero dwell; it does not emit ContentViewed or enter consumed history.
- `GET /decisions?installId=...&observationId=...` returns cached decisions without model work.
- `POST /events` records spoiler outcomes.
- `GET /health` shows detector/history availability and the expected extension ID.

Every data route checks the paired install identity. The extension holds a dedicated local pairing token; Keewano and model credentials remain on the backend. Its manifest public key gives it the stable ID `okefejdjejhamecphdobcfhcmdekhmaj`.

Backend state is stored privately in `.data/app/`; the Keewano durable transport queue uses `KEEWANO_DATA_DIR`. Do not share that queue with another project key. A local queue acceptance is not proof of remote Keewano acceptance. Retries may duplicate analytics around a process crash or a lost outcome response; observation persistence is idempotent by install/observation ID.

## Keewano behavior history and optional model analysis

To enable configured model RPC analysis, set `MODEL_RPC_URL`, `MODEL_RPC_TOKEN`, `MODEL_NAME`, and `MODEL_REVISION`, then restart. This is the explicit operator-owned RPC contract in [content-pipeline.md](docs/content-pipeline.md), not an assumed vendor API. The current matcher remains conservative exact-claim matching even with model-generated retrieval vectors.

To enable Keewano history reads, set `KEEWANO_READ_EMAIL`, `KEEWANO_READ_PAT`, and `KEEWANO_PROJECT_ID`, then restart. SQL uses TLS and separate read authority; the ingestion key cannot grant it. Without those credentials or when the query fails, detection is unavailable. Local observations and pending analytics never substitute for Keewano-confirmed consumption. Keewano ingestion delay can postpone spoilers; local text and summaries are hydrated only through the exact summary IDs returned by Keewano. Live SQL/schema semantics still need verification when credentials are available.

Darwin discovery is wired as a fallback when local preview extraction is insufficient. Exact identities and discovery outcomes are recorded; no provider is executed without a verified adapter. Previously discovered providers offered no executable route. Missing model/read/provider access never becomes a fabricated success.

## Developer checks

```sh
npm run verify:wiring
npm run test:all
```

`verify:wiring` is a fast localhost HTTP check using isolated temporary data and mocked Keewano transport. It covers pairing, authorization, observations, candidate preparation, decisions, and view-event counts, without a browser or sponsor calls.

`test:all` runs the component suites plus headless extension fixture tests. Install Chromium with `cd extension && npx playwright install chromium` if needed, or set `CHROMIUM_PATH`. These checks do not replace trying actual Reddit DOM layouts.

[Extension details](extension/README.md) · [Design plan](docs/design-plan.md) · [Integrations](docs/integrations.md)
