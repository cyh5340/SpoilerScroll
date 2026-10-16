import type { HistoryMatch } from './match';
import type { Candidate } from './types';
const css=`
:host{all:initial;font-family:system-ui,sans-serif;color:#242b29}*{box-sizing:border-box}
dialog{border:0;border-radius:0;background:#fbfaf6;color:#242b29;max-width:none;max-height:none;width:100vw;height:100dvh;margin:0;padding:clamp(48px,10vh,120px) max(24px,calc((100vw - 760px)/2));overflow:auto;font:18px/1.6 system-ui}
dialog::backdrop{background:#fbfaf6}button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid #d4d9d3;padding:14px 20px;background:transparent;color:inherit}button:focus-visible,a:focus-visible{outline:3px solid #bd7c24;outline-offset:3px}
.eyebrow{color:#86601c;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px}h2{font-size:clamp(32px,5vw,56px);line-height:1.1;margin:0 0 16px;letter-spacing:-1px}.post{margin:0 0 28px;color:#4b5650}
ul{list-style:none;padding:0;margin:0 0 28px;border-top:1px solid #deddd4}li{padding:14px 0;border-bottom:1px solid #deddd4;font-size:15px;overflow-wrap:anywhere}li a{color:#216c5e;font-weight:600}.meta{display:block;font-size:12px;color:#626c65;margin-top:2px}.same{display:inline-block;background:#f7edcc;color:#775620;border-radius:12px;padding:0 8px;font-size:11px;margin-left:6px;vertical-align:2px}
.actions{display:flex;flex-wrap:wrap;gap:8px}.primary{background:#216c5e;color:white;border-color:#216c5e}.close{position:absolute;right:12px;top:10px;border:0;padding:4px 10px;font-size:22px}.pause{padding:0;border:0;text-decoration:underline;font-size:12px;margin-top:18px;color:#626c65}
`;
export function ago(time:number) {
  const minutes=Math.max(1,Math.round((Date.now()-time)/60_000));
  return minutes<60?`${minutes} min ago`:minutes<1440?`${Math.round(minutes/60)} h ago`:`${Math.round(minutes/1440)} d ago`;
}
// The fixture page is the extension's own; on other sites a closed root keeps history out of reach of page scripts.
const shadowMode=(fixture:boolean):ShadowRootMode=>fixture?'open':'closed';

export function showOverlay(candidate:Candidate,matches:HistoryMatch[],total:number,rangeDays:number,opener:HTMLAnchorElement,fixture:boolean,onAction:(action:'skip'|'read'|'pause')=>void,onClose?:()=>void) {
  const host=document.createElement('div');host.dataset.spoilerscrollUi='overlay';
  const root=host.attachShadow({mode:shadowMode(fixture)});
  const style=document.createElement('style');style.textContent=css;root.append(style);
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','spoiler-title');
  // Page and history strings are assigned through textContent, never interpreted as HTML.
  dialog.innerHTML='<button class="close" aria-label="Dismiss">×</button><p class="eyebrow"></p><h2 id="spoiler-title"></h2><p class="post"></p><ul></ul><div class="actions"><button class="primary" data-action="skip">Skip this</button><button data-action="read">Read anyway</button></div><button class="pause" data-action="pause">Pause SpoilerScroll</button>';
  dialog.querySelector('.eyebrow')!.textContent=`${fixture?'Local demo · ':''}From your history · last ${rangeDays===1?'day':`${rangeDays} days`}`;
  dialog.querySelector('h2')!.textContent=total===1?'You have seen something like this.':`You have opened ${total} similar pages.`;
  dialog.querySelector('.post')!.textContent=`“${candidate.title}”`;
  for(const match of matches) {
    const li=document.createElement('li');
    const link=document.createElement('a');
    link.textContent=match.title;link.target='_blank';link.rel='noopener noreferrer';
    if(/^https?:/.test(match.url) || (fixture && match.url.startsWith(chrome.runtime.getURL('fixture.html'))))link.href=match.url;
    li.append(link);
    if(match.samePost){const tag=document.createElement('span');tag.className='same';tag.textContent='this post';li.append(tag);}
    const meta=document.createElement('span');meta.className='meta';
    const shared=[match.titleShared.length?`${match.titleShared.join(', ')} (title)`:'',match.textShared.length?`${match.textShared.join(', ')} (text)`:''].filter(Boolean).join(' · ');
    meta.textContent=`${match.url} · ${ago(match.lastVisitTime)}${shared?` · shared: ${shared}`:''}`;
    li.append(meta);dialog.querySelector('ul')!.append(li);
  }
  if(total>matches.length){const more=document.createElement('li');more.className='meta';more.textContent=`…and ${total-matches.length} more with lower scores.`;dialog.querySelector('ul')!.append(more);}
  root.append(dialog);document.documentElement.append(host);
  let closed=false;
  function close() {if(closed)return;closed=true;dialog.close();host.remove();if(opener.isConnected)opener.focus({preventScroll:true});onClose?.();}
  dialog.querySelector('.close')!.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
    const action=(event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if(action){close();onAction(action as 'skip'|'read'|'pause');}
  });
  dialog.showModal();
  return close;
}
export function createBadge(fixture:boolean,count:number) {
  const host=document.createElement('span');host.dataset.spoilerscrollUi='badge';
  const root=host.attachShadow({mode:shadowMode(fixture)});
  const style=document.createElement('style');style.textContent=':host{display:block;margin:10px 0;font:12px/1.4 system-ui;color:#775620}span{display:inline-block;background:#f7edcc;border:1px solid #e9dba7;border-radius:20px;padding:5px 10px}';
  const label=document.createElement('span');label.textContent=`SpoilerScroll · Similar to ${count} ${count===1?'page':'pages'} in your history`;
  root.append(style,label);return host;
}
/** Bottom-right count of posts on this page that match history. Counts only; no history content. */
export function createNotice(fixture:boolean) {
  const host=document.createElement('div');host.dataset.spoilerscrollUi='notice';
  host.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483646;pointer-events:none';
  const root=host.attachShadow({mode:shadowMode(fixture)});
  const label=document.createElement('span');
  label.style.cssText='display:block;background:#163d33;color:#fff;padding:10px 14px;border-radius:12px;font:12px/1.5 system-ui;box-shadow:0 2px 12px #0003;white-space:pre-line;max-width:280px';
  root.append(label);document.documentElement.append(host);
  return {host,set:(text:string)=>{label.textContent=text;}};
}
