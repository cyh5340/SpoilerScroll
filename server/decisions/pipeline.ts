import { ContentStore, hash, observationKey } from '../content/store.js';
import { cosine, validateUnderstanding, type ModelProvider } from '../content/provider.js';
import { validateObservation, type Observation, type Decision, type ContentRecord } from '../content/types.js';
export interface HistorySnapshot {
  status: 'ready' | 'unavailable'; source: 'keewano' | 'fixture' | 'cache'; fetchedAt: string;
  queryId?: string;
  // Qualified consumption only; candidate/prepared previews must never appear here.
  viewed: Array<{ observationId: string; contentId: string; scope: 'preview' | 'full' }>;
}
export interface HistoryLookup { lookup(input: { installId: string; sessionId: string; before: string }): Promise<HistorySnapshot> }
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Pipeline deadline exceeded')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}
export class DecisionPipeline {
  private running: Promise<void> | undefined;
  constructor(readonly store: ContentStore, readonly provider: ModelProvider, readonly history: HistoryLookup,
    readonly options: { ttlMs?: number; minMatches?: number; maxCandidates?: number; historyMaxAgeMs?: number } = {}) {
    for (const value of Object.values(options)) if (!Number.isInteger(value) || value! <= 0) throw new Error('Invalid pipeline option');
  }
  async observe(input: unknown): Promise<Decision> {
    const observation = validateObservation(input);
    const id = observationKey(observation.installId, observation.observationId);
    await this.store.update(state => {
      const previous = state.records[id];
      if (previous && JSON.stringify(previous.observation) !== JSON.stringify(observation)) throw new Error('Observation ID conflict');
      if (!previous) {
        state.records[id] = { id, observation, receivedAt: new Date().toISOString(), provenance: {
          mode: this.provider.mode, provider: this.provider.name, revision: this.provider.revision, evidenceHash: hash(observation.visibleText) } };
        state.decisions[id] = { decision: { status: 'pending', intervene: false, matchedContentIds: [] }, expiresAt: 0 };
      }
    });
    // Background work starts after durable acceptance. GET never schedules work.
    void this.drain().then(() => this.drain()).catch(() => undefined);
    return this.get(observation.installId, observation.observationId);
  }
  async get(installId: string, observationId: string): Promise<Decision> {
    const state = await this.store.read();
    const cached = state.decisions[observationKey(installId, observationId)];
    if (!cached) return { status: 'unavailable', intervene: false, matchedContentIds: [], reason: 'not_observed' };
    if (cached.decision.status !== 'pending' && cached.expiresAt <= Date.now()) return { status: 'unavailable', intervene: false, matchedContentIds: [], reason: 'cache_expired' };
    return cached.decision;
  }
  /** Call at startup to resume durable pending observations after a crash. One bounded worker. */
  drain(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async work() {
    while (true) {
      const state = await this.store.read();
      const record = Object.values(state.records).find(r => state.decisions[r.id]?.decision.status === 'pending');
      if (!record) return;
      await this.process(record);
    }
  }
  private async process(record: ContentRecord) {
    const o = record.observation;
    let decision: Decision = { status: 'unavailable', intervene: false, matchedContentIds: [], reason: 'provider_or_history_failed' };
    let history: HistorySnapshot | undefined;
    const matches: Array<{ claimId: string; recordId: string; priorClaimId: string }> = [];
    try {
      const understanding = validateUnderstanding(await bounded(this.provider.understand(o)), o.visibleText);
      await this.store.update(s => { if (s.records[record.id]) s.records[record.id].understanding = understanding; });
      history = await bounded(this.history.lookup({ installId: o.installId, sessionId: o.sessionId, before: record.receivedAt }));
      if (history.status !== 'ready' || Date.now() - Date.parse(history.fetchedAt) > (this.options.historyMaxAgeMs ?? 300000) || !Number.isFinite(Date.parse(history.fetchedAt)) || Date.parse(history.fetchedAt) > Date.now() + 5000 || (this.provider.mode === 'model' && history.source === 'fixture')) throw new Error('History unavailable');
      const state = await this.store.read();
      const candidates = history.viewed.flatMap(view => {
        const r = state.records[observationKey(o.installId, view.observationId)];
        return r && r.observation.contentId === view.contentId && r.observation.scope === view.scope && r.observation.contentId !== o.contentId && r.receivedAt < record.receivedAt && r.understanding && r.provenance.mode === record.provenance.mode && r.provenance.provider === record.provenance.provider && r.provenance.revision === record.provenance.revision ? [r] : [];
      }).sort((a,b) => cosine(understanding.embedding, b.understanding!.embedding) - cosine(understanding.embedding, a.understanding!.embedding)).slice(0, this.options.maxCandidates ?? 50);
      // Semantic vectors rank candidates only. A repeated claim needs exact evidence equality.
      // This conservative baseline deliberately misses paraphrases rather than equating topics.
      for (const claim of understanding.claims) for (const prior of candidates) {
        const same = prior.understanding!.claims.find(c => c.quote.trim() === claim.quote.trim());
        if (same) matches.push({ claimId: claim.id, recordId: prior.id, priorClaimId: same.id });
      }
      const ids = [...new Set(matches.map(m => state.records[m.recordId].observation.contentId))];
      const allRepeated = understanding.complete && understanding.claims.every(c => matches.some(m => m.claimId === c.id));
      const intervene = allRepeated && ids.length >= (this.options.minMatches ?? 3);
      const prefix = this.provider.mode === 'fixture' ? '[Fixture mode] ' : '';
      decision = { status: 'ready', intervene, scope: o.scope, matchedContentIds: ids,
        reason: prefix + (intervene ? 'all_scoped_claims_repeated' : understanding.complete ? 'new_or_insufficient_repeated_evidence' : 'unknown_evidence'),
        ...(intervene ? { spoiler: `${prefix}${o.scope === 'preview' ? 'This preview repeats' : 'This extracted text repeats'}: “${understanding.claims[0].quote.slice(0, 500)}”${o.scope === 'preview' ? ' We could only read the preview.' : ''}` } : {}) };
    } catch { /* Never invent a summary or turn a failed provider into a fixture result. */ }
    await this.store.update(state => {
      if (state.records[record.id]) state.decisions[record.id] = { decision, expiresAt: Date.now() + (this.options.ttlMs ?? 300000), history, matches };
    });
  }
}
