import { allowedRedditPage, BACKEND_ORIGIN, COOLDOWN_MS, REDDIT_ORIGINS, SESSION_IDLE_MS } from './policy';
import { deliver, DeliveryError, getDecision, pairBackend, prepareCandidate } from './client';
import { unavailable, type Store, type Message, type Candidate, type Reply } from './types';

const KEY='spoilerscroll';
const fixtureUrl=chrome.runtime.getURL('fixture.html');
let transaction: Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>): Promise<T> {
  const result=transaction.then(fn); transaction=result.catch(()=>{});return result;
}
async function load():Promise<Store> {
  const stored=(await chrome.storage.local.get(KEY))[KEY] as Store|undefined;
  return stored??{settings:{redditEnabled:false,paused:true,mode:'fixture',remoteConsent:false,pairingToken:''},installId:crypto.randomUUID(),sessionId:crypto.randomUUID(),lastActivity:0,seen:[],queue:[],fixtureSeen:[],stats:{views:0,repeats:0,skipped:0,continued:0},delivery:'Not connected',lastIntervention:0,intervened:[]};
}
async function save(state:Store) {await chrome.storage.local.set({[KEY]:state});}
function publicState(state: Store):Store {return {...state,settings:{...state.settings,pairingToken:state.settings.pairingToken?'configured':''}};}
function internal(sender:chrome.runtime.MessageSender) {return sender.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html');}
function fixtureSender(sender:chrome.runtime.MessageSender) {return sender.url?.split('?')[0]===fixtureUrl;}
async function permitted(state:Store,sender:chrome.runtime.MessageSender) {
  if (sender.id!==chrome.runtime.id || sender.tab?.incognito || state.settings.paused) return false;
  if (state.settings.mode==='fixture') return fixtureSender(sender);
  return state.settings.redditEnabled && state.settings.remoteConsent && !!state.settings.pairingToken && !!sender.url && allowedRedditPage(sender.url) && await chrome.permissions.contains({origins:[new URL(sender.url).origin+'/*',BACKEND_ORIGIN]});
}
function validCandidate(candidate:Candidate, fixture:boolean) {
  if (!candidate || typeof candidate!=='object') throw new Error('Invalid card');
  for (const [field,max] of [['contentId',256],['url',2048],['title',500],['visibleText',4000]] as const) {
    if (typeof candidate[field]!=='string' || candidate[field].length>max || (field!=='visibleText' && !candidate[field])) throw new Error('Invalid card');
  }
  if (candidate.scope!=='preview') throw new Error('Unsupported extraction scope');
  if (fixture) {
    if (candidate.site!=='localhost' || !/^fixture-[1-5]$/.test(candidate.contentId) || !candidate.url.startsWith(fixtureUrl+'?story=')) throw new Error('Invalid fixture card');
  } else if (!['www.reddit.com','old.reddit.com'].includes(candidate.site) || !/^reddit:[a-z0-9]+$/i.test(candidate.contentId) || !/^https:\/\/(www|old)\.reddit\.com\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+/i.test(candidate.url) || new URL(candidate.url).hostname!==candidate.site || new URL(candidate.url).search || new URL(candidate.url).hash) throw new Error('Invalid public card');
}
function renewSession(state: Store) {
  if (Date.now()-state.lastActivity>SESSION_IDLE_MS) {
    state.sessionId=crypto.randomUUID();state.seen=[];state.fixtureSeen=[];state.observationIds={};
    state.stats={views:0,repeats:0,skipped:0,continued:0};state.lastIntervention=0;state.intervened=[];
  }
  state.lastActivity=Date.now();
}
async function broadcast() {
  const tabs=await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t=>t.id!==undefined).map(t=>chrome.tabs.sendMessage(t.id!,{type:'CONFIG_CHANGED'})));
}
async function registerReddit(enabled:boolean) {
  await chrome.scripting.unregisterContentScripts({ids:['reddit-feed']}).catch(()=>{});
  if (!enabled) return;
  for (const [index,origin] of REDDIT_ORIGINS.entries()) {
    if (!await chrome.permissions.contains({origins:[origin]})) continue;
    const id=`reddit-feed-${index}`;
    await chrome.scripting.unregisterContentScripts({ids:[id]}).catch(()=>{});
    await chrome.scripting.registerContentScripts([{id,matches:[origin],js:['content.js'],runAt:'document_idle',allFrames:false,persistAcrossSessions:true}]);
  }
}
async function unregisterReddit() {
  const scripts=await chrome.scripting.getRegisteredContentScripts();
  const ids=scripts.filter(s=>s.id.startsWith('reddit-feed')).map(s=>s.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ids});
}
let flushing=false;
async function flush() {
  if (flushing) return;
  flushing=true;
  try {
    while (true) {
      const state=await serial(load);
      if (state.settings.paused || state.settings.mode!=='live' || !state.settings.remoteConsent || !state.settings.pairingToken || !await chrome.permissions.contains({origins:[BACKEND_ORIGIN]})) return;
      const item=state.queue[0];if(!item)return;
      if (Date.now()-item.createdAt>86_400_000) {
        await serial(async()=>{const current=await load();current.queue=current.queue.filter(q=>q.id!==item.id);current.delivery='Expired queued event removed';await save(current);});continue;
      }
      try {
        await deliver(item,state.settings.pairingToken);
        await serial(async()=>{const current=await load();current.queue=current.queue.filter(q=>q.id!==item.id);current.delivery='Backend accepted; Keewano processing may still be pending';await save(current);});
      } catch(error) {
        await serial(async()=>{const current=await load();current.delivery=error instanceof DeliveryError?`Backend ${error.status}; queued for retry`:'Backend unavailable; queued for retry';await save(current);});return;
      }
    }
  } finally {flushing=false;}
}

async function handle(message:Message,sender:chrome.runtime.MessageSender):Promise<Reply> {
  if(message.type==='PAIR') {
    if(!internal(sender))return{ok:false,error:'Pair through the extension popup'};
    const state=await serial(load);
    if(!await chrome.permissions.contains({origins:[BACKEND_ORIGIN]}))return{ok:false,error:'Allow the local backend permission first'};
    try {
      const paired=await pairBackend(state.installId);
      return await serial(async()=>{const current=await load();current.settings.pairingToken=paired.token;current.settings.remoteConsent=true;current.backendMode=paired.mode;current.delivery=paired.mode==='local'?'Connected · local extractive summaries; exact repeats only. '+paired.history:'Connected · model configured. '+paired.history;await save(current);return{ok:true,state:publicState(current)};});
    }catch{return{ok:false,error:'Cannot pair. Start npm start, then reload the rebuilt extension.'};}
  }
  if (message.type==='DECISION') {
    const state=await serial(load);
    if (!await permitted(state,sender)) return {ok:true,decision:unavailable};
    validCandidate(message.candidate,fixtureSender(sender));
    if(state.settings.mode==='fixture') {
      const prior=['fixture-1','fixture-2','fixture-3'].filter(id=>state.fixtureSeen.includes(id));
      const repeat=message.candidate.contentId==='fixture-4' && prior.length===3;
      return {ok:true,decision:{status:'ready',intervene:repeat,matchedContentIds:repeat?prior:[],scope:'preview',spoiler:repeat?'This preview repeats the claim that AI automates routine programming tasks while developers still review the results. You have seen that same claim in three demo previews.':undefined,reason:'Scripted local fixture. No model, Darwin, or Keewano calls. The five-minute browsing gate is disabled for this demo.'}};
    }
    const fingerprint=JSON.stringify(message.candidate),version=`${state.sessionId}:${state.stats.views}:${message.pageEnteredAt??''}:${Math.floor(Date.now()/15000)}`;
    const saved=state.candidateIds?.[message.candidate.contentId];
    const id=saved?.fingerprint===fingerprint && saved.version===version?saved.id:crypto.randomUUID();
    await serial(async()=>{const current=await load();current.candidateIds??={};current.candidateIds[message.candidate.contentId]={id,fingerprint,version};await save(current);});
    await prepareCandidate({...message.candidate,observationId:id,installId:state.installId,sessionId:state.sessionId,dwellSeconds:0,...(message.pageEnteredAt!==undefined?{pageEnteredAt:message.pageEnteredAt}:{})},state.settings.pairingToken);
    const decision=await getDecision(state.installId,id,state.settings.pairingToken);
    const current=await serial(load);
    return {ok:true,decision:await permitted(current,sender)?decision:unavailable};
  }
  return serial(async()=>{
    const state=await load();
    if (message.type==='STATE') {
      if (!internal(sender) && !fixtureSender(sender) && !(sender.url && allowedRedditPage(sender.url))) return {ok:false,error:'Unsupported page'};
      await save(state);return {ok:true,state:publicState(state)};
    }
    if (message.type==='SETTINGS') {
      if (!internal(sender) && !(Object.keys(message.patch).length===1 && message.patch.paused===true && await permitted(state,sender))) return {ok:false,error:'Settings require extension popup'};
      const patch=message.patch;
      if (patch.mode!==undefined && !['fixture','live'].includes(patch.mode)) throw new Error('Invalid mode');
      for(const key of ['paused','redditEnabled','remoteConsent'] as const) if(patch[key]!==undefined && typeof patch[key]!=='boolean') throw new Error('Invalid settings');
      if(patch.pairingToken!==undefined && (typeof patch.pairingToken!=='string' || patch.pairingToken.length>512 || /[\r\n]/.test(patch.pairingToken))) throw new Error('Invalid pairing token');
      const next={...state.settings,...patch};
      if (next.mode==='live' && !next.paused) {
        const granted=(await Promise.all(REDDIT_ORIGINS.map(origin=>chrome.permissions.contains({origins:[origin]})))).some(Boolean);
        if(!next.remoteConsent || !next.pairingToken || !next.redditEnabled || !granted || !await chrome.permissions.contains({origins:[BACKEND_ORIGIN]})) throw new Error('Consent, Reddit permission and backend pairing are required');
      }
      if (next.mode!==state.settings.mode) {
        state.stats={views:0,repeats:0,skipped:0,continued:0};state.seen=[];state.fixtureSeen=[];state.observationIds={};state.intervened=[];state.lastIntervention=0;state.sessionId=crypto.randomUUID();state.lastActivity=Date.now();
      }
      state.settings=next;await save(state);
      if(next.redditEnabled) await registerReddit(true);else await unregisterReddit();
      void broadcast();void flush();return {ok:true,state:publicState(state)};
    }
    if (message.type==='RESET_FIXTURE') {
      if(!fixtureSender(sender) && !internal(sender)) throw new Error('Not a fixture');
      state.fixtureSeen=[];state.seen=[];state.intervened=[];state.lastIntervention=0;state.lastActivity=Date.now();state.sessionId=crypto.randomUUID();state.stats={views:0,repeats:0,skipped:0,continued:0};await save(state);void broadcast();return {ok:true};
    }
    if(message.type==='CLEAR_QUEUE') {
      if(!internal(sender))throw new Error('Settings require extension popup');
      state.queue=[];state.delivery='Local pending queue cleared; backend history unchanged';await save(state);return{ok:true,state:publicState(state)};
    }
    if(!await permitted(state,sender))return {ok:false,error:'Monitoring is paused or unavailable'};
    validCandidate(message.candidate,fixtureSender(sender));
    if(message.type==='POST_CLICK') {
      const previous=state.clickedPosts?.[message.candidate.contentId];
      state.clickedPosts??={};
      state.clickedPosts[message.candidate.contentId]={at:Date.now(),candidate:message.candidate};
      for(const [id,item]of Object.entries(state.clickedPosts))if(Date.now()-item.at>86400000)delete state.clickedPosts[id];
      const entries=Object.entries(state.clickedPosts).sort((a,b)=>b[1].at-a[1].at);
      state.clickedPosts=Object.fromEntries(entries.slice(0,500));
      await save(state);
      return {ok:true,...(previous && Date.now()-previous.at<=86400000?{decision:{status:'ready' as const,intervene:true,scope:'preview' as const,matchedContentIds:[message.candidate.contentId],reason:'same_post_clicked_before_local',spoiler:`You already clicked this post: “${previous.candidate.title}”. Captured preview: “${previous.candidate.visibleText.slice(0,500)}”. This reminder uses the visible preview only.`}}:{})};
    }
    if(message.type==='OBSERVE') {
      if(!Number.isFinite(message.dwellSeconds) || message.dwellSeconds<3 || message.dwellSeconds>3600)throw new Error('Invalid dwell');
      if(sender.tab?.id!==undefined) {
        const tab=await chrome.tabs.get(sender.tab.id);
        const win=await chrome.windows.get(tab.windowId);
        if(!tab.active || !win.focused)return {ok:false,error:'Tab is not active'};
      }
      renewSession(state);
      if(state.seen.includes(message.candidate.contentId))return{ok:true};
      if(state.queue.length>=500 && state.settings.mode==='live')return{ok:false,error:'Pending queue is full'};
      state.seen.push(message.candidate.contentId);state.seen=state.seen.slice(-2000);state.stats.views++;
      if(state.settings.mode==='fixture')state.fixtureSeen.push(message.candidate.contentId);
      else {
        const observationId=crypto.randomUUID();
        state.observationIds??={};state.observationIds[message.candidate.contentId]={id:observationId,fingerprint:JSON.stringify(message.candidate)};
        state.queue.push({id:observationId,path:'/observations',createdAt:Date.now(),body:{...message.candidate,observationId,installId:state.installId,sessionId:state.sessionId,dwellSeconds:message.dwellSeconds}});
      }
    } else if(message.type==='CLAIM') {
      renewSession(state);
      if(!message.explicit && (state.intervened.includes(message.candidate.contentId) || Date.now()-state.lastIntervention<COOLDOWN_MS))return{ok:true,claimed:false};
      state.lastIntervention=Date.now();state.intervened.push(message.candidate.contentId);await save(state);return {ok:true,claimed:true};
    } else if(message.type==='ACTION') {
      if(!['SpoilerShown','SpoilerSkipped','ReadAnyway','FalsePositiveReported'].includes(message.action))throw new Error('Unknown action');
      if(state.queue.length>=500 && state.settings.mode==='live')return{ok:false,error:'Pending queue is full'};
      renewSession(state);
      if(message.action==='SpoilerShown')state.stats.repeats++;
      if(message.action==='SpoilerSkipped')state.stats.skipped++;
      if(message.action==='ReadAnyway')state.stats.continued++;
      if(state.settings.mode==='live')state.queue.push({id:crypto.randomUUID(),path:'/events',createdAt:Date.now(),body:{installId:state.installId,contentId:message.candidate.contentId,site:message.candidate.site,action:message.action}});
    }
    await save(state);void flush();return{ok:true};
  });
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  handle(message as Message,sender).then(respond).catch(()=>respond({ok:false,error:'Could not complete extension request'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='delivery')void flush();});
chrome.permissions.onRemoved.addListener(()=>{
  void serial(async()=>{const state=await load();state.settings.paused=true;await save(state);}).then(broadcast);
});
chrome.runtime.onInstalled.addListener(()=>{
  void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  void serial(async()=>save(await load()));
  void chrome.alarms.create('delivery',{periodInMinutes:1});
});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.create('delivery',{periodInMinutes:1});void flush();});
// Restore dynamic registration whenever a rebuilt extension starts its worker.
void serial(load).then(state=>registerReddit(state.settings.redditEnabled)).catch(error=>console.error('SpoilerScroll script registration failed',error));
