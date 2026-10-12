import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { ContentStore, HttpModelProvider } from './content/index.js';
import { LocalExtractiveProvider } from './content/local.js';
import { DecisionPipeline, type HistoryLookup } from './decisions/index.js';
import { DarwinSearch, ExtractionIntegration, KeewanoHistoryReader, keewanoSqlConfig, type HistoryReader } from './integrations/index.js';
import { keewanoBehaviorHistory } from './integrations/behavior.js';
import { trackContentEvent } from './analytics/keewano.js';

export async function createRuntime(dataDir=resolve('.data/app'), dependencies: {historyReader?: HistoryReader} = {}) {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const manifest=JSON.parse(await readFile(resolve('extension/public/manifest.json'),'utf8'));
  const extensionId=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>'abcdefghijklmnop'[parseInt(c,16)]).join('');
  const origin=`chrome-extension://${extensionId}`;
  const pairingPath=resolve(dataDir,'pairing.json');
  let pairs:Record<string,string>={};
  try{pairs=JSON.parse(await readFile(pairingPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  let pairWrites:Promise<unknown>=Promise.resolve();
  async function pair(installId:string) {
    const job=pairWrites.then(async()=>{
      pairs[installId]??=randomBytes(32).toString('hex');
      const tmp=pairingPath+'.tmp';await writeFile(tmp,JSON.stringify(pairs),{mode:0o600});await rename(tmp,pairingPath);
      return pairs[installId];
    });pairWrites=job.catch(()=>{});return job;
  }
  function authorized(installId:string,token:string){return !!token && pairs[installId]===token;}
  const store=new ContentStore(resolve(dataDir,'content.json'));
  const requireKeewano=process.env.SPOILERSCROLL_HISTORY_SOURCE==='keewano';
  const sqlConfig=requireKeewano?keewanoSqlConfig():undefined;
  const pool=sqlConfig?new pg.Pool(sqlConfig):undefined;
  const historyReader=dependencies.historyReader ?? new KeewanoHistoryReader(pool);
  let historyStatus=requireKeewano?'Keewano history configured, unverified':'Local captured-view history; Keewano records analytics asynchronously';
  const history:HistoryLookup=requireKeewano?keewanoBehaviorHistory(store,historyReader,status=>{historyStatus=status;}):{lookup:async({installId,before})=>{
    const state=await store.read(),beforeMs=Date.parse(before);
    const viewed=Object.values(state.records).filter(r=>r.observation.installId===installId && r.observation.dwellSeconds>=3 && Date.parse(r.receivedAt)<beforeMs && Date.parse(r.receivedAt)>=beforeMs-86400000).map(r=>({observationId:r.observation.observationId,contentId:r.observation.contentId,scope:r.observation.scope}));
    return {status:'ready',source:'cache',fetchedAt:new Date().toISOString(),queryId:'local-confirmed:v1',viewed};
  }};
  // Recompute decisions from the selected source instead of retaining unavailable reads.
  await store.update(state=>{
    for(const cached of Object.values(state.decisions)) {
      const previous=cached.history as {queryId?: unknown} | undefined;
      if(typeof previous?.queryId!=='string' || !previous.queryId.startsWith(requireKeewano?'keewano-confirmed:':'local-confirmed:')) {
        cached.decision={status:'pending',intervene:false,matchedContentIds:[]};
        cached.expiresAt=0;
      }
    }
  });
  const provider=process.env.MODEL_RPC_URL?new HttpModelProvider({endpoint:process.env.MODEL_RPC_URL,token:process.env.MODEL_RPC_TOKEN??'',model:process.env.MODEL_NAME??'',revision:process.env.MODEL_REVISION??''}):new LocalExtractiveProvider();
  const extraction=new ExtractionIntegration(historyReader,new DarwinSearch(),[],new Set(['https://www.reddit.com','https://old.reddit.com']));
  const wrappedProvider={mode:provider.mode,name:provider.name,revision:provider.revision,understand:async(o:import('./content/types.js').Observation)=>{
    // A short visible title is valid evidence for local title comparison, not a reason to crawl.
    if(provider.mode==='local' && o.visibleText.trim().length<40)return provider.understand(o);
    const result=await extraction.extract({site:o.site,contentType:'text-preview',publicUrl:o.url,remoteConsent:true,localDom:async()=>({text:o.visibleText,scope:o.scope,evidence:[{quote:o.visibleText,start:0,end:o.visibleText.length}]})});
    // Local extraction is the normal path; discovery outcomes never claim provider success.
    if(result.events.some(e=>e.state==='discovered'))await writeFile(resolve(dataDir,`extraction-${createHash('sha256').update(o.observationId).digest('hex')}.json`),JSON.stringify(result.events),{mode:0o600});
    if(!result.extraction)throw new Error('Insufficient extractable preview');
    return provider.understand({...o,visibleText:result.extraction.text,scope:result.extraction.scope});
  }};
  const pipeline=new DecisionPipeline(store,wrappedProvider,history);
  const outboxPath=resolve(dataDir,'analytics-outbox.json');
  let sent:string[]=[];
  try {sent=JSON.parse(await readFile(outboxPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const delivered=new Set(sent);
  let shipping:Promise<void>|undefined;
  function flushAnalytics() {
    if(shipping)return shipping;
    shipping=(async()=>{
      const state=await store.read();
      for(const record of Object.values(state.records)) {
        if(record.observation.dwellSeconds<3 || delivered.has(record.id))continue;
        await trackContentEvent({installId:record.observation.installId,contentId:record.observation.contentId,site:record.observation.site,action:'ContentViewed',summaryId:record.id,agentId:'local-dom'});
        delivered.add(record.id);
        const tmp=outboxPath+'.tmp';await writeFile(tmp,JSON.stringify([...delivered]),{mode:0o600});await rename(tmp,outboxPath);
      }
    })().finally(()=>{shipping=undefined;});return shipping;
  }
  const interval=setInterval(()=>{void pipeline.drain().catch(()=>{});void flushAnalytics().catch(()=>{});},2000);interval.unref();
  void pipeline.drain().catch(()=>{});void flushAnalytics().catch(()=>{});
  return {origin,extensionId,pair,authorized,store,pipeline,extraction,flushAnalytics,
    status:()=>({mode:provider.mode,detector:provider.name,history:historyStatus,darwin:'discovery fallback; no verified execution adapter',extensionId}),
    close:async()=>{clearInterval(interval);await pipeline.drain();await flushAnalytics();await pool?.end();}};
}
export type Runtime=Awaited<ReturnType<typeof createRuntime>>;
