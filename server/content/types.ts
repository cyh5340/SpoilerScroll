export type Scope = 'preview' | 'full';
export interface Observation {
  observationId: string; installId: string; sessionId: string; contentId: string;
  site: string; url: string; title: string; visibleText: string; scope: Scope; dwellSeconds: number;
  pageEnteredAt?: number;
}
export interface Claim { id: string; quote: string }
export interface Understanding {
  summary: string; claims: Claim[]; embedding: number[];
  // All substantive evidence must be covered, including qualifications and new results.
  complete: boolean;
}
export interface ContentRecord {
  id: string; observation: Observation; receivedAt: string; understanding?: Understanding;
  provenance: { mode: 'fixture' | 'model' | 'local'; provider: string; revision: string; evidenceHash: string };
}
export interface Decision {
  status: 'pending' | 'ready' | 'unavailable'; intervene: boolean; spoiler?: string;
  scope?: Scope; matchedContentIds: string[]; reason?: string;
}
export interface StoredDecision {
  decision: Decision; expiresAt: number; history?: unknown;
  matches?: Array<{ claimId: string; recordId: string; priorClaimId: string }>;
}
export interface PipelineState {
  version: 1; records: Record<string, ContentRecord>; decisions: Record<string, StoredDecision>;
}
export function validateObservation(input: unknown): Observation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid observation');
  const x = input as Record<string, unknown>;
  const fields = ['observationId','installId','sessionId','contentId','site','url','title','visibleText','scope','dwellSeconds'];
  if (Object.keys(x).some(k => !fields.includes(k) && k!=='pageEnteredAt')) throw new Error('Unknown field');
  if(x.pageEnteredAt!==undefined && (typeof x.pageEnteredAt!=='number' || !Number.isFinite(x.pageEnteredAt) || x.pageEnteredAt<=0 || x.pageEnteredAt>Date.now()+5000))throw new Error('Invalid page entry time');
  for (const key of fields.filter(k => k !== 'dwellSeconds')) {
    const max = key === 'visibleText' ? 50000 : key === 'url' ? 2048 : 256;
    if (typeof x[key] !== 'string' || !(x[key] as string).trim() || (x[key] as string).length > max) throw new Error(`Invalid ${key}`);
  }
  if (x.scope !== 'preview' && x.scope !== 'full') throw new Error('Invalid scope');
  if (typeof x.dwellSeconds !== 'number' || !Number.isFinite(x.dwellSeconds) || x.dwellSeconds < 0 || x.dwellSeconds > 86400) throw new Error('Invalid dwell');
  const url = new URL(x.url as string);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.hostname !== x.site) throw new Error('Invalid public URL/site');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  return { ...x, url: url.href } as unknown as Observation;
}
