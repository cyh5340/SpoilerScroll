import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ContentStore } from '../content/store.js';
import { LocalExtractiveProvider } from '../content/local.js';
import { DecisionPipeline } from '../decisions/pipeline.js';
import { keewanoBehaviorHistory } from './behavior.js';
import type { HistoryReader, ViewedContent, ReadResult } from './contracts.js';

test('only Keewano-confirmed views affect live decisions; failure and local-only history cannot intervene', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'keewano-behavior-'));
  try {
    const store = new ContentStore(join(dir, 'content.json'));
    let response: ReadResult<ViewedContent[]> = {status: 'unavailable', reason: 'credentials'};
    const reader: HistoryReader = {recentViewed: async () => response,
      extractorPerformance: async () => ({status: 'unavailable', reason: 'schema'})};
    const history = keewanoBehaviorHistory(store, reader, () => {});
    const pipeline = new DecisionPipeline(store, new LocalExtractiveProvider(), history);
    const installId = randomUUID(), sessionId = randomUUID();
    const observe = async (contentId: string, visibleText = 'Developers review generated code carefully before releasing it.') => {
      const observationId = randomUUID();
      await pipeline.observe({installId, sessionId, observationId, contentId,
        site: 'www.reddit.com', url: `https://www.reddit.com/r/test/comments/${contentId}/`,
        title: 'Generated code review', visibleText, scope: 'preview', dwellSeconds: 3});
      await pipeline.drain();
      return pipeline.get(installId, observationId);
    };
    for (let i = 0; i < 3; i++) await observe(`prior${i}`);
    assert.equal((await observe('no-read')).status, 'unavailable');
    response = {status: 'available', source: 'keewano', data: []};
    assert.equal((await observe('not-ingested')).intervene, false);
    const records = Object.values((await store.read()).records).filter(r => r.observation.contentId.startsWith('prior'));
    const rows = records.map(r => ({installId, contentId: r.observation.contentId,
      site: r.observation.site, summaryId: r.id, agentId: 'local-dom', viewedAt: r.receivedAt}));
    response = {status: 'available', source: 'keewano', data: rows};
    assert.equal((await observe('confirmed')).intervene, true);
    assert.equal((await observe('new-evidence', 'A new compiler eliminates this review step entirely.')).intervene, false,
      'shared titles must not substitute for repeated evidence');
    response = {status: 'available', source: 'keewano', data: rows.map(r => ({...r, summaryId: 'wrong-id'}))};
    assert.equal((await observe('wrong-evidence')).intervene, false);
    response = {status: 'available', source: 'fixture', data: rows};
    assert.equal((await observe('fixture-read')).status, 'unavailable');
    response = {status: 'unavailable', reason: 'query'};
    assert.equal((await observe('failed-read')).status, 'unavailable');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
