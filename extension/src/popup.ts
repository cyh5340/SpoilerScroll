import { allowedRedditPage, BACKEND_ORIGIN, REDDIT_ORIGINS } from './policy';
import { send, type Store } from './types';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let state:Store|undefined;
let consentEdited=false;
const status=$('status');
$('consent').addEventListener('change',()=>{consentEdited=true;});
function render(next:Store) {
  state=next;
  $('mode').textContent=next.settings.paused?'Paused':next.settings.mode==='fixture'?'Local demo':'Reddit';
  $('views').textContent=String(next.stats.views);$('repeats').textContent=String(next.stats.repeats);$('skips').textContent=String(next.stats.skipped);
  const pause=$<HTMLButtonElement>('pause');pause.disabled=false;pause.textContent=next.settings.paused?'Resume spoilers':'Pause spoilers';
  $('queue').textContent=`${next.queue.length} pending items. Events expire after 24 hours. ${next.delivery}`;
  if(!consentEdited)$<HTMLInputElement>('consent').checked=next.settings.remoteConsent;
  status.textContent=next.settings.mode==='fixture'?'Local demo uses scripted matches; it does not exercise Keewano.':next.delivery;
}
async function update(patch:Parameters<typeof send>[0] & {type:'SETTINGS'}) {
  const reply=await send(patch);if(!reply.ok)throw new Error(reply.error??'Settings could not be saved');if(reply.state)render(reply.state);
}
function run(fn:()=>Promise<void>) {void fn().catch(error=>{status.textContent=error instanceof Error?error.message:'Extension request failed';});}
$('demo').addEventListener('click',()=>run(async()=>{
  await update({type:'SETTINGS',patch:{mode:'fixture',paused:false}});
  await chrome.tabs.create({url:chrome.runtime.getURL('fixture.html')});
}));
$('pause').addEventListener('click',()=>run(async()=>{
  if(!state)return;await update({type:'SETTINGS',patch:{paused:!state.settings.paused}});
}));
$('enable').addEventListener('click',()=>{
  const consent=$<HTMLInputElement>('consent').checked;
  if(!consent){status.textContent='Review and accept remote processing before enabling Reddit.';return;}
  // Request permissions directly in the user gesture, before any awaits.
  const permission=chrome.permissions.request({origins:[...REDDIT_ORIGINS,BACKEND_ORIGIN]});
  run(async()=>{
    if(!await permission){status.textContent='Permission was not granted. Reddit remains unchanged.';return;}
    const paired=await send({type:'PAIR'});
    if(!paired.ok)throw new Error(paired.error??'Backend pairing failed');
    await update({type:'SETTINGS',patch:{mode:'live',redditEnabled:true,paused:false,remoteConsent:true}});
    const tabs=await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab=>tab.id!==undefined && tab.url && REDDIT_ORIGINS.some(origin=>tab.url!.startsWith(origin.replace('*','')))).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id!},files:['content.js']})));
    status.textContent='Connected. Views will be sent to Keewano; detection requires Keewano history access.';
  });
});
$('clear').addEventListener('click',()=>run(async()=>{
  const reply=await send({type:'CLEAR_QUEUE'});if(reply.state)render(reply.state);
}));
run(async()=>{
  const reply=await send({type:'STATE'});if(reply.state)render(reply.state);else throw new Error(reply.error);
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==undefined && tab.url && allowedRedditPage(tab.url)) {
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      const page=await chrome.tabs.sendMessage(tab.id,{type:'PAGE_STATUS'});
      if(!page?.connected)throw new Error('No page handshake');
      $('tab-status').textContent=`Page connected (${page.build}) · ${page.cards} detected posts. ${page.error || (page.active?'Close this popup to resume capture.':'Monitoring is inactive; enable Reddit or resume spoilers.')}`;
    }catch {
      $('tab-status').textContent='Page script could not connect. Click “Allow Reddit and connect”, then refresh the Reddit tab.';
    }
  }else $('tab-status').textContent='Open a public Reddit feed, post, or post search to monitor it.';
});

setInterval(()=>{void send({type:'STATE'}).then(reply=>{if(reply.state)render(reply.state);}).catch(()=>{});},2000);
