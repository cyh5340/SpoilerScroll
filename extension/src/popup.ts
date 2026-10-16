import { SITE_ORIGINS, supportedPage } from './policy';
import { send, type Settings, type Store } from './types';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let state:Store|undefined;
const status=$('status');
function render(next:Store) {
  state=next;
  $('mode').textContent=next.settings.paused?'Paused':next.settings.enabled?'On':'Off';
  for(const key of ['shown','skipped','continued'] as const)$(key).textContent=String(next.stats[key]);
  $<HTMLSelectElement>('range').value=String(next.settings.rangeDays);
  $<HTMLSelectElement>('words').value=String(next.settings.minShared);
  const pause=$<HTMLButtonElement>('pause');pause.disabled=false;pause.textContent=next.settings.paused?'Resume':'Pause';
  status.textContent=next.settings.enabled?'On. Links on every site are matched against your history.':'Off. Nothing is checked until you turn it on above.';
  $('off').hidden=next.settings.enabled;
  $<HTMLButtonElement>('pause').hidden=!next.settings.enabled && !next.settings.paused;
}
async function update(patch:Partial<Settings>) {
  const reply=await send({type:'SETTINGS',patch});if(!reply.ok)throw new Error(reply.error??'Settings could not be saved');if(reply.state)render(reply.state);
}
function run(fn:()=>Promise<void>) {void fn().catch(error=>{status.textContent=error instanceof Error?error.message:'Extension request failed';});}
$('range').addEventListener('change',()=>run(()=>update({rangeDays:Number($<HTMLSelectElement>('range').value)})));
$('words').addEventListener('change',()=>run(()=>update({minShared:Number($<HTMLSelectElement>('words').value)})));
$('pause').addEventListener('click',()=>run(async()=>{if(state)await update({paused:!state.settings.paused});}));
$('enable').addEventListener('click',()=>{
  // Request permissions directly in the user gesture, before any awaits.
  const permission=chrome.permissions.request({permissions:['history'],origins:SITE_ORIGINS});
  run(async()=>{
    if(!await permission){status.textContent='Permission was not granted. SpoilerScroll remains off.';return;}
    await update({enabled:true,paused:false});
    const tabs=await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab=>tab.id!==undefined && tab.url && supportedPage(tab.url)).map(tab=>chrome.scripting.executeScript({target:{tabId:tab.id!},files:['content.js']})));
    status.textContent='On. Refresh the pages you have open.';
  });
});
run(async()=>{
  const reply=await send({type:'STATE'});if(reply.state)render(reply.state);else throw new Error(reply.error);
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==undefined && tab.url && supportedPage(tab.url) && state?.settings.enabled) {
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      const page=await chrome.tabs.sendMessage(tab.id,{type:'PAGE_STATUS'});
      if(!page?.connected)throw new Error('No page handshake');
      $('tab-status').textContent=page.error || `This tab: ${page.flagged} of ${page.cards} posts match your history.`;
    }catch {$('tab-status').textContent='Page script could not connect. Refresh this tab.';}
  }else $('tab-status').textContent=state?.settings.enabled?'This page cannot be checked.':'Enable SpoilerScroll to check this page.';
});
setInterval(()=>{void send({type:'STATE'}).then(reply=>{if(reply.state)render(reply.state);}).catch(()=>{});},2000);
