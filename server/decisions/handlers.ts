import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DecisionPipeline } from './pipeline.js';
/** Host must authenticate/authorize installId and enforce consent before calling these handlers. */
export function createDecisionHandlers(pipeline: DecisionPipeline) {
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  return {
    async postObservations(req: IncomingMessage, res: ServerResponse) {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Expected application/json' });
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 262144) return send(res, 413, { error: 'Observation too large' });
        }
        const input: unknown = JSON.parse(body);
        const { validateObservation } = await import('../content/types.js');
        validateObservation(input);
        try { return send(res, 202, await pipeline.observe(input)); }
        catch (error) {
          return send(res, (error as Error).message === 'Observation ID conflict' ? 409 : 503, { error: 'Observation could not be accepted' });
        }
      } catch { return send(res, 400, { error: 'Invalid observation' }); }
    },
    async getDecisions(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? '', 'http://localhost');
      const installId = url.searchParams.get('installId');
      const observationId = url.searchParams.get('observationId');
      if (!installId || !observationId || installId.length > 256 || observationId.length > 256) return send(res, 400, { error: 'Expected installId and observationId' });
      try { return send(res, 200, await pipeline.get(installId, observationId)); }
      catch { return send(res, 503, { status: 'unavailable', intervene: false, matchedContentIds: [], reason: 'store_unavailable' }); }
    },
  };
}
