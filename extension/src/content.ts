import { scanCards, extractCard, candidateKey, type Card } from './adapter';
import { allowedRedditPage, DwellTracker, normalNavigation } from './policy';
import { createBadge, showOverlay } from './overlay';
import { send, type Decision, type Store, type Candidate } from './types';

const marker='__spoilerScrollLoaded';
const win=window as unknown as Record<string,unknown>;
const previous=win[marker] as {alive?:()=>boolean;stop?:()=>void}|undefined;
if(!previous || typeof previous.alive!=='function' || !previous.alive()) {
  previous?.stop?.();
  document.querySelectorAll('[data-spoilerscroll-ui="activity"]').forEach(el=>el.remove());
  win[marker]={alive:()=>{try{return !!chrome.runtime.getManifest();}catch{return false;}},stop:start()};
}
function start() {
  const fixture=location.href.startsWith(chrome.runtime.getURL('fixture.html'));
  const tracker=new DwellTracker();
  let state:Store|undefined;
  let closeOverlay:(()=>void)|undefined;
  const cards=new Map<HTMLElement,Card>();
  const ratios=new Map<HTMLElement,number>();
  const decisions=new Map<string,{decision:Decision;key:string;at:number}>();
  const pending=new Set<string>();
  const autoAttempted=new Set<string>();
  const badges=new Map<HTMLElement,HTMLElement>();
  let decisionRequests=0;
  let epoch=0;
  let lastUrl=location.href;
  let pageEnteredAt=Date.now();
  let entrySeen:Set<string>|undefined;
  let activity:HTMLElement|undefined;
  let activityError='';
  function updateActivity() {
    if(fixture || !allowedRedditPage(location.href)){activity?.remove();activity=undefined;return;}
    if(!activity) {
      activity=document.createElement('div');activity.dataset.spoilerscrollUi='activity';
      activity.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483646;pointer-events:none';
      const root=activity.attachShadow({mode:'open'});
      const label=document.createElement('span');
      label.style.cssText='display:block;background:#163d33;color:#fff;padding:10px 14px;border-radius:12px;font:12px/1.5 system-ui;box-shadow:0 2px 12px #0003;white-space:pre-line';
      root.append(label);document.documentElement.append(activity);
    }
    const label=activity.shadowRoot!.firstElementChild!;
    label.textContent=activityError?`SpoilerScroll · ${activityError}`:!state?'SpoilerScroll · Connecting…':!active()?`SpoilerScroll · ${state.settings.paused?'Paused':state.settings.mode!=='live'?'Demo mode — enable Reddit in the extension':'Open the extension to enable Reddit'}`:`SpoilerScroll · Monitoring ${cards.size} previews\n${state.stats.views} captured · ${state.queue.length} queued\n${state.delivery}`;
  }
  const active=()=>!!state && !state.settings.paused && (fixture?state.settings.mode==='fixture':state.settings.mode==='live'&&state.settings.redditEnabled&&state.settings.remoteConsent&&allowedRedditPage(location.href));
  function clearVisuals() {for(const badge of badges.values())badge.remove();badges.clear();closeOverlay?.();closeOverlay=undefined;decisions.clear();tracker.resetAll();}
  async function refresh() {
    try {
      const reply=await send({type:'STATE'});
      if(!reply.ok || !reply.state){state=undefined;activityError=reply.error??'Open the extension to reconnect';clearVisuals();updateActivity();return;}
      activityError='';
      const previous=state;
      state=reply.state;
      entrySeen??=new Set(state.seen);
      if(previous && (previous.settings.paused!==state.settings.paused || previous.settings.mode!==state.settings.mode || previous.sessionId!==state.sessionId || previous.settings.redditEnabled!==state.settings.redditEnabled)) {epoch++;clearVisuals();}
      if(!active())clearVisuals();else scan();
      updateActivity();
      if(fixture) {
        document.querySelector('[data-view-count]')!.textContent=String(state.fixtureSeen.filter(id=>['fixture-1','fixture-2','fixture-3'].includes(id)).length);
        document.querySelector('[data-fixture-state]')!.textContent=state.settings.paused?'Paused':state.settings.mode==='fixture'?'Local fixture mode':'Live mode is selected; open the popup to switch to demo';
      }
    } catch {state=undefined;activityError='Extension reloaded — refresh this Reddit tab';clearVisuals();updateActivity();}
  }
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries)ratios.set(entry.target as HTMLElement,entry.intersectionRatio);
  },{threshold:[0,.5,1]});
  function scan() {
    if(!active())return;
    for(const [element,card] of cards)if(!element.isConnected) {
      observer.unobserve(element);cards.delete(element);ratios.delete(element);badges.get(element)?.remove();badges.delete(element);tracker.reset(card.candidate.contentId);
    }
    for(const card of scanCards(fixture)) {
      const old=cards.get(card.element);
      if(old && candidateKey(old.candidate)===candidateKey(card.candidate))continue;
      if(old) {badges.get(card.element)?.remove();badges.delete(card.element);decisions.delete(old.candidate.contentId);tracker.reset(old.candidate.contentId);}
      cards.set(card.element,card);observer.observe(card.element);
    }
  }
  async function prepare(card:Card) {
    const c=card.candidate,key=candidateKey(c),version=epoch;
    if(pending.has(c.contentId) || decisionRequests>=2 || (decisions.get(c.contentId)?.key===key && Date.now()-(decisions.get(c.contentId)?.at??0)<(decisions.get(c.contentId)?.decision.status==='ready'?10_000:1500)))return;
    pending.add(c.contentId);decisionRequests++;
    try {
      const reply=await send({type:'DECISION',candidate:c,pageEnteredAt});
      const latest=extractCard(card.element,fixture);
      if(version!==epoch || !active() || !card.element.isConnected || !latest || candidateKey(latest.candidate)!==key)return;
      if(reply.decision) {
        if(reply.decision.reason==='keewano_history_unavailable')activityError='Detection unavailable: configure Keewano read credentials';
        decisions.set(c.contentId,{decision:reply.decision,key,at:Date.now()});
        badges.get(card.element)?.remove();badges.delete(card.element);
        if(reply.decision.status==='ready' && reply.decision.intervene) {
          const badge=createBadge(fixture,reply.decision.matchedContentIds.length);card.element.append(badge);badges.set(card.element,badge);
          if(!fixture && !closeOverlay && !autoAttempted.has(c.contentId) && (!reply.decision.reason?.startsWith('same_post_previously_viewed_') || entrySeen?.has(c.contentId)) && document.hasFocus() && document.visibilityState==='visible') {
            const rect=card.element.getBoundingClientRect();
            const visible=Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0));
            const opener=card.element.querySelector<HTMLAnchorElement>('a[href*="/comments/"]');
            if(opener && visible/Math.max(1,Math.min(rect.height,innerHeight))>=.5) {
              autoAttempted.add(c.contentId);
              const claim=await send({type:'CLAIM',candidate:c});
              if(claim.ok && claim.claimed && active() && version===epoch && !closeOverlay && document.hasFocus()) {
                void send({type:'ACTION',candidate:c,action:'SpoilerShown'});
                closeOverlay=showOverlay(c,reply.decision,opener,false,action=>{
                  if(action==='pause'){void send({type:'SETTINGS',patch:{paused:true}}).then(refresh);return;}
                  void send({type:'ACTION',candidate:c,action:action==='skip'?'SpoilerSkipped':action==='read'?'ReadAnyway':'FalsePositiveReported'});
                  closeOverlay=undefined;
                  if(action==='read')location.assign(c.url);
                },()=>{closeOverlay=undefined;});
              }
            }
          }
        }
      }
      if(!reply.ok){activityError=reply.error??'Preview check failed';updateActivity();}
    } catch {activityError='Preview check failed — check backend connection';updateActivity();}
    finally {pending.delete(c.contentId);decisionRequests--;}
  }
  async function tick() {
    if(lastUrl!==location.href) {lastUrl=location.href;pageEnteredAt=Date.now();entrySeen=new Set(state?.seen??[]);epoch++;clearVisuals();scan();}
    if(!active())return;
    const focused=document.visibilityState==='visible' && document.hasFocus();
    for(const card of cards.values()) {
      const latest=extractCard(card.element,fixture);
      if(!latest || candidateKey(latest.candidate)!==candidateKey(card.candidate)){tracker.reset(card.candidate.contentId);continue;}
      const rect=card.element.getBoundingClientRect();
      const visibleHeight=Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0));
      const ratio=rect.width>0 && rect.right>0 && rect.left<innerWidth ? visibleHeight/Math.max(1,Math.min(rect.height,innerHeight)) : 0;
      if(tracker.update(card.candidate.contentId,ratio,focused,performance.now())) {
        try {
          const reply=await send({type:'OBSERVE',candidate:card.candidate,dwellSeconds:3});
          if(!reply.ok)tracker.retry(card.candidate.contentId);
          else {decisions.clear();await refresh();}
        } catch {tracker.retry(card.candidate.contentId);}
      }
      if(ratio>0 && focused)void prepare(card);
    }
  }
  document.addEventListener('visibilitychange',()=>{tracker.resetAll();});
  window.addEventListener('blur',()=>tracker.resetAll());
  const onMessage=(message:{type:string},_sender:chrome.runtime.MessageSender,respond:(reply:unknown)=>void)=>{
    if(message.type==='CONFIG_CHANGED'){epoch++;clearVisuals();void refresh();}
    if(message.type==='PAGE_STATUS') {
      void refresh().then(()=>respond({connected:true,build:'reconnect-2',supported:allowedRedditPage(location.href),active:active(),cards:cards.size,error:activityError}));
      return true;
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  let scanScheduled=false;
  const mutations=new MutationObserver(()=>{
    if(scanScheduled)return;scanScheduled=true;
    window.setTimeout(()=>{scanScheduled=false;scan();},200);
  });
  mutations.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['post-title','permalink','content-href','data-content-id']});
  let claiming=false;
  document.addEventListener('click',event=>{
    if(!active() || claiming)return;
    const path=event.composedPath();
    const anchor=path.find(node=>node instanceof HTMLAnchorElement) as HTMLAnchorElement|undefined;
    if(!anchor || !normalNavigation(event,{target:anchor.target,download:anchor.hasAttribute('download')}))return;
    const element=path.find(node=>node instanceof HTMLElement && cards.has(node)) as HTMLElement|undefined;
    const card=element?cards.get(element):undefined;
    if(!card)return;
    const current=extractCard(card.element,fixture);
    if(!current || candidateKey(current.candidate)!==candidateKey(card.candidate))return;
    // Intercept the post destination only; votes, community/author links and other controls stay native.
    const href=new URL(anchor.href);href.search='';href.hash='';
    const target=new URL(card.candidate.url);target.search='';target.hash='';
    if(fixture?anchor.dataset.story!==card.candidate.contentId:href.href.replace(/\/$/,'')!==target.href.replace(/\/$/,''))return;
    const cached=decisions.get(card.candidate.contentId);
    if(!cached || cached.key!==candidateKey(card.candidate) || Date.now()-cached.at>30_000 || cached.decision.status!=='ready' || !cached.decision.intervene || !cached.decision.spoiler)return;
    event.preventDefault();event.stopImmediatePropagation();claiming=true;
    const destination=anchor.href,version=epoch;
    void send({type:'CLAIM',candidate:card.candidate,explicit:true}).then(reply=>{
      claiming=false;
      if(!reply.ok || !reply.claimed || !active() || version!==epoch){location.assign(destination);return;}
      void send({type:'ACTION',candidate:card.candidate,action:'SpoilerShown'});
      closeOverlay?.();
      closeOverlay=showOverlay(card.candidate,cached.decision,anchor,fixture,action=>{
        if(action==='pause'){void send({type:'SETTINGS',patch:{paused:true}}).then(refresh);return;}
        const type=action==='skip'?'SpoilerSkipped':action==='read'?'ReadAnyway':'FalsePositiveReported';
        void send({type:'ACTION',candidate:card.candidate,action:type});
        if(action==='read')location.assign(destination);
        if(action==='feedback'){decisions.delete(card.candidate.contentId);badges.get(card.element)?.remove();}
      });
    }).catch(()=>{claiming=false;location.assign(destination);});
  },true);
  if(fixture)document.querySelector('[data-reset]')?.addEventListener('click',()=>{
    void send({type:'RESET_FIXTURE'}).then(()=>location.assign(chrome.runtime.getURL('fixture.html')));
  });
  updateActivity();scan();void refresh();
  const ticks=window.setInterval(()=>void tick(),250),refreshes=window.setInterval(()=>void refresh(),2000);
  return ()=>{clearInterval(ticks);clearInterval(refreshes);observer.disconnect();mutations.disconnect();chrome.runtime.onMessage.removeListener(onMessage);clearVisuals();activity?.remove();};
}
