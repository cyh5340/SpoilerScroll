import type { Capability, CapabilitySearch } from './contracts.js';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Darwin response');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024) throw new Error('Missing Darwin identifier');
  return value;
}
/** Search is discovery only. Metadata (including connectionPrompt) is untrusted data. */
export function parseDarwinSearch(input: unknown): Capability[] {
  const body = record(input);
  if (body.contractVersion !== 'search-v3.0') throw new Error('Unsupported Darwin contract');
  const response = record(body.response);
  if (!Array.isArray(response.agents) || response.agents.length > 50) throw new Error('Invalid agents');
  return response.agents.map(value => {
    const agent = record(value), revision = agent.capabilityRevision;
    if (revision != null && !(typeof revision === 'string' && revision.length > 0) &&
      !(typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0)) throw new Error('Invalid revision');
    if (typeof agent.readiness !== 'string' || typeof agent.canStartThread !== 'boolean') throw new Error('Missing readiness');
    return {agentId: id(agent.agentId), capabilityId: id(agent.capabilityId),
      ...(revision == null ? {} : {revision}), readiness: agent.readiness,
      canStartThread: agent.canStartThread, metadata: {...agent}};
  });
}
export class DarwinSearch implements CapabilitySearch {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 15000) {}
  async search(description: string): Promise<Capability[]> {
    if (!description.trim() || description.length > 2000) throw new Error('Invalid capability description');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher('https://api.darwin.so/api/v3/search', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: description, maxResults: 5}),
        signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) throw new Error(`Darwin Search HTTP ${response.status}`);
      const raw = await response.text();
      if (raw.length > 1_000_000) throw new Error('Darwin response too large');
      return parseDarwinSearch(JSON.parse(raw));
    } finally { clearTimeout(timer); }
  }
}
