import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeewanoHistoryReader, keewanoSqlConfig } from './keewano.js';
import { DarwinSearch, parseDarwinSearch } from './darwin.js';
import { comparisonHistory, ExtractionIntegration, selectExtractor, validateExtraction } from './extraction.js';
import type { Capability, ExecutionAdapter, HistoryReader, Performance, ViewedContent } from './contracts.js';
const installId = '11111111-1111-4111-8111-111111111111';
const text = 'This public article contains enough text for an evidence-grounded extraction.';
const extracted = {text,scope:'full',evidence:[{quote:'public article',start:5,end:19}]};
const first: Capability = {agentId:'exact:agent:A',capabilityId:'exact:cap:A',revision:17,readiness:'ready',canStartThread:true,metadata:{}};
const second: Capability = {...first,agentId:'exact:agent:B',capabilityId:'exact:cap:B'};
const perf: Performance[] = [{...first,site:'example.com',contentType:'article',attempts:10,successes:1},
  {...second,site:'example.com',contentType:'article',attempts:10,successes:9}];
const history: HistoryReader = {
  recentViewed: async()=>({status:'available',source:'fixture',data:[]}),
  extractorPerformance: async()=>({status:'available',source:'fixture',data:perf}),
};
test('fixture SQL reader binds install attribution, marker aggregation, limits and context',async()=> {
  let sql = '';
  const reader = new KeewanoHistoryReader({query:async q=>{sql=q;return {rows:[{install_id:installId,content_id:'post',site:'example.com',summary_id:'none',agent_id:'local-dom',views:'1',viewed_at:'2026-10-11T00:00:00Z'}]};}});
  const result = await reader.recentViewed(installId,new Date('2026-10-01'),12);
  assert.equal(result.status,'available');
  assert.match(sql,/count\("ContentViewed"\)/);
  assert.match(sql,/FILTER \(WHERE "ContentViewed" IS NOT NULL\)/);
  assert.match(sql,/LIMIT 12$/);
  assert.ok(sql.includes(`user_id = '${installId}'`));
  const mismatch = new KeewanoHistoryReader({query:async()=>({rows:[{install_id:'different'}]})});
  assert.deepEqual(await mismatch.recentViewed(installId,new Date()),{status:'unavailable',reason:'query'});
  await assert.rejects(()=>reader.recentViewed("' OR true",new Date()));
  assert.deepEqual(await reader.extractorPerformance('example.com','article',new Date()),{status:'unavailable',reason:'schema'});
});
test('fixture performance SQL uses only explicitly supplied schema and preserves identity',async()=> {
  let sql='';
  const reader = new KeewanoHistoryReader({query:async q=>{sql=q;return {rows:[{agent_id:first.agentId,capability_id:first.capabilityId,revision:17,attempts:'10',successes:'9'}]};}},
    {site:'SiteContext',contentType:'Type',agentId:'Agent',capabilityId:'Capability',revision:'Revision',attempt:'Attempt',success:'Success'});
  const result=await reader.extractorPerformance('example.com',"article's",new Date());
  assert.equal(result.status,'available'); assert.ok(sql.includes("'article''s'"));
  assert.ok(sql.includes('count("Attempt")'));
  if(result.status==='available') assert.equal(result.data[0].revision,17);
  assert.equal(keewanoSqlConfig({KEEWANO_API_KEY:'ingestion-only'}),undefined);
});
test('fixture Darwin v3 preserves exact identifiers/revisions and sends only capability query',async()=> {
  const body={contractVersion:'search-v3.0',response:{agents:[{agentId:first.agentId,capabilityId:first.capabilityId,capabilityRevision:17,readiness:'unavailable',canStartThread:false}]}};
  const found=parseDarwinSearch(body)[0]; assert.equal(found.revision,17);assert.equal(found.agentId,first.agentId);
  assert.equal(parseDarwinSearch({...body,response:{agents:[{...body.response.agents[0],capabilityRevision:undefined}]}})[0].revision,undefined);
  assert.throws(()=>parseDarwinSearch({...body,contractVersion:'other'}));
  const client=new DarwinSearch(async(url,init)=>{assert.equal(url,'https://api.darwin.so/api/v3/search');assert.deepEqual(JSON.parse(String(init?.body)),{query:'public text extractor',maxResults:5});return Response.json(body);});
  assert.equal((await client.search('public text extractor'))[0].capabilityId,first.capabilityId);
});
test('fixture queried performance visibly changes extractor choice, exact revision required',()=> {
  assert.equal(selectExtractor([first,second],[])?.agentId,first.agentId);
  assert.equal(selectExtractor([first,second],perf)?.agentId,second.agentId);
  assert.equal(selectExtractor([first,second],perf.map(p=>({...p,revision:18})))?.agentId,first.agentId);
});
test('fixture queried history changes comparison set; pending wins and other installs excluded',async()=> {
  const viewed: ViewedContent={installId,contentId:'prior',site:'example.com',summaryId:'old',agentId:'local-dom',viewedAt:'2026-10-11T00:00:00Z'};
  const reader: HistoryReader={...history,recentViewed:async()=>({status:'available',source:'fixture',data:[viewed,{...viewed,summaryId:'older',viewedAt:'2026-10-10T00:00:00Z'}]})};
  assert.equal((await comparisonHistory(reader,installId,new Date('2026-10-01'),[])).content[0].summaryId,'old');
  const result=await comparisonHistory(reader,installId,new Date('2026-10-01'),[{...viewed,summaryId:'pending'},{...viewed,installId:'other',contentId:'private'}]);
  assert.equal(result.content.length,1);assert.equal(result.content[0].summaryId,'pending');
});
test('fixture extraction separates discovery, readiness, attempt and validated success',async()=> {
  const calls:string[]=[];
  const adapters:ExecutionAdapter[]=[first,second].map(identity=>({identity,verified:true,execute:async(url)=>{calls.push(identity.agentId);assert.equal(url,'https://example.com/article');return extracted;}}));
  const integration=new ExtractionIntegration(history,{search:async()=>[first,second]},adapters,new Set(['https://example.com']));
  const result=await integration.extract({site:'example.com',contentType:'article',remoteConsent:true,publicUrl:'https://example.com/article',localDom:async()=>null});
  assert.deepEqual(calls,[second.agentId]);
  assert.deepEqual(result.events.map(e=>e.state),['failed','discovered','discovered','ready','attempted','extracted']);
  assert.equal(result.extraction?.text,text);
});
test('fixture local evidence avoids discovery; private URL and missing consent prevent execution',async()=> {
  let searches=0;
  const integration=new ExtractionIntegration(history,{search:async()=>{searches++;return [first];}});
  const base={site:'example.com',contentType:'article',remoteConsent:true,publicUrl:'https://example.com/article',localDom:async()=>extracted};
  assert.equal((await integration.extract(base)).extraction?.scope,'full');assert.equal(searches,0);
  for(const patch of [{remoteConsent:false},{publicUrl:'https://localhost/private'},{publicUrl:'https://example.com/article?token=private'}]) {
    const result=await integration.extract({...base,...patch,localDom:async()=>null});
    assert.ok(!result.events.some(e=>e.state==='attempted'));
  }
  assert.equal(searches,0);
});
test('fixture timeout, provider failure and invalid evidence fall back to local DOM',async()=> {
  for(const execute of [async()=>new Promise(()=>{}),async()=>{throw new Error('provider secret must not escape');},async()=>({...extracted,evidence:[{quote:'invented',start:0,end:8}]})]) {
    let localCalls=0;
    const integration=new ExtractionIntegration(history,{search:async()=>[first]},[{identity:first,verified:true,execute}],new Set(['https://example.com']),20);
    const result=await integration.extract({site:'example.com',contentType:'article',remoteConsent:true,publicUrl:'https://example.com/article',localDom:async()=>++localCalls===1 ? null:extracted});
    assert.equal(result.extraction?.text,text);
    assert.ok(result.events.some(e=>e.state==='failed' && ['timeout','provider','validation'].includes(e.reason)));
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.throws(()=>validateExtraction({...extracted,evidence:[]}));
});
test('fixture unavailable route is discovery, never execution',async()=> {
  const integration=new ExtractionIntegration(history,{search:async()=>[{...first,readiness:'unavailable',canStartThread:false}]},[],new Set(['https://example.com']));
  const result=await integration.extract({site:'example.com',contentType:'article',remoteConsent:true,publicUrl:'https://example.com/article',localDom:async()=>null});
  assert.ok(result.events.some(e=>e.state==='discovered'));
  assert.ok(!result.events.some(e=>e.state==='attempted'));
});
