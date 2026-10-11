import { isIP } from 'node:net';
import type { Capability, CapabilitySearch, ExecutionAdapter, Extraction, ExtractionEvent, ExtractionRequest, HistoryReader, Identity, Performance, ReadResult, ViewedContent } from './contracts.js';
export function sameIdentity(a: Identity, b: Identity): boolean {
  return a.agentId === b.agentId && a.capabilityId === b.capabilityId && a.revision === b.revision;
}
export function validateExtraction(input: unknown): Extraction {
  if (!input || typeof input !== 'object') throw new Error('Invalid extraction');
  const x = input as Extraction;
  if (typeof x.text !== 'string' || x.text.trim().length < 40 || x.text.length > 200_000 ||
    !['preview', 'full'].includes(x.scope) || !Array.isArray(x.evidence) || !x.evidence.length || x.evidence.length > 100) throw new Error('Insufficient evidence');
  for (const e of x.evidence) {
    if (!e || typeof e.quote !== 'string' || !e.quote.trim() || !Number.isInteger(e.start) || !Number.isInteger(e.end) ||
      e.start < 0 || e.end <= e.start || e.end > x.text.length || x.text.slice(e.start, e.end) !== e.quote) throw new Error('Ungrounded quote');
  }
  return {text:x.text, scope:x.scope, evidence:x.evidence.map(e=>({...e}))};
}
/** Allow only explicitly approved public origins; refuse query strings, userinfo and fragments. */
export function publicExtractionUrl(raw: string, allowedOrigins: ReadonlySet<string>): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0 || !url.hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) || !allowedOrigins.has(url.origin)) throw new Error('URL not approved');
  return url.href;
}
export function selectExtractor(candidates: Capability[], performance: Performance[]): Capability | undefined {
  const eligible = candidates.filter(c => c.readiness === 'ready' && c.canStartThread);
  const score = (c: Capability) => {
    const p = performance.find(p=>sameIdentity(p,c));
    // Require observed successes and enough attempts; this is evidence, not a completeness estimate.
    return p && p.attempts >= 3 && p.successes > 0 ? p.successes / p.attempts : -1;
  };
  return [...eligible].sort((a,b)=>score(b)-score(a))[0];
}
/** Pending exposures bridge analytics lag and win on duplicate content IDs. */
export async function comparisonHistory(reader: HistoryReader, installId: string, since: Date, pending: ViewedContent[]) {
  let result: ReadResult<ViewedContent[]>;
  try { result = await bounded(()=>reader.recentViewed(installId,since),10000); }
  catch { result = {status:'unavailable',reason:'query'}; }
  const merged = new Map<string,ViewedContent>();
  for (const item of result.status==='available' ? result.data : []) {
    if (item.installId !== installId || Date.parse(item.viewedAt) < since.getTime() || !Number.isFinite(Date.parse(item.viewedAt))) continue;
    const previous = merged.get(item.contentId);
    if (!previous || Date.parse(item.viewedAt) > Date.parse(previous.viewedAt)) merged.set(item.contentId,item);
  }
  for (const item of pending) {
    if (item.installId === installId && Date.parse(item.viewedAt) >= since.getTime()) merged.set(item.contentId,item);
  }
  return {status:result.status, content:[...merged.values()].sort((a,b)=>Date.parse(b.viewedAt)-Date.parse(a.viewedAt)).slice(0,200)};
}
async function bounded<T>(fn: (signal: AbortSignal)=>Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(()=>fn(controller.signal)), new Promise<never>((_,reject)=> {
      timer = setTimeout(()=>{controller.abort(); reject(new Error('timeout'));},ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
export class ExtractionIntegration {
  constructor(private readonly history: HistoryReader, private readonly discovery: CapabilitySearch,
    private readonly adapters: readonly ExecutionAdapter[] = [], private readonly allowedOrigins: ReadonlySet<string> = new Set(),
    private readonly timeoutMs = 10000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid timeout');
  }
  async extract(request: ExtractionRequest): Promise<{extraction?: Extraction; events: ExtractionEvent[]; historyStatus?: string}> {
    const events: ExtractionEvent[] = [];
    const local = async () => {
      const start = Date.now();
      try {
        const extraction = validateExtraction(await bounded(()=>request.localDom(),this.timeoutMs));
        events.push({state:'extracted',source:'local-dom',latencyMs:Date.now()-start});
        return extraction;
      } catch { events.push({state:'failed',reason:'local',latencyMs:Date.now()-start}); return undefined; }
    };
    const initial = await local();
    if (initial) return {extraction:initial,events};
    if (!request.remoteConsent || !request.publicUrl) {
      events.push({state:'unavailable',reason:'Remote processing requires consent and an approved public URL'});
      return {events};
    }
    let url: string;
    try { url = publicExtractionUrl(request.publicUrl,this.allowedOrigins); }
    catch { events.push({state:'unavailable',reason:'URL not approved'}); return {events}; }
    let candidates: Capability[];
    try {
      // Deliberately omit user URL, DOM and any history from discovery.
      candidates = await bounded(()=>this.discovery.search('Extract article text with exact evidence quotes from a public URL'),this.timeoutMs);
    } catch { events.push({state:'unavailable',reason:'Discovery failed or timed out'}); return {events,extraction:await local()}; }
    for (const identity of candidates) events.push({state:'discovered',identity});
    let performance: ReadResult<Performance[]>;
    try { performance = await bounded(()=>this.history.extractorPerformance(request.site,request.contentType,new Date(Date.now()-30*86400000)),this.timeoutMs); }
    catch { performance = {status:'unavailable',reason:'query'}; }
    // Only locally verified exact identities participate; discovery never grants authority.
    const selected = selectExtractor(candidates.filter(c=>this.adapters.some(a=>a.verified && sameIdentity(a.identity,c))),
      performance.status==='available' ? performance.data : []);
    const adapter = selected && this.adapters.find(a=>a.verified && sameIdentity(a.identity,selected));
    if (!selected || !adapter) {
      events.push({state:'unavailable',reason:'No verified authorized execution adapter for a ready capability'});
      return {events,historyStatus:performance.status,extraction:await local()};
    }
    events.push({state:'ready',identity:selected});
    const start = Date.now();
    events.push({state:'attempted',identity:selected});
    let raw: unknown;
    try { raw = await bounded(signal=>adapter.execute(url,signal),this.timeoutMs); }
    catch (error) {
      events.push({state:'failed',identity:selected,reason:error instanceof Error && error.message==='timeout' ? 'timeout':'provider',latencyMs:Date.now()-start});
      return {events,historyStatus:performance.status,extraction:await local()};
    }
    try {
      const extraction = validateExtraction(raw);
      events.push({state:'extracted',identity:selected,source:'provider',latencyMs:Date.now()-start});
      return {extraction,events,historyStatus:performance.status};
    } catch {
      events.push({state:'failed',identity:selected,reason:'validation',latencyMs:Date.now()-start});
      return {events,historyStatus:performance.status,extraction:await local()};
    }
  }
}
