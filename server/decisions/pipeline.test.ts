import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentStore } from '../content/store.js';
import { FixtureProvider, validateUnderstanding } from '../content/provider.js';
import type { Observation } from '../content/types.js';
import { DecisionPipeline, type HistorySnapshot } from './pipeline.js';
const observation = (id: string, text = 'The trial enrolled 100 patients.', scope: 'preview' | 'full' = 'preview'): Observation => ({ observationId: id, contentId: id, installId: 'install-1', sessionId: 'session-1', site: 'example.com', url: `https://example.com/${id}`, title: 'Trial', visibleText: text, scope, dwellSeconds: 5 });
async function setup(run: (p: DecisionPipeline, store: ContentStore, viewed: HistorySnapshot['viewed']) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'spoilerscroll-'));
  const store = new ContentStore(join(dir, 'store.json'));
  const viewed: HistorySnapshot['viewed'] = [];
  const p = new DecisionPipeline(store, new FixtureProvider(), { async lookup() { return { status: 'ready', source: 'fixture', fetchedAt: new Date().toISOString(), viewed }; } });
  try { await run(p, store, viewed); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function seed(p: DecisionPipeline, viewed: HistorySnapshot['viewed']) {
  for (const id of ['a','b','c']) {
    await p.observe(observation(id)); await p.drain();
    viewed.push({ observationId: id, contentId: id, scope: 'preview' });
  }
}
test('repeated claims produce a labeled, preview-scoped cached spoiler; survives restart', () => setup(async (p, store, viewed) => {
  await seed(p, viewed);
  await p.observe(observation('candidate')); await p.drain();
  const decision = await p.get('install-1', 'candidate');
  assert.equal(decision.intervene, true); assert.match(decision.spoiler!, /Fixture mode.*preview/); assert.equal(decision.scope, 'preview');
  const restarted = new DecisionPipeline(new ContentStore(store.path), { ...new FixtureProvider(), mode: 'fixture', name: 'unused', revision: '1', understand: async () => { throw new Error('GET must not call provider'); } }, p.history);
  assert.deepEqual(await restarted.get('install-1', 'candidate'), decision);
  assert.equal((await p.get('another-install', 'candidate')).intervene, false);
}));
test('same topic with new evidence does not intervene, including an appended new claim', () => setup(async (p, _s, viewed) => {
  await seed(p, viewed);
  for (const [id, text] of [['new', 'The trial enrolled 200 patients.'], ['appended', 'The trial enrolled 100 patients. A new result showed a 20% reduction.']]) {
    await p.observe(observation(id, text)); await p.drain(); assert.equal((await p.get('install-1', id)).intervene, false);
  }
}));
test('preview history cannot establish unseen full-text claims', () => setup(async (p, _s, viewed) => {
  await seed(p, viewed);
  await p.observe(observation('full', 'The trial enrolled 100 patients. Mortality increased.', 'full')); await p.drain();
  assert.equal((await p.get('install-1', 'full')).intervene, false);
}));
test('failed provider yields unavailable, never fixture fallback', () => setup(async (_p, store) => {
  const p = new DecisionPipeline(store, { mode: 'model', name: 'failed', revision: '1', understand: async () => { throw new Error('offline'); } }, { lookup: async () => { throw new Error('unused'); } });
  await p.observe(observation('fail')); await p.drain();
  assert.equal((await p.get('install-1', 'fail')).status, 'unavailable');
}));
test('grounding rejects invented evidence and detects omitted new evidence', () => {
  assert.throws(() => validateUnderstanding({ summary: 'invented', claims: [], embedding: [1], complete: true }, 'Real text.'));
  const u = validateUnderstanding({ summary: 'Real text.', claims: [{ id: 'a', quote: 'Real text.' }], embedding: [1], complete: true }, 'Real text. New result.');
  assert.equal(u.complete, false);
});
test('idempotency rejects changed scope/text; clearing removes records and decisions', () => setup(async (p, store) => {
  await p.observe(observation('a')); await p.drain();
  await assert.rejects(p.observe(observation('a', 'Different text.')), /conflict/);
  await store.clearInstall('install-1');
  assert.equal((await p.get('install-1', 'a')).status, 'unavailable');
}));
test('history failure suppresses intervention and pending records resume after restart', () => setup(async (p, store, viewed) => {
  await seed(p, viewed);
  const failed = new DecisionPipeline(store, new FixtureProvider(), { lookup: async () => ({ status: 'unavailable', source: 'keewano', fetchedAt: new Date().toISOString(), viewed }) });
  await failed.observe(observation('history-failed')); await failed.drain();
  assert.equal((await failed.get('install-1', 'history-failed')).status, 'unavailable');
  await store.update(s => { const r = Object.values(s.records).find(r => r.observation.observationId === 'history-failed')!; s.decisions[r.id].decision.status = 'pending'; });
  const restarted = new DecisionPipeline(new ContentStore(store.path), new FixtureProvider(), p.history);
  await restarted.drain();
  assert.equal((await restarted.get('install-1', 'history-failed')).intervene, true);
}));
test('same-post click reminder requires a prior Keewano-confirmed view',()=>setup(async(p,store,viewed)=>{
  await p.observe(observation('original'));await p.drain();
  viewed.push({observationId:'original',contentId:'original',scope:'preview'});
  const prior=Object.values((await store.read()).records)[0];
  const confirmed=new DecisionPipeline(store,new FixtureProvider(),{lookup:async()=>({status:'ready',source:'keewano',fetchedAt:new Date().toISOString(),viewed})});
  await confirmed.observe({...observation('current-visit'),contentId:'original',dwellSeconds:0,pageEnteredAt:Date.parse(prior.receivedAt)-1});await confirmed.drain();
  assert.equal((await confirmed.get('install-1','current-visit')).intervene,true);
  await confirmed.observe({...observation('reopened'),contentId:'original',dwellSeconds:0,pageEnteredAt:Date.parse(prior.receivedAt)+1});await confirmed.drain();
  const result=await confirmed.get('install-1','reopened');
  assert.equal(result.intervene,true);assert.equal(result.reason,'same_post_previously_viewed_keewano_confirmed');
  const unavailable=new DecisionPipeline(store,new FixtureProvider(),{lookup:async()=>({status:'unavailable',source:'keewano',fetchedAt:new Date().toISOString(),viewed})});
  await unavailable.observe({...observation('offline-reopen'),contentId:'original',pageEnteredAt:Date.parse(prior.receivedAt)+1});await unavailable.drain();
  assert.equal((await unavailable.get('install-1','offline-reopen')).intervene,false);
  assert.equal((await unavailable.get('install-1','offline-reopen')).reason,'keewano_history_unavailable');
}));
