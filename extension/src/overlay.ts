import type { Candidate, Decision } from './types';
const css=`
:host{all:initial;font-family:system-ui,sans-serif;color:#242b29}*{box-sizing:border-box}
dialog{border:0;border-radius:0;background:#fbfaf6;color:#242b29;max-width:none;max-height:none;width:100vw;height:100dvh;margin:0;padding:clamp(48px,10vh,120px) max(24px,calc((100vw - 760px)/2));overflow:auto;font:18px/1.6 system-ui}
dialog::backdrop{background:#fbfaf6}button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid #d4d9d3;padding:14px 20px;background:transparent;color:inherit}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #bd7c24;outline-offset:3px}
.eyebrow{color:#86601c;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px}h2{font-size:23px;line-height:1.25;margin:0 0 16px;letter-spacing:-.5px}.spoiler{margin:0 0 12px}.scope{font-size:12px;color:#626c65;margin:0 0 22px}.actions{display:flex;flex-wrap:wrap;gap:8px}.primary{background:#216c5e;color:white;border-color:#216c5e}.feedback{border:0;padding:8px 0;font-size:13px;text-decoration:underline;text-underline-offset:3px;margin-top:10px}.foot{border-top:1px solid #deddd4;margin-top:18px;padding-top:16px;font-size:12px;color:#626c65}summary{cursor:pointer}ul{padding-left:18px;overflow-wrap:anywhere}.close{position:absolute;right:12px;top:10px;border:0;padding:4px 10px;font-size:22px}.pause{padding:0;border:0;text-decoration:underline;font-size:12px;margin-top:14px}a{color:#216c5e}
`;
export function showOverlay(candidate:Candidate,decision:Decision,opener:HTMLAnchorElement,fixture:boolean,onAction:(action:'skip'|'read'|'feedback'|'pause')=>void,onClose?:()=>void) {
  const host=document.createElement('div');host.dataset.spoilerscrollUi='overlay';
  const root=host.attachShadow({mode:'open'});
  const style=document.createElement('style');style.textContent=css;root.append(style);
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','spoiler-title');dialog.setAttribute('aria-describedby','spoiler-copy');
  // All backend/page strings are assigned through textContent, never interpreted as HTML.
  dialog.innerHTML='<button class="close" aria-label="Dismiss spoiler">×</button><p class="eyebrow"></p><h2 id="spoiler-title">You may have seen this before.</h2><p class="spoiler" id="spoiler-copy"></p><p class="scope"></p><div class="actions"><button class="primary" data-action="skip">Skip this</button><button data-action="read">Read anyway</button></div><button class="feedback" data-action="feedback">This adds something new</button><div class="foot"><details><summary>Why this appeared</summary><p class="reason"></p><ul></ul></details><button class="pause" data-action="pause">Pause spoilers</button></div>';
  dialog.querySelector('.eyebrow')!.textContent=fixture?'Local demo · scripted match':`Similar to ${decision.matchedContentIds.length} viewed posts`;
  if(!fixture)dialog.querySelector('h2')!.textContent='Before you keep scrolling…';
  (dialog.querySelector('h2') as HTMLElement).style.fontSize='clamp(32px,5vw,56px)';
  dialog.querySelector('.spoiler')!.textContent=decision.spoiler??'';
  dialog.querySelector('.scope')!.textContent=decision.scope==='preview'?'Based on the visible preview only.':'Based on extracted source text.';
  dialog.querySelector('.reason')!.textContent=decision.reason??'The prepared decision matched claims against content you previously viewed.';
  for(const id of decision.matchedContentIds) {
    const li=document.createElement('li');
    if(fixture && /^fixture-[1-5]$/.test(id)) {
      const a=document.createElement('a');a.textContent=`Demo preview ${id.slice(-1)}`;a.href=`#${id}`;a.onclick=()=>close();li.append(a);
    } else li.textContent=`Prior content: ${id}`;
    dialog.querySelector('ul')!.append(li);
  }
  root.append(dialog);document.documentElement.append(host);
  let closed=false;
  function close() {if(closed)return;closed=true;dialog.close();host.remove();if(opener.isConnected)opener.focus({preventScroll:true});onClose?.();}
  dialog.querySelector('.close')!.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{
    const action=(event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if(action){close();onAction(action as 'skip'|'read'|'feedback'|'pause');}
  });
  dialog.showModal();
  return close;
}
export function createBadge(fixture:boolean,count:number) {
  const host=document.createElement('span');host.dataset.spoilerscrollUi='badge';
  const root=host.attachShadow({mode:'open'});
  const style=document.createElement('style');style.textContent=':host{display:block;margin:10px 0;font:12px/1.4 system-ui;color:#775620}span{display:inline-block;background:#f7edcc;border:1px solid #e9dba7;border-radius:20px;padding:5px 10px}';
  const label=document.createElement('span');label.textContent=fixture?'Demo · repeats 3 viewed previews':`SpoilerScroll · Related to ${count} posts you viewed`;
  root.append(style,label);return host;
}
