import { randomUUID } from 'node:crypto';
import { initAnalytics, shutdownAnalytics, trackContentEvent } from './analytics/keewano.js';
const installId = randomUUID();
await initAnalytics();
try {
  await trackContentEvent({ installId, contentId: 'smoke-test-content', site: 'localhost', action: 'ContentViewed' });
  console.log(`Test event persisted for install ${installId}.`);
} finally {
  await shutdownAnalytics();
}
console.log('Remote acceptance is not confirmed by SDK persistence. Check Keewano for ContentViewed after ingestion delay; failed sends remain queued for the next run.');
