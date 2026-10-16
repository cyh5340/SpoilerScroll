import { scanCards, candidateKey, type Card } from './adapter';
import { clickIntent, supportedPage } from './policy';
import { createBadge, createNotice, showOverlay } from './overlay';
import { canonicalUrl, type HistoryMatch } from './match';
import { send, type Store } from './types';

const marker='__spoilerScrollLoaded';
const win=window as unknown as Record<string,unknown>;
const previous=win[marker] as {alive?:()=>boolean;stop?:()=>void}|undefined;
if(!previous || typeof previous.alive!=='function' || !previous.alive()) {
  previous?.stop?.();
  document.querySelectorAll('[data-spoilerscroll-ui]').forEach(el=>el.remove());
  win[marker]={alive:()=>{try{return !!chrome.runtime.getManifest();}catch{return false;}},stop:start()};
}
function start() {
  const fixture=location.href.startsWith(chrome.runtime.getURL('fixture.html'));
  let state:Store|undefined;
  let closeOverlay:(()=>void)|undefined;
  const cards=new Map<HTMLElement,Card>();
  let matches:Record<string,HistoryMatch[]>={},counts:Record<string,number>={};
  const badges=new Map<HTMLElement,HTMLElement>();
  let notice:ReturnType<typeof createNotice>|undefined;
  let error='';
  let lookedUp='';
  let epoch=0;
  // True until a lookup that started after the latest history change has finished.
  let stale=true,generation=0;
  const active=()=>!!state && !state.settings.paused && (fixture || (state.settings.enabled && supportedPage(location.href)));
  function updateNotice() {
    const flagged=[...cards.values()].filter(c=>matches[c.candidate.contentId]).length;
    if(!fixture && !active() && !error){notice?.host.remove();notice=undefined;return;}
    notice??=createNotice(fixture);
    const days=state?.settings.rangeDays===1?'day':`${state?.settings.rangeDays} days`;
    notice.set(error?`SpoilerScroll · ${error}`:!state?'SpoilerScroll · Connecting…':state.settings.paused?'SpoilerScroll · Paused':!active()?'SpoilerScroll · Open the extension to enable it':
      `SpoilerScroll · ${flagged} of ${cards.size} links here match pages\nfrom your history (last ${days})`);
  }
  function renderBadges() {
    for(const [element,card] of cards) {
      const count=counts[card.candidate.contentId]??0;
      const badge=badges.get(element);
      if(badge && badge.dataset.count!==String(count)){badge.remove();badges.delete(element);}
      if(count && !badges.has(element)) {
        const next=createBadge(fixture,count);next.dataset.count=String(count);
        // A bare link gets its badge right after it; a post card gets it inside, at the end.
        if(element instanceof HTMLAnchorElement)element.after(next);else element.append(next);
        badges.set(element,next);
      }
    }
  }
  function clearVisuals() {for(const badge of badges.values())badge.remove();badges.clear();closeOverlay?.();closeOverlay=undefined;matches={};counts={};lookedUp='';}
  async function lookup(force=false) {
    if(!active())return;
    const list=[...cards.values()].map(c=>c.candidate);
    const key=JSON.stringify([location.href,list.map(candidateKey)]);
    if(!force && key===lookedUp)return;
    lookedUp=key;
    const version=epoch,started=generation;
    try {
      const reply=await send({type:'MATCH',cards:list,pageUrl:location.href,pageTitle:document.title});
      if(version!==epoch || !active())return;
      if(!reply.ok){error=reply.error??'History lookup failed';lookedUp='';}
      else {error='';matches=reply.matches??{};counts=reply.counts??{};renderBadges();if(started===generation)stale=false;}
    } catch {error='Extension reloaded — refresh this tab';}
    updateNotice();
  }
  function historyChanged() {generation++;stale=true;void lookup(true);}
  async function refresh() {
    try {
      const reply=await send({type:'STATE'});
      if(!reply.ok || !reply.state){state=undefined;error=reply.error??'Open the extension to reconnect';clearVisuals();updateNotice();return;}
      const before=JSON.stringify(state?.settings);
      state=reply.state;
      if(before!==JSON.stringify(state.settings)){epoch++;clearVisuals();}
      if(fixture)document.querySelector('[data-fixture-state]')!.textContent=state.settings.paused?'Paused':`Matching titles that share at least ${state.settings.minShared} words`;
      if(active()){scan();await lookup();}
      updateNotice();
    } catch {state=undefined;error='Extension reloaded — refresh this tab';clearVisuals();updateNotice();}
  }
  let lastUrl=location.href;
  function scan() {
    if(lastUrl!==location.href){lastUrl=location.href;epoch++;clearVisuals();cards.clear();}
    if(!active())return;
    const found=scanCards(fixture);
    // The scan is the whole truth: drop links that are gone or no longer chosen for their address.
    const current=new Set(found.map(c=>c.element));
    for(const [element] of cards)if(!current.has(element)){cards.delete(element);badges.get(element)?.remove();badges.delete(element);}
    for(const card of found) {
      const old=cards.get(card.element);
      if(old && candidateKey(old.candidate)===candidateKey(card.candidate))continue;
      if(old){badges.get(card.element)?.remove();badges.delete(card.element);}
      cards.set(card.element,card);
    }
    void lookup();
  }
  const onMessage=(message:{type:string},_sender:chrome.runtime.MessageSender,respond:(reply:unknown)=>void)=>{
    if(message.type==='CONFIG_CHANGED'){epoch++;clearVisuals();void refresh();}
    if(message.type==='HISTORY_CHANGED')historyChanged();
    if(message.type==='PAGE_STATUS') {
      void refresh().then(()=>respond({connected:true,active:active(),cards:cards.size,flagged:Object.keys(matches).length,error}));
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  let scanScheduled=false;
  const mutations=new MutationObserver(()=>{
    if(scanScheduled)return;scanScheduled=true;
    window.setTimeout(()=>{scanScheduled=false;scan();updateNotice();},200);
  });
  mutations.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['post-title','permalink','content-href','data-content-id']});
  // Window capture runs before the page's own document/element handlers, which may navigate by script.
  const onClick=(event:MouseEvent)=>{
    if(!active() || !state)return;
    const path=event.composedPath();
    const anchor=path.find(node=>node instanceof HTMLAnchorElement) as HTMLAnchorElement|undefined;
    const intent=anchor?clickIntent(event,{target:anchor.target,download:anchor.hasAttribute('download')}):null;
    if(!anchor || !intent || (event.type==='auxclick' && event.button!==1))return;
    if(anchor.closest('[data-spoilerscroll-ui]') || (!fixture && !/^https?:$/.test(anchor.protocol)))return;
    // Any link to a flagged page is caught, not only the one the scan recorded.
    const key=fixture?anchor.dataset.story:canonicalUrl(anchor.href);
    if(!key)return;
    const card=[...cards.values()].find(c=>c.candidate.contentId===key);
    if(fixture && !card)return;
    const candidate=card?.candidate??{contentId:key,url:anchor.href,title:anchor.innerText.trim().slice(0,500),text:''};
    const found=matches[candidate.contentId];
    // A link the last lookup covered and cleared opens natively.
    if(!found && !stale && card)return;
    event.preventDefault();event.stopImmediatePropagation();
    const destination=anchor.href;
    const open=()=>{if(intent==='new')window.open(destination,'_blank','noopener');else location.assign(destination);};
    if(found){present(candidate,found,counts[candidate.contentId]??found.length,anchor,open);return;}
    // History changed since the last lookup (e.g. back from this very post), or the link is new: check it live.
    void send({type:'MATCH',cards:[candidate],pageUrl:location.href,pageTitle:document.title}).then(reply=>{
      const live=reply.ok?reply.matches?.[candidate.contentId]:undefined;
      if(live && active())present(candidate,live,reply.counts?.[candidate.contentId]??live.length,anchor,open);else open();
    }).catch(open);
  };
  window.addEventListener('click',onClick,true);
  window.addEventListener('auxclick',onClick,true);
  function present(candidate:Card['candidate'],found:HistoryMatch[],total:number,anchor:HTMLAnchorElement,open:()=>void) {
    if(!state)return;
    void send({type:'ACTION',action:'shown'});
    closeOverlay?.();
    closeOverlay=showOverlay(candidate,found,total,state.settings.rangeDays,anchor,fixture,action=>{
      if(action==='pause'){void send({type:'SETTINGS',patch:{paused:true}}).then(refresh);return;}
      void send({type:'ACTION',action:action==='skip'?'skipped':'continued'});
      if(action==='read')open();
    },()=>{closeOverlay=undefined;});
  }
  // Back/forward cache restores this page with results from before the visit; recheck at once.
  window.addEventListener('pageshow',event=>{if(event.persisted)historyChanged();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')historyChanged();});
  updateNotice();void refresh();
  // History changes as the user browses; refresh matches without waiting for new cards.
  const refreshes=window.setInterval(()=>{void refresh().then(()=>lookup(true));},5000);
  return ()=>{window.removeEventListener('click',onClick,true);window.removeEventListener('auxclick',onClick,true);clearInterval(refreshes);mutations.disconnect();chrome.runtime.onMessage.removeListener(onMessage);clearVisuals();notice?.host.remove();};
}
