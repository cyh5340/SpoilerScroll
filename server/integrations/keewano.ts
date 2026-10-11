import type { HistoryReader, Performance, ReadResult, ViewedContent } from './contracts.js';

/** Use a pg-compatible client with TLS, connection/query timeouts, and bounded results. */
export interface SqlClient { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> }
export interface PerformanceSchema {
  site: string; contentType: string; agentId: string; capabilityId: string;
  revision: string; attempt: string; success: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function literal(value: string): string {
  if (!value || value.length > 256 || /[\u0000-\u001f\\]/u.test(value)) throw new Error('Invalid SQL value');
  return `'${value.replaceAll("'", "''")}'`;
}
function column(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_ ]{0,127}$/.test(value)) throw new Error('Invalid schema column');
  return `"${value}"`;
}
function timestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid date');
  return literal(value.toISOString().replace('T', ' ').replace('Z', ''));
}
function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid count');
  return n;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) throw new Error('Invalid row');
  return value;
}
function time(value: unknown): string {
  const d = value instanceof Date ? value : typeof value === 'number' ? new Date(value * 1000) : new Date(String(value));
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid timestamp');
  return d.toISOString();
}
export class KeewanoHistoryReader implements HistoryReader {
  constructor(private readonly client?: SqlClient, private readonly performanceSchema?: PerformanceSchema) {
    if (performanceSchema) Object.values(performanceSchema).forEach(column);
  }
  async recentViewed(installId: string, since: Date, limit = 50): Promise<ReadResult<ViewedContent[]>> {
    if (!uuid.test(installId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(installId)) throw new Error('Expected nonzero install UUID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Limit must be 1..200');
    // Aggregate the marker, rather than treating a held-forward marker as an event row.
    // FILTER samples timestamps at ContentViewed occurrences; context is held-forward by Keewano.
    const sql = `SELECT user_id AS install_id, "ContentContext" AS content_id,
"SiteContext" AS site, "SummaryContext" AS summary_id, "AgentContext" AS agent_id,
count("ContentViewed") AS views,
max(event_datetime) FILTER (WHERE "ContentViewed" IS NOT NULL) AS viewed_at
FROM events WHERE user_id = ${literal(installId)} AND event_datetime >= ${timestamp(since)}
GROUP BY install_id, content_id, site, summary_id, agent_id
HAVING views > 0 ORDER BY viewed_at DESC, content_id ASC LIMIT ${limit}`;
    if (!this.client) return { status: 'unavailable', reason: 'credentials' };
    try {
      const {rows} = await this.client.query(sql);
      const data = rows.map(row => {
        if (string(row.install_id).toLowerCase() !== installId.toLowerCase() || count(row.views) < 1) throw new Error('Attribution mismatch');
        const summaryId = string(row.summary_id);
        return {installId, contentId: string(row.content_id), site: string(row.site),
          ...(summaryId === 'none' ? {} : {summaryId}), agentId: string(row.agent_id), viewedAt: time(row.viewed_at)};
      });
      if (data.length > limit) throw new Error('Unbounded result');
      return {status: 'available', source: 'keewano', data};
    } catch { return {status: 'unavailable', reason: 'query'}; }
  }
  async extractorPerformance(site: string, contentType: string, since: Date): Promise<ReadResult<Performance[]>> {
    const siteValue = literal(site), typeValue = literal(contentType), from = timestamp(since);
    if (!this.client) return {status: 'unavailable', reason: 'credentials'};
    if (!this.performanceSchema) return {status: 'unavailable', reason: 'schema'};
    const s = this.performanceSchema;
    const sql = `SELECT ${column(s.agentId)} AS agent_id, ${column(s.capabilityId)} AS capability_id,
${column(s.revision)} AS revision, count(${column(s.attempt)}) AS attempts,
count(${column(s.success)}) AS successes FROM events
WHERE ${column(s.site)} = ${siteValue} AND ${column(s.contentType)} = ${typeValue}
AND event_datetime >= ${from} GROUP BY agent_id, capability_id, revision
HAVING attempts > 0 ORDER BY successes DESC LIMIT 200`;
    try {
      const {rows} = await this.client.query(sql);
      const data = rows.map(row => {
        const attempts = count(row.attempts), successes = count(row.successes);
        if (successes > attempts) throw new Error('Invalid performance');
        const revision = row.revision;
        if (revision != null && typeof revision !== 'string' && typeof revision !== 'number') throw new Error('Invalid revision');
        return {site, contentType, agentId: string(row.agent_id), capabilityId: string(row.capability_id),
          ...(revision == null ? {} : {revision}), attempts, successes};
      });
      if (data.length > 200) throw new Error('Unbounded result');
      return {status: 'available', source: 'keewano', data};
    } catch { return {status: 'unavailable', reason: 'query'}; }
  }
}

/** No SDK key reuse, no weakened TLS. Feed this to pg.Pool after installing pg server-side. */
export function keewanoSqlConfig(env: NodeJS.ProcessEnv = process.env) {
  const user = env.KEEWANO_READ_EMAIL, password = env.KEEWANO_READ_PAT, database = env.KEEWANO_PROJECT_ID;
  if (!user || !password || !database) return undefined;
  if (!uuid.test(database)) throw new Error('KEEWANO_PROJECT_ID must be a UUID');
  return {host: 'pgsql.keewano.com', port: 27543, user, password, database,
    ssl: {rejectUnauthorized: true}, connectionTimeoutMillis: 5000,
    query_timeout: 10000, max: 2};
}
