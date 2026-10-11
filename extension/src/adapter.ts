import { cleanPostUrl } from './policy';
import type { Candidate } from './types';
export interface Card {element: HTMLElement; candidate: Candidate;}
const normalize = (value: string | null | undefined) => (value??'').replace(/\s+/g,' ').trim();
export function extractCard(element: HTMLElement, fixture: boolean): Card | null {
  if (fixture) {
    const id = element.dataset.contentId;
    const title = normalize(element.querySelector('h2')?.textContent);
    const text = normalize(element.querySelector('[data-preview]')?.textContent);
    const anchor = element.querySelector<HTMLAnchorElement>('a[data-story]');
    if (!id || !title || !anchor) return null;
    return {element,candidate:{contentId:id,site:'localhost',url:anchor.href,title,visibleText:text,scope:'preview'}};
  }
  const raw = element.getAttribute('permalink') || element.getAttribute('content-href') || element.querySelector<HTMLAnchorElement>('a[data-click-id="body"], a.title, a[slot="full-post-link"], a[href*="/comments/"]')?.href;
  if (!raw) return null;
  const url=cleanPostUrl(raw,location.href);
  if (!url) return null;
  const id = new URL(url).pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
  const title=normalize(element.getAttribute('post-title') || element.querySelector('h1,h2,h3,[data-testid="post-title"],[data-testid="post-title-text"],a.title,a[slot="title"]')?.textContent || element.querySelector<HTMLAnchorElement>('a[href*="/comments/"]')?.textContent);
  const body=normalize(element.querySelector('[slot="text-body"],[data-testid="post-content"],.usertext-body')?.textContent);
  if (!id || !title) return null;
  return {element,candidate:{contentId:`reddit:${id}`,site:new URL(url).hostname,url,title:title.slice(0,256),visibleText:(body||title).slice(0,4000),scope:'preview'}};
}
export function scanCards(fixture: boolean): Card[] {
  const selectors=fixture?'[data-spoilerscroll-card]':'shreddit-post, .thing.link, [data-testid="post-container"], search-telemetry-tracker';
  const elements=new Set(document.querySelectorAll<HTMLElement>(selectors));
  if(!fixture && /\/search\/?$/.test(location.pathname))for(const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/comments/"]')) {
    if(!anchor.querySelector('h1,h2,h3') && !anchor.matches('[data-testid="post-title-text"],a.title,[slot="title"]'))continue;
    const container=anchor.closest<HTMLElement>('search-telemetry-tracker,article,[data-testid="post-container"],.search-result')??anchor.parentElement;
    if(container)elements.add(container);
  }
  const ids=new Set<string>();
  return [...elements].map(el=>extractCard(el,fixture)).filter((v):v is Card=>{
    if(!v || ids.has(v.candidate.contentId))return false;
    ids.add(v.candidate.contentId);return true;
  });
}
export function candidateKey(c: Candidate) {return JSON.stringify([c.contentId,c.url,c.title,c.visibleText]);}
