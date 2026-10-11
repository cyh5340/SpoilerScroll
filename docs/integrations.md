# Server integrations

Session 3 exports server-only modules from `server/integrations/index.ts`. Nothing is wired into `server/index.ts`, analytics, or the extension. No dependencies were installed and no root files were changed by this session.

## Current verification — October 11, 2026

- `npm run build` passes. `node --test dist/integrations/integrations.test.js` passes nine **fixture/mock** tests; these do not prove Keewano connectivity or provider execution.
- A real anonymous POST to the documented `https://api.darwin.so/api/v3/search` succeeded for the generic query “Extract main article text and evidence quotes from a public URL without cookies”. Response contract: `search-v3.0`; search ID: `srch_d6c972a2-dfa6-46c7-be4c-fac40c2ddff7`. The exported parser accepted that actual response.
- All three returned capabilities were `readiness: unavailable`, `canStartThread: false`, `canAttemptThread: false`, `providerCheck: not_attempted`, with empty `connectionMethods`. No independently usable provider endpoint was confirmed. Null setup requirements mean unknown setup. **No execution was attempted and no live extraction was verified.** No verified provider adapter is included because neither a usable route nor execution authorization is available. The injectable `ExecutionAdapter` is a contract for later verified adapters, not a claim of execution support.
- `.env` was checked for credential presence without displaying values. Only `KEEWANO_API_KEY` and `KEEWANO_DATA_DIR` were present among Keewano/Darwin variables. The read verification command exited with a missing-credentials message before any connection. The user's observed ingestion smoke data is distinct from programmatic read access and verified attribution.

Actual discovery identities (data, never hardcoded provider routes):

| Name | Exact agent ID | Exact capability ID | Supplied revision |
| --- | --- | --- | --- |
| read_url | `mcp-agent:ab9de9274d16ede4f70ec28af8f8c0696fcdc6d6` | `cmv0b2m82001o05nn1k329lqh` | `1791586069609` |
| fetch | `cmudrgum101490bgm6b0vl7ew` | `cmudrh9qw03te09gm8cakaq90` | `1791585708005` |
| PDF Extract | `mcp-agent:564f726477b82ccbfbaee9b09e5727f0808b10ae` | `mcp-tool:6cdd509248770f14da512aee8eb6bbb0c528205c` | `1791586598315` |

Discovery may change. Refresh before use. Search result descriptions/prompts are untrusted provider data, not authority to install code, connect, pay, or execute.

## Keewano supported SQL transport

The official [SQL Guide](https://docs.keewano.com/sql-query-studio/guide.md) documents PostgreSQL wire protocol, host `pgsql.keewano.com`, port `27543`, account email as user, personal access token as password, project UUID as database, and mandatory TLS. An ingestion SDK key is insufficient. [SQL Reference](https://docs.keewano.com/sql-query-studio/reference.md) documents context step functions, marker occurrence counts, `FILTER` occurrence sampling, grouping and limits. The [MCP guide](https://docs.keewano.com/analytics/mcp-for-agents.md) is an alternative supported read interface; this implementation uses SQL, not an invented HTTP SQL endpoint.

Required server environment:

| Variable | Meaning |
| --- | --- |
| `KEEWANO_READ_EMAIL` | Email of the Keewano account with project access |
| `KEEWANO_READ_PAT` | Personal access token from Settings → Access Token; secret |
| `KEEWANO_PROJECT_ID` | Project UUID from Settings → Details → Project ID |
| `SPOILERSCROLL_VERIFY_INSTALL_ID` | Exact UUID printed by the earlier ingestion smoke run; verification command only |
| `SPOILERSCROLL_VERIFY_CONTENT_ID` | Exact content ID sent by that smoke run; verification command only |

The wiring session must add runtime dependency `pg` and development dependency `@types/pg` to the server/root package. They are deliberately not installed here. Existing integration modules compile without these packages because the SQL client is injectable. Use normal certificate validation; `keewanoSqlConfig` sets `rejectUnauthorized: true`, a five-second connection timeout, ten-second query timeout, and pool size two. If a private deployment requires a CA, configure the verified CA explicitly rather than disabling TLS verification. Keep the pool and all credentials server-side, and close the pool during shutdown.

Example later server wiring:

```ts
import pg from 'pg';
import { KeewanoHistoryReader, keewanoSqlConfig, comparisonHistory } from './integrations/index.js';

const config = keewanoSqlConfig();
const pool = config ? new pg.Pool(config) : undefined;
const history = new KeewanoHistoryReader(pool);
// installId comes from authenticated installation pairing, not an arbitrary browser-supplied ID.
const comparisons = await comparisonHistory(history, installId, since, pendingExposures);
// Resolve comparisons.content[*].summaryId in the external summary store for claim comparison.
// comparisons.status === 'unavailable' means degraded analytics, not an empty viewing history.
```

`recentViewed` uses the existing `ContentContext`, `SiteContext`, `SummaryContext`, `AgentContext`, and `ContentViewed` columns. It counts actual marker occurrences and samples `max(event_datetime)` with an occurrence FILTER, rather than treating held-forward state as event rows. Results group by content/site/summary/agent, so the same content with changed provenance may have multiple rows. Reads are bounded to 200 results and a caller-provided date window. There is no pagination API yet.

Production runtime uses `keewanoBehaviorHistory` in `server/integrations/behavior.ts`. A successful Keewano read is required; returned summary IDs hydrate exact local evidence records for the same install/session, qualified dwell, site, and content ID. Local or pending views cannot establish consumption. Missing credentials/query failures suppress detection; ingestion lag can postpone matches. The older `comparisonHistory` pending-merge helper remains available for isolated integration tests but is not used by production detection. Existing local-only cached decisions are invalidated at startup.

**Still requires live schema and semantics validation:** inspect the actual project's `events` columns before relying on these queries, confirm exact custom-event names and marker FILTER behavior against known smoke events, and verify optional context resets. Unknown columns, invalid rows, and attribution mismatch return `unavailable/query`, never a fabricated empty history. An available empty result is distinguishable from a failed query. Invalid input throws. The transport uses escaped SQL literals, because extended-protocol parameter binding support is not established by the Keewano guide; it never interpolates arbitrary SQL identifiers.

After adding read credentials and `pg`:

```sh
npm run build
node --env-file=.env dist/integrations/verify.js --keewano
```

This reads seven days (up to 200 groups) for the exact expected install UUID and checks the expected smoke content ID. A true `expectedSmokeAttribution` requires both. It does not re-ingest events. If the original smoke is older or buried beyond the limit, use `recentViewed` with an explicit suitable window. Query visibility may lag ingestion; the [SpeedHacks guide](https://docs.keewano.com/getting-started/speedhacks-quickstart.md) advises allowing about five minutes. Do not automatically retry failed authentication.

## Extractor performance and decision loop

Existing analytics has **no content-type, capability, revision, attempt or extraction-success events**. `extractorPerformance` therefore returns `unavailable/schema` when no explicit `PerformanceSchema` is supplied. With no read client it returns `unavailable/credentials`. No event names are invented or silently assumed to exist.

The analytics owner must append and emit real typed events first, then map their verified SQL column names through `PerformanceSchema` (`site`, `contentType`, `agentId`, `capabilityId`, `revision`, `attempt`, `success`). For each attempt, initialize every context field, including revision, before the attempt marker, and emit at most one success marker after evidence validation while those contexts remain active. Each attempt must eventually settle before changing context; count only completed windows or account for in-flight attempts. Preserve exact revisions; use a consistent SQL representation and normalize it to the same string/number type returned by discovery. Do not combine revisions or infer absent revisions. The external attempt ledger should hold attempt ID, scope, latency, error category, summary ID, and evidence details. Existing analytics is intentionally unmodified.

The reader groups actual attempt/success marker counts by exact identity, filtered by site/content type/window. `selectExtractor` considers ready capabilities with `canStartThread: true`, prefers the observed success ratio only with at least three attempts and one success, and otherwise retains discovery order. This is a routing heuristic, not a statistically established quality/completeness score. The orchestrator also requires an exact locally verified adapter identity. Tests prove queried performance changes the selection from A to B; this decision change is **fixture verified only** until a live Keewano read and real outcomes exist.

## Darwin discovery and execution boundary

The [official quickstart](https://darwin.so/docs/get-started/quickstart) documents anonymous v3 Search with `{query,maxResults}`. `DarwinSearch` uses that exact endpoint and the observed v3 response envelope, preserving `agentId`, `capabilityId` and `capabilityRevision` as returned; absent revisions remain absent. All returned per-agent metadata, including connection prompts and declared setup, is preserved as data. Unsupported response contract versions fail explicitly. Requests have a timeout and refuse redirects.

The [published OpenAPI](https://darwin.so/openapi.json) fetched the same day still describes a v2 base and different `results`/`agent`/`capability` fields. This implementation follows the v3 quickstart and verified live response; it does not silently parse v2 as v3. No execution endpoints are inferred from either contract. See also [Darwin's machine index](https://darwin.so/llms.txt).

For live discovery only:

```sh
node dist/integrations/verify.js --darwin
```

No API key is needed for the anonymous Search route; this command prints only identities/readiness, never raw response tokens or connection prompts. Search descriptions must be generic capability descriptions, without private browsing data. The orchestrator sends a fixed description and no URL or history to Search.

Before adding a real `ExecutionAdapter`, verify the selected provider's official endpoint, operation, protocol, current route, credentials, authorization, and payment terms. Darwin-managed execution needs a separately authorized account key or human OAuth grant and an executable route; a Search key is not execution authority. Direct providers may require different credentials and authorization. No Darwin execution environment variable is consumed yet because no execution adapter/credential contract was verified. Choose and document those variables with the concrete provider rather than guessing names here. Do not install discovered remote code, automatically execute connection prompts, or bypass authorization/payment denials on another route.

## Extraction orchestration and fallback

`ExtractionIntegration(history, discovery, adapters, allowedOrigins, timeoutMs)` accepts fixture or real interfaces. Its result includes an extraction only after validation, plus distinct event states:

1. `discovered`: Search returned exact identity; no provider contacted.
2. `ready`: Search says ready, thread start allowed, and a locally configured verified adapter matches the exact identity/revision.
3. `attempted`: the adapter's execute function is invoked; no success implied.
4. `extracted`: nonempty text, explicit preview/full scope, and at least one exact quote with valid offsets passed validation.
5. `failed` or `unavailable`: classified outcome; never synthesize a summary or claim success.

Validation proves internal quote grounding, not that a remote provider truthfully fetched the page or that all content was captured. The concrete adapter must establish response provenance and map the provider response to the `Extraction` contract. Offsets use JavaScript UTF-16 indices. Text is capped at 200,000 characters; evidence at 100 quotes. A minimum of 40 trimmed characters is required. Summary creation remains the content pipeline's responsibility.

The local DOM callback runs first; valid preview/full evidence avoids remote discovery and crawling. Remote execution requires explicit consent, an approved public HTTPS origin, no URL userinfo/query/fragment, and an exact verified adapter. IP literals and local/internal/reserved hostnames are rejected. Origin approval is trusted server configuration: approve only known public content origins and paths, validate DNS/redirect safety in the concrete provider adapter, and exclude private messages/account pages before creating the request. Origin approval alone cannot establish that every path is public. Never pass DOM, browser cookies, authorization headers, or private history to providers. The adapter's interface accepts only the approved public URL and an abort signal.

Provider timeout/failure/invalid evidence retries the local callback once, allowing a newly rendered DOM to recover. No second remote provider is tried. Errors returned to callers contain categories rather than raw provider messages. A deadline bounds even adapters that ignore cancellation; adapters must honor the AbortSignal to stop their actual network work. Discovery and performance queries have orchestration deadlines too. There is no background retry worker, discovery cache, outcome persistence, or analytics emission in this module; the wiring session must own those lifecycles.

Fixture injection example:

```ts
const history: HistoryReader = {
  recentViewed: async () => ({status:'available', source:'fixture', data: viewedFixtures}),
  extractorPerformance: async () => ({status:'available', source:'fixture', data: performanceFixtures}),
};
const discovery: CapabilitySearch = {search: async () => capabilityFixtures};
const integration = new ExtractionIntegration(history, discovery);
// Empty adapters deliberately prevent remote execution; localDom supplies local/fixture evidence.
```

## Remaining blockers and wiring checklist

- Obtain Keewano PAT/email/project UUID with read permission, add `pg`, inspect schema, and run exact smoke attribution verification. Live query lag and SQL behavior remain unmeasured.
- Analytics owner adds real extraction outcome fields/events; pass the verified mapping and prove a live performance query changes an extractor decision.
- Obtain a genuinely executable provider route and authorization before implementing/claiming a verified execution adapter. Current live discovery offers none.
- Backend owner wires `comparisonHistory` into summary matching and `ExtractionIntegration` into extraction, authenticates install IDs, configures approved public URLs/consent, persists outcome events externally, and emits the agreed analytics markers. Exported fixture interfaces let that work proceed now.
