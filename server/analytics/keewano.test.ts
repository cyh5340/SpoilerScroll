import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keewano, configureTransportFetch } from '@keewano/node-sdk';
import { customEventSet } from './keewano-events.generated.js';
import { trackContentEvent, validateEvent } from './keewano.js';

const valid = { installId: '11111111-1111-4111-8111-111111111111', contentId: 'post-1', site: 'reddit.com', action: 'ContentViewed' };
test('rejects invalid attribution, payloads and actions before SDK emission', () => {
  assert.deepEqual(validateEvent(valid), valid);
  for (const patch of [{installId:'bad'}, {contentId:'x'.repeat(257)}, {action:'Unknown'}, {summary:'raw browsing text'}, {site:'https://reddit.com/private'}]) {
    assert.throws(() => validateEvent({...valid,...patch}));
  }
});

test('real SDK persists batches offline, then registers schema and retries delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spoilerscroll-'));
  const requests: {url: string; method: string; body: number}[] = [];
  let online = false;
  configureTransportFetch(async (url, init) => {
    if (!online) throw new Error('simulated offline');
    requests.push({url, method: init.method ?? 'GET', body: init.body instanceof Uint8Array ? init.body.byteLength : 0});
    return new Response(null, {status: init.method === 'GET' ? 204 : 200});
  });
  try {
    await Keewano.init({apiKey:'local-test-key',dataDir:dir,customEventSet,shutdownGraceMs:0});
    await trackContentEvent(valid);
    const files = await readdir(dir, {recursive:true});
    assert.ok(files.some(file => String(file).endsWith('.kwub')), `batch must be written to disk: ${files.join(', ')}`);
    await Keewano.shutdown();
    online = true;
    await Keewano.init({apiKey:'local-test-key',dataDir:dir,customEventSet,shutdownGraceMs:3000});
    await Keewano.shutdown();
    assert.ok(requests.some(r=>r.url.endsWith('/custom') && r.method==='POST'), 'schema registered');
    assert.ok(requests.some(r=>r.url.endsWith('/in') && r.body>0), 'persisted payload delivered after restart');
  } finally {
    await Keewano.shutdown();
    configureTransportFetch(fetch);
    await rm(dir,{recursive:true,force:true});
  }
});
