import { resolve } from 'node:path';
import { Keewano } from '@keewano/node-sdk';
import * as events from './keewano-events.generated.js';

export const actions = ['ContentViewed', 'SpoilerShown', 'SpoilerSkipped', 'ReadAnyway', 'FalsePositiveReported'] as const;
export type Action = typeof actions[number];
export interface ContentEvent {
  installId: string;
  contentId: string;
  site: string;
  action: Action;
  summaryId?: string;
  agentId?: string;
}

export function validateEvent(input: unknown): ContentEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an event object');
  const value = input as Record<string, unknown>;
  const allowed = new Set(['installId', 'contentId', 'site', 'action', 'summaryId', 'agentId']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unknown event field');
  for (const key of ['installId', 'contentId', 'site', 'action', 'summaryId', 'agentId']) {
    const field = value[key];
    if (field === undefined && (key === 'summaryId' || key === 'agentId')) continue;
    if (typeof field !== 'string' || !field.trim() || [...field].length > 256 || /[\u0000-\u001f]/u.test(field)) {
      throw new Error(`Invalid ${key}`);
    }
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.installId as string) || value.installId === '00000000-0000-0000-0000-000000000000') throw new Error('installId must be a nonzero UUID');
  if (!actions.includes(value.action as Action)) throw new Error('Unsupported action');
  if (!/^(localhost|[a-z0-9]+(?:[.-][a-z0-9]+)*)$/i.test(value.site as string)) throw new Error('site must be a hostname');
  return value as unknown as ContentEvent;
}

export async function initAnalytics() {
  const apiKey = process.env.KEEWANO_API_KEY;
  if (!apiKey?.trim()) throw new Error('Set KEEWANO_API_KEY in .env to an SDK-type project key');
  await Keewano.init({
    apiKey,
    dataDir: resolve(process.env.KEEWANO_DATA_DIR || '.data/keewano'),
    customEventSet: events.customEventSet,
  });
  if (!Keewano.isReady()) throw new Error('Keewano SDK did not initialize; check API key format');
}

export async function trackContentEvent(input: unknown) {
  // Validate everything before build: SDK callbacks must be synchronous and atomic.
  const event = validateEvent(input);
  await Keewano.reportUserBatch({
    userId: event.installId,
    build: reporter => {
      events.batchReportContentContext(reporter, event.contentId);
      events.batchReportSiteContext(reporter, event.site);
      // Always reset optional context to avoid inheriting the previous card's values.
      events.batchReportSummaryContext(reporter, event.summaryId ?? 'none');
      events.batchReportAgentContext(reporter, event.agentId ?? 'local-dom');
      const report = {
        ContentViewed: events.batchReportContentViewed,
        SpoilerShown: events.batchReportSpoilerShown,
        SpoilerSkipped: events.batchReportSpoilerSkipped,
        ReadAnyway: events.batchReportReadAnyway,
        FalsePositiveReported: events.batchReportFalsePositiveReported,
      }[event.action];
      report(reporter);
    },
  });
}

export const shutdownAnalytics = () => Keewano.shutdown();
