import { randomUUID } from 'node:crypto';
import type { ContentStore } from '../content/store.js';
import type { HistoryLookup, HistorySnapshot } from '../decisions/pipeline.js';
import type { HistoryReader } from './contracts.js';

/** Keewano establishes consumption; local records supply the referenced evidence only. */
export function keewanoBehaviorHistory(store: ContentStore, reader: HistoryReader,
  report: (status: string) => void): HistoryLookup {
  return {lookup: async ({installId, sessionId, before}) => {
    const beforeMs = Date.parse(before), since = new Date(beforeMs - 15 * 60_000);
    const fetchedAt = new Date().toISOString();
    const unavailable = (reason: string): HistorySnapshot => {
      report(`Detection unavailable: Keewano history ${reason}`);
      return {status: 'unavailable', source: 'keewano', fetchedAt, viewed: []};
    };
    try {
      const result = await reader.recentViewed(installId, since, 200);
      if (result.status !== 'available') return unavailable(result.reason);
      if (result.source !== 'keewano') return unavailable('not a live Keewano read');
      const state = await store.read();
      const records = new Map(Object.values(state.records).map(r => [r.id, r]));
      const viewed = new Map<string, HistorySnapshot['viewed'][number]>();
      for (const item of result.data) {
        const at = Date.parse(item.viewedAt);
        if (item.installId !== installId || !Number.isFinite(at) || at < since.getTime() || at >= beforeMs || !item.summaryId) continue;
        const record = records.get(item.summaryId);
        if (!record || record.observation.installId !== installId || record.observation.sessionId !== sessionId ||
          record.observation.contentId !== item.contentId || record.observation.site !== item.site ||
          record.observation.dwellSeconds < 3 || Date.parse(record.receivedAt) >= beforeMs) continue;
        viewed.set(record.id, {observationId: record.observation.observationId,
          contentId: item.contentId, scope: record.observation.scope});
      }
      report('Keewano behavior history connected; only confirmed views qualify');
      return {status: 'ready', source: 'keewano', fetchedAt,
        queryId: `keewano-confirmed:${randomUUID()}`, viewed: [...viewed.values()]};
    } catch { return unavailable('query failed'); }
  }};
}
