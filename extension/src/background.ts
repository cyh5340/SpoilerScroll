import { SITE_ORIGINS, supportedPage } from './policy';
import { indexHistory, matchPost, MIN_SHARED, RANGE_DAYS, type HistoryEntry, type HistoryIndex } from './match';
import type { Action, Candidate, Message, Reply, Store } from './types';

const KEY='spoilerscroll-v2';
const LIST_LIMIT=50;
const fixtureUrl=chrome.runtime.getURL('fixture.html');
const defaults=():Store=>({settings:{enabled:false,paused:false,rangeDays:7,minShared:3},stats:{shown:0,skipped:0,continued:0}});
let transaction: Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>): Promise<T> {
  const result=transaction.then(fn); transaction=result.catch(()=>{});return result;
}
async function load():Promise<Store> {
  const stored=(await chrome.storage.local.get(KEY))[KEY] as Store|undefined;
  const base=defaults();
  return stored?{settings:{...base.settings,...stored.settings},stats:{...base.stats,...stored.stats}}:base;
}
async function save(state:Store) {await chrome.storage.local.set({[KEY]:state});}
const fromPopup=(sender:chrome.runtime.MessageSender)=>sender.url===chrome.runtime.getURL('popup.html');
const fromFixture=(sender:chrome.runtime.MessageSender)=>sender.url?.split('?')[0]===fixtureUrl;
const fromSite=(sender:chrome.runtime.MessageSender)=>!!sender.url && supportedPage(sender.url) && !sender.tab?.incognito;
async function granted() {
  return chrome.permissions.contains({permissions:['history'],origins:SITE_ORIGINS});
}

// Scripted entries so the demo page works without history permission or any network access.
function demoHistory():HistoryEntry[] {
  const hours=(n:number)=>Date.now()-n*3_600_000;
  return [
    {url:`${fixtureUrl}?history=1`,title:'AI tools are automating routine programming tasks for developers',lastVisitTime:hours(2)},
    {url:`${fixtureUrl}?history=2`,title:'Will AI replace developers? Routine programming tasks are already automated',lastVisitTime:hours(26)},
    {url:`${fixtureUrl}?history=3`,title:'Developers now review AI-generated code as programming tasks change',lastVisitTime:hours(75)},
  ];
}
let cache:{days:number;at:number;index:HistoryIndex}|undefined;
async function recentHistory(days:number):Promise<HistoryIndex> {
  if(cache && cache.days===days && Date.now()-cache.at<5000)return cache.index;
  const items=await chrome.history.search({text:'',startTime:Date.now()-days*86_400_000,maxResults:100_000});
  // Every visit in the range counts, titled or not; an untitled page can still match by URL.
  const index=indexHistory(items.filter(i=>i.url).map(i=>({url:i.url!,title:i.title??'',lastVisitTime:i.lastVisitTime??0})));
  cache={days,at:Date.now(),index};
  return index;
}
function validCards(cards:unknown):Candidate[] {
  if(!Array.isArray(cards) || cards.length>5000)throw new Error('Invalid cards');
  for(const c of cards)for(const [field,max] of [['contentId',4096],['url',4096],['title',500],['text',2000]] as const)
    if(!c || typeof c[field]!=='string' || (!c[field] && (field==='contentId' || field==='url')) || c[field].length>max)throw new Error('Invalid card');
  return cards;
}
async function syncScripts(enabled:boolean) {
  const ids=(await chrome.scripting.getRegisteredContentScripts()).map(s=>s.id);
  if(ids.length)await chrome.scripting.unregisterContentScripts({ids});
  if(enabled)await chrome.scripting.registerContentScripts([{id:'sites',matches:SITE_ORIGINS,js:['content.js'],runAt:'document_idle',persistAcrossSessions:true}]);
}
// Any new visit invalidates the cache and tells open pages to recheck, so a revisited post is caught at once.
let historyTimer:ReturnType<typeof setTimeout>|undefined;
function watchHistory() {
  if(!chrome.history?.onVisited || chrome.history.onVisited.hasListener(historyVisited))return;
  chrome.history.onVisited.addListener(historyVisited);
}
function historyVisited() {
  cache=undefined;
  clearTimeout(historyTimer);
  historyTimer=setTimeout(()=>void broadcast('HISTORY_CHANGED'),300);
}
async function broadcast(type='CONFIG_CHANGED') {
  const tabs=await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(t=>t.id!==undefined).map(t=>chrome.tabs.sendMessage(t.id!,{type})));
}

async function handle(message:Message,sender:chrome.runtime.MessageSender):Promise<Reply> {
  if(message.type==='STATE') {
    if(!fromPopup(sender) && !fromFixture(sender) && !fromSite(sender))return {ok:false,error:'Unsupported page'};
    return {ok:true,state:await serial(load)};
  }
  if(message.type==='MATCH') {
    const state=await serial(load),fixture=fromFixture(sender);
    if(state.settings.paused)return {ok:true,matches:{}};
    if(!fixture && !(fromSite(sender) && state.settings.enabled && await granted()))return {ok:false,error:'Enable SpoilerScroll in the extension popup'};
    const cards=validCards(message.cards);
    const index=fixture?indexHistory(demoHistory()):await recentHistory(state.settings.rangeDays);
    const matches:Record<string,ReturnType<typeof matchPost>>={},counts:Record<string,number>={};
    for(const card of cards) {
      const found=matchPost(card,index,{minShared:state.settings.minShared,excludeUrl:message.pageUrl,excludeTitle:typeof message.pageTitle==='string'?message.pageTitle:undefined});
      // Every match is counted; only the strongest are sent for listing, to keep the message within Chrome's limit.
      if(found.length){matches[card.contentId]=found.slice(0,LIST_LIMIT);counts[card.contentId]=found.length;}
    }
    return {ok:true,matches,counts};
  }
  return serial(async()=>{
    const state=await load();
    if(message.type==='SETTINGS') {
      const patch=message.patch;
      if(!fromPopup(sender) && !(Object.keys(patch).length===1 && patch.paused===true))return {ok:false,error:'Settings require the extension popup'};
      for(const key of ['paused','enabled'] as const)if(patch[key]!==undefined && typeof patch[key]!=='boolean')throw new Error('Invalid settings');
      if(patch.rangeDays!==undefined && !(RANGE_DAYS as readonly number[]).includes(patch.rangeDays))throw new Error('Invalid range');
      if(patch.minShared!==undefined && !(MIN_SHARED as readonly number[]).includes(patch.minShared))throw new Error('Invalid word count');
      const next={...state.settings,...patch};
      if(next.enabled && !await granted())return {ok:false,error:'Site and history permissions are required'};
      const scripts=next.enabled!==state.settings.enabled;
      state.settings=next;await save(state);
      if(scripts)await syncScripts(next.enabled);
      void broadcast();return {ok:true,state};
    }
    if(message.type==='ACTION') {
      if(!fromFixture(sender) && !fromSite(sender))return {ok:false,error:'Unsupported page'};
      const action:Action=message.action;
      if(!(action in state.stats))throw new Error('Unknown action');
      state.stats[action]++;await save(state);return {ok:true};
    }
    return {ok:false,error:'Unknown message'};
  });
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  handle(message as Message,sender).then(respond).catch(()=>respond({ok:false,error:'Could not complete extension request'}));
  return true;
});
chrome.permissions.onAdded.addListener(watchHistory);
watchHistory();
chrome.permissions.onRemoved.addListener(()=>{
  void serial(async()=>{
    const state=await load();
    if(state.settings.enabled && !await granted()){state.settings.enabled=false;await save(state);await syncScripts(false);}
  }).then(()=>broadcast());
});
chrome.runtime.onInstalled.addListener(()=>{
  void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  // State from the backend-based builds; nothing in it carries over.
  void chrome.storage.local.remove('spoilerscroll');
});
// Restore dynamic registration whenever a rebuilt extension starts its worker.
void serial(load).then(async state=>syncScripts(state.settings.enabled && await granted())).catch(error=>console.error('SpoilerScroll script registration failed',error));
