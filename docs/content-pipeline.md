# Content pipeline integration

Implemented modules are exported from `server/content/index.ts` and `server/decisions/index.ts`. No server route is wired yet. No new dependencies: Node 22+ built-ins, existing TypeScript and Node types suffice. No vendor SDK or credential is embedded.

## Wiring

```ts
import { ContentStore, HttpModelProvider, FixtureProvider } from './content/index.js';
import { DecisionPipeline, createDecisionHandlers } from './decisions/index.js';

const store = new ContentStore('/private/persistent/spoilerscroll/content.json');
// Choose explicitly; never automatically fall back to fixtures.
const provider = new FixtureProvider();
// Production alternative:
// const provider = new HttpModelProvider({ endpoint: process.env.MODEL_RPC_URL!,
//   token: process.env.MODEL_RPC_TOKEN!, model: process.env.MODEL_NAME!,
//   revision: process.env.MODEL_REVISION! });
const pipeline = new DecisionPipeline(store, provider, historyLookup);
await pipeline.drain(); // resume durable pending work on startup
const { postObservations, getDecisions } = createDecisionHandlers(pipeline);
```

Host routes POST `/observations` to `postObservations(req,res)` and GET `/decisions?installId=...&observationId=...` to `getDecisions(req,res)`. POST accepts the provisional Observation exactly, with unknown fields rejected; returns 202 with a Decision after durable acceptance, usually pending. Same install/observation ID and identical normalized payload are idempotent; different evidence or scope returns 409. Allocate a fresh observation ID for a changed DOM card or preview-to-full upgrade. Invalid input returns 400, wrong media type 415, oversized body 413, persistence failure 503. GET returns a cached Decision or unavailable; it never calls a provider, history service, or schedules recomputation. Pending/unavailable/expired decisions must allow navigation. Preload decisions in the extension before clicks; a click handler reads its local cache.

The host MUST enforce installation authorization (including query parameters and POST body), extension pairing, site permissions, remote-processing consent, public-page eligibility, rate limits, and pause before routing. These handlers are not a standalone public API. URL validation checks HTTP(S), matching site hostname, and absence of embedded credentials; it cannot establish that a page is public. URLs are never fetched by this module; fragments and common tracking query parameters are stripped. Render all titles, quotes and spoilers as text, never HTML. Consent and exclusion enforcement belong to integration, not the model.

## Required history interface

`HistoryLookup.lookup({installId, sessionId, before}) -> Promise<HistorySnapshot>` is injectable and owned by the Keewano session. Snapshot:

```ts
{
  status: 'ready' | 'unavailable',
  source: 'keewano' | 'fixture' | 'cache',
  fetchedAt: string, // ISO timestamp, actual query/cache retrieval provenance
  queryId?: string, // stable query reference, no credentials
  viewed: [{ observationId, contentId, scope: 'preview' | 'full' }]
}
```

Return ONLY qualified consumed exposures belonging to the requested install, strictly before the supplied timestamp. Candidate preparation is not consumption; zero/short dwell previews must not be promoted by this pipeline. The history owner applies dwell/sequence policy and merges pending qualified local exposures by event ID to cover ingestion lag. Observation IDs must resolve to content-store records; another session must retain this mapping when ingesting typed content/summary references. Missing local evidence is ignored, never reconstructed from topic labels. The pipeline verifies install ownership, content ID and exact observation scope, excludes the candidate's content ID, and checks that stored records predate it. Repeated observations of one content ID count once toward the default three distinct prior items.

Return unavailable on failed/unauthorized reads. Cached qualified history may use source cache, preserving its original freshness timestamp and query ID; do not claim it is a live Keewano read. Snapshots older than five minutes (configurable `historyMaxAgeMs`) suppress intervention. A real-model pipeline rejects fixture history. Snapshot and matched evidence references persist with decisions. A live read must still be verified during integration; none was exercised here.

## Provider contract and grounding

`ModelProvider` exposes `mode`, `name`, `revision`, and `understand(observation) -> Understanding`. Implement an operator-owned HTTPS RPC adapter to your selected backend model, or inject another provider. HttpModelProvider sends a bearer token, model name, task `scoped-extractive-claims-and-embedding-v1`, fixed instructions and an evidence object containing only visible text and scope. This is a custom adapter contract, not an assumed vendor API. Required response:

```json
{"summary":"Exact evidence excerpt.","claims":[{"id":"c1","quote":"Exact evidence excerpt."}],"embedding":[0.2,0.7],"complete":true}
```

The adapter must generate semantic embeddings consistently for a model/revision and extract atomic claim quotes, including caveats, new numbers, changed dates, sources and new results. Treat supplied text as hostile data, including instructions it contains; no tools, browsing, URL execution or credentials are exposed. The code requires every summary/quote to occur verbatim in supplied evidence, finite nonzero vectors, bounded arrays, unique claim IDs, and full substantive quote coverage before allowing intervention. A provider complete flag alone is insufficient. Unknown/omitted evidence suppresses intervention. Provider timeout/invalid output/network errors become unavailable, never a synthetic success. HTTP calls time out at 15 seconds by default, refuse redirects, and bound output size. Injected provider and history calls have a 20-second pipeline deadline; injected implementations should also support their own cancellation to release external resources.

Embeddings rank up to 50 qualified history records with cosine similarity. They never prove repetition. The conservative first implementation requires exact matching quoted claims (outer whitespace ignored), every candidate claim matched, complete evidence coverage, and three distinct matching content IDs. Thus topic similarity and changed numbers cannot trigger; paraphrased repetition is deliberately a false negative. A later entailment assessor must preserve novelty/unknown suppression and evidence provenance before broadening this rule. A model that quotes an entire article as one claim remains safe but less useful for retrieval/matching.

Spoilers quote the candidate evidence, retain preview/full scope and explicitly say when only a preview was read. Summary is stored separately; provider prose cannot become an ungrounded spoiler. Scope full means the submitted extracted text, not independently verified completeness of the remote page. It is the extractor's responsibility to label partial evidence preview. Truncated spoiler excerpts do not imply omitted text is repeated; all claims must already qualify.

FixtureProvider is explicitly constructed, uses sentence extraction and hashed word vectors (not semantic model output), and marks all resulting ready decisions and spoilers `[Fixture mode]`. Provenance records mode fixture. Never silently substitute it after real-provider failure, and never advertise its vectors or summaries as live model results.

## Durability, limits and lifecycle

ContentStore persists observations, original scoped text, extractive summaries, claims, vectors, timestamps, SHA-256 evidence hashes and provider/revision provenance. SHA-256 install/observation keys prevent path traversal. Updates serialize through a single writer, create private files, fsync, atomically rename snapshots and fsync the directory. Use one ContentStore instance and one service process per path on a local persistent filesystem. Multi-process writers, distributed locking, encryption, database-scale indexing and authenticated store tamper protection are not implemented. Corrupt stores fail closed; there is no silent reset. Snapshot writes scale with the complete store, so a production deployment needs retention and a database migration. Failed writes may leave private temporary files for operator cleanup.

One background worker bounds concurrent model calls to one; accepted pending jobs survive process restart. Startup calls drain; GET remains cache-only. Decisions expire after five minutes by default (`ttlMs`); unavailable failures also cache until expiry. Expiry does not automatically retry or refresh old observations. Submit a new observation ID when preparing a fresh decision/history snapshot. Immutable provider configuration/revision is expected for a pipeline instance. `minMatches`, `maxCandidates`, `ttlMs`, and `historyMaxAgeMs` accept positive integers.

`await store.clearInstall(installId)` removes that installation's content and decisions. In-flight updates check the record still exists before publishing. Integration must stop accepting new work for that install while clearing, clear extension caches/queues, and separately report Keewano deletion status. No remote deletion is implied. The observation log contains sensitive browsing text: deploy in a private persistent directory and apply agreed retention. No dwell is inferred as proof of reading within this module.

## Validation and remaining integration

Commands used (temporary compiler output avoids modifying other sessions' paths):

```sh
npm run typecheck
./node_modules/.bin/tsc --outDir /tmp/spoilerscroll-content-check
node --test /tmp/spoilerscroll-content-check/decisions/pipeline.test.js
```

Seven credential-free tests cover repeated claims, same-topic new information, appended new evidence, preview/full isolation, failed providers, unknown grounding, cached restart behavior, installation isolation, idempotency, clearing, history failure and durable pending recovery. These tests use explicitly labeled fixtures and fake history; they do not verify a live LLM, Keewano query, browser click flow or remote extractor. Root npm test currently only selects analytics tests; the integrating session should add this test file to its test command.

Required next integration: wire authenticated routes in server/index.ts; inject qualified Keewano history with observation-ID mappings and provenance; configure/verify the model RPC; connect prefetch and extension cache; coordinate consent/pause/clear-history lifecycle; persist trusted extraction agent/revision provenance when external extractors are added. Observation currently supports local DOM evidence only; provider provenance is not a fabricated Darwin execution identity.
