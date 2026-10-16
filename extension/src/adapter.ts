import { cleanPostUrl, isReddit } from './policy';
import { canonicalUrl } from './match';
import type { Candidate } from './types';
export interface Card {element: HTMLElement; candidate: Candidate;}
const normalize = (value: string | null | undefined) => (value??'').replace(/\s+/g,' ').trim();
// Visible text sent per link; enough for a post body or snippet, bounded so a page's lookup stays small.
const MAX_TEXT = 2000;

function fixtureCard(element: HTMLElement): Card | null {
  const id = element.dataset.contentId;
  const title = normalize(element.querySelector('h2')?.textContent);
  const anchor = element.querySelector<HTMLAnchorElement>('a[data-story]');
  if (!id || !title || !anchor) return null;
  return {element,candidate:{contentId:id,url:anchor.href,title,text:normalize(element.querySelector('[data-preview]')?.textContent).slice(0,MAX_TEXT)}};
}
function redditCard(element: HTMLElement): Card | null {
  const raw = element.getAttribute('permalink') || element.getAttribute('content-href') || element.querySelector<HTMLAnchorElement>('a[data-click-id="body"], a.title, a[slot="full-post-link"], a[href*="/comments/"]')?.href;
  const url = raw ? cleanPostUrl(raw,location.href) : null;
  if (!url) return null;
  const title=normalize(element.getAttribute('post-title') || element.querySelector('h1,h2,h3,[data-testid="post-title"],[data-testid="post-title-text"],a.title,a[slot="title"]')?.textContent || element.querySelector<HTMLAnchorElement>('a[href*="/comments/"]')?.textContent);
  const text=normalize(element.querySelector<HTMLElement>('[slot="text-body"],[data-testid="post-content"],.usertext-body,.expando')?.innerText);
  if (!title) return null;
  return {element,candidate:{contentId:canonicalUrl(url)!,url,title:title.slice(0,500),text:text.slice(0,MAX_TEXT)}};
}
function redditCards(): Card[] {
  const elements=new Set(document.querySelectorAll<HTMLElement>('shreddit-post, .thing.link, [data-testid="post-container"], search-telemetry-tracker'));
  if(/\/search\/?$/.test(location.pathname))for(const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href*="/comments/"]')) {
    if(!anchor.querySelector('h1,h2,h3') && !anchor.matches('[data-testid="post-title-text"],a.title,[slot="title"]'))continue;
    const container=anchor.closest<HTMLElement>('search-telemetry-tracker,article,[data-testid="post-container"],.search-result')??anchor.parentElement;
    if(container)elements.add(container);
  }
  return [...elements].map(redditCard).filter((v):v is Card=>!!v);
}
/** Any site: every http(s) link outside menus, page headers and footers. Its text is the title; the surrounding article/list item/parent supplies the visible text. */
function linkCards(): Card[] {
  const cards: Card[] = [];
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!/^https?:$/.test(anchor.protocol) || anchor.closest('[data-spoilerscroll-ui],nav,header,footer,[role="navigation"],[role="banner"],[role="contentinfo"]')) continue;
    const url=canonicalUrl(anchor.href);
    if (!url) continue;
    const container=anchor.closest<HTMLElement>('article,li,[role="article"]') ?? anchor.parentElement;
    const title=normalize(anchor.innerText || anchor.getAttribute('aria-label') || anchor.title).slice(0,500);
    // innerText, unlike textContent, separates block elements so adjacent headings and paragraphs don't fuse words.
    const text=container && container!==document.body ? normalize(container.innerText).slice(0,MAX_TEXT) : '';
    cards.push({element:anchor,candidate:{contentId:url,url:anchor.href,title,text}});
  }
  return cards;
}
export function scanCards(fixture: boolean): Card[] {
  if(fixture)return [...document.querySelectorAll<HTMLElement>('[data-spoilerscroll-card]')].map(fixtureCard).filter((v):v is Card=>!!v);
  // Reddit cards come first so a post keeps its body text; every other link on the page is still included.
  const found=[...(isReddit(location.hostname)?redditCards():[]),...linkCards()];
  // Several links often share an address (site-name link + headline); the one with the longest text is the title.
  const byId=new Map<string,Card>();
  for(const card of found) {
    const previous=byId.get(card.candidate.contentId);
    if(!previous || (previous.element instanceof HTMLAnchorElement && card.candidate.title.length>previous.candidate.title.length))byId.set(card.candidate.contentId,card);
  }
  return [...byId.values()];
}
export function candidateKey(c: Candidate) {return JSON.stringify([c.contentId,c.url,c.title,c.text]);}
