// Fast in-process HTTP integration check. No browser, real sponsor calls, or .env secrets.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keewano, configureTransportFetch } from '@keewano/node-sdk';
import { customEventSet } from '../dist/analytics/keewano-events.generated.js';
import { createRuntime } from '../dist/runtime.js';
import { createApplication } from '../dist/application.js';
const dir=await mkdtemp(join(tmpdir(),'spoilerscroll-wiring-'));
configureTransportFetch(async(_url,init)=>new Response(null,{status:init.method==='GET'?204:200}));
await Keewano.init({apiKey:'local-wiring-check',persistent:false,customEventSet});
let runtime;
// Explicit fake read service: confirms persisted qualified views, no real SQL call.
const historyReader={recentViewed:async()=>({status:'available',source:'keewano',data:Object.values((await runtime.store.read()).records).filter(r=>r.observation.dwellSeconds>=3).map(r=>({installId:r.observation.installId,contentId:r.observation.contentId,site:r.observation.site,summaryId:r.id,agentId:'local-dom',viewedAt:r.receivedAt}))}),extractorPerformance:async()=>({status:'unavailable',reason:'schema'})};
runtime=await createRuntime(dir,{historyReader});
const server=createServer(createApplication(runtime));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const installId=randomUUID(),sessionId=randomUUID();
const headers={'Content-Type':'application/json',Origin:runtime.origin};
async function post(path,body,token){return fetch(base+path,{method:'POST',headers:{...headers,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});}
try {
 const paired=await post('/pair',{installId,consent:true});assert.equal(paired.status,200);
 const {token}=await paired.json();assert.ok(token);
 const text='AI can automate routine programming tasks. Developers still need to review the generated results carefully.';
 for(let i=1;i<=3;i++) {
  const body={observationId:randomUUID(),installId,sessionId,contentId:`reddit:wire${i}`,site:'www.reddit.com',url:`https://www.reddit.com/r/technology/comments/wire${i}/`,title:'A recurring claim',visibleText:text,scope:'preview',dwellSeconds:3};
  assert.equal((await post('/observations',body,token)).status,202);await runtime.pipeline.drain();
 }
 const id=randomUUID();
 const candidate={observationId:id,installId,sessionId,contentId:'reddit:wire4',site:'www.reddit.com',url:'https://www.reddit.com/r/technology/comments/wire4/',title:'Another recurring claim',visibleText:text,scope:'preview',dwellSeconds:0};
 assert.equal((await post('/candidates',candidate,token)).status,202);await runtime.pipeline.drain();
 const decision=await fetch(base+`/decisions?installId=${installId}&observationId=${id}`,{headers:{Origin:runtime.origin,Authorization:`Bearer ${token}`}});
 assert.equal(decision.status,200);assert.equal((await decision.json()).intervene,true);
 assert.equal((await post('/observations',{...candidate,installId:randomUUID()},token)).status,401);
 assert.equal((await fetch(base+'/health',{headers:{Origin:'https://example.com'}})).status,403);
 await runtime.flushAnalytics();await runtime.flushAnalytics();
 assert.equal(JSON.parse(await readFile(join(dir,'analytics-outbox.json'),'utf8')).length,3,'candidate preparation must not emit ContentViewed');
 console.log('Wiring verified: pairing, install authorization, observation storage, candidate preparation, cached spoiler decisions, and exactly three viewed-event outbox entries.');
} finally {
 await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});
 await runtime.close();await Keewano.shutdown();configureTransportFetch(fetch);await rm(dir,{recursive:true,force:true});
}
