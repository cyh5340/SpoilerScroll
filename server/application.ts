import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateObservation, type Observation } from './content/types.js';
import { trackContentEvent, validateEvent } from './analytics/keewano.js';
import type { Runtime } from './runtime.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function publicObservation(o:Observation) {
  const url=new URL(o.url);
  return uuid.test(o.installId) && uuid.test(o.sessionId) && uuid.test(o.observationId) && o.scope==='preview' && o.title.length<=256 && o.visibleText.length<=4000 &&
    url.protocol==='https:' && ['www.reddit.com','old.reddit.com'].includes(url.hostname) && !url.search && !url.hash &&
    /^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname) && /^reddit:[a-z0-9]+$/i.test(o.contentId);
}
async function readJson(req:IncomingMessage) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('media');
  let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>32768)throw new Error('size');}
  return JSON.parse(body);
}
export function createApplication(runtime:Runtime) {
  const rates=new Map<string,{at:number,count:number}>();
  return async(req:IncomingMessage,res:ServerResponse)=>{
    const started=Date.now();
    const pathname=new URL(req.url??'','http://127.0.0.1').pathname;
    res.once('finish',()=>{
      if(req.method!=='OPTIONS' && (pathname!=='/health' || res.statusCode>=400))
        console.log(`[${new Date().toISOString()}] ${req.method} ${pathname} ${res.statusCode} ${Date.now()-started}ms`);
    });
    const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url??'','http://127.0.0.1');
      const origin=req.headers.origin;
      const extensionRequest=origin===runtime.origin || (!origin && req.headers['x-spoilerscroll-extension']===runtime.extensionId);
      if(origin && origin!==runtime.origin)return send(403,{error:'Unpaired extension origin'});
      if(origin===runtime.origin) {
        res.setHeader('Access-Control-Allow-Origin',runtime.origin);res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-SpoilerScroll-Extension');
        res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
        if(req.headers['access-control-request-private-network']==='true')res.setHeader('Access-Control-Allow-Private-Network','true');
      }
      if(req.method==='OPTIONS')return extensionRequest?send(204,null):send(403,{error:'Origin required'});
      if(req.method==='GET' && url.pathname==='/health')return send(200,{status:'ready',...runtime.status()});
      if(!extensionRequest)return send(403,{error:'Use the SpoilerScroll extension to pair'});
      if(req.method==='POST' && url.pathname==='/pair') {
        const body=await readJson(req);
        if(!body || !uuid.test(body.installId) || body.installId==='00000000-0000-0000-0000-000000000000' || body.consent!==true)return send(400,{error:'Install identity and consent required'});
        const token=await runtime.pair(body.installId);
        return send(200,{token,...runtime.status()});
      }
      const input=req.method==='POST'?await readJson(req):undefined;
      const installId=req.method==='GET'?url.searchParams.get('installId'):input?.installId;
      const token=req.headers.authorization?.replace(/^Bearer /,'')??'';
      if(typeof installId!=='string' || !runtime.authorized(installId,token))return send(401,{error:'Pair this installation in the extension popup'});
      const rate=rates.get(installId);
      if(!rate || Date.now()-rate.at>60000)rates.set(installId,{at:Date.now(),count:1});
      else if(++rate.count>600)return send(429,{error:'Request limit exceeded'});
      if(req.method==='GET' && url.pathname==='/decisions') {
        const id=url.searchParams.get('observationId');if(!id || !uuid.test(id))return send(400,{error:'observationId required'});
        const decision=await runtime.pipeline.get(installId,id);
        if(decision.status==='unavailable')console.log(`[SpoilerScroll] Detection unavailable: ${decision.reason}; ${runtime.status().history}`);
        if(decision.status==='ready' && decision.intervene)console.log(`[SpoilerScroll] Repeat detected: ${decision.matchedContentIds.length} prior posts`);
        return send(200,decision);
      }
      if(req.method==='POST' && (url.pathname==='/observations' || url.pathname==='/candidates')) {
        let observation:Observation;
        try {observation=validateObservation(input);}catch{return send(400,{error:'Invalid observation'});}
        if(!publicObservation(observation) || (url.pathname==='/observations'?observation.dwellSeconds<3:observation.dwellSeconds!==0))return send(400,{error:'Expected a public Reddit preview and valid dwell'});
        try {
          const decision=await runtime.pipeline.observe(observation);
          console.log(`[SpoilerScroll] ${observation.dwellSeconds>=3?'View captured':'Preview checked'}: ${observation.contentId}`);
          // Only dwell-qualified observations create Keewano ContentViewed events.
          if(observation.dwellSeconds>=3)void runtime.flushAnalytics().catch(()=>{});
          return send(202,decision);
        }catch(error){return send((error as Error).message==='Observation ID conflict'?409:503,{error:'Could not persist observation'});}
      }
      if(req.method==='POST' && url.pathname==='/events') {
        try{validateEvent(input);}catch{return send(400,{error:'Invalid event'});}
        if(!['www.reddit.com','old.reddit.com'].includes(input.site) || input.action==='ContentViewed')return send(400,{error:'Views must use the observations endpoint'});
        await trackContentEvent(input);return send(202,{status:'persisted_locally',remoteAcceptance:'pending'});
      }
      return send(404,{error:'Not found'});
    } catch(error) {
      const message=(error as Error).message;
      send(message==='size'?413:message==='media'?415:error instanceof SyntaxError?400:503,{error:'Request could not be completed'});
    }
  };
}
