export const SITE_ORIGINS = ['https://*/*', 'http://*/*'];

export function supportedPage(raw: string): boolean {
  try { return /^https?:$/.test(new URL(raw).protocol); } catch { return false; }
}
export const isReddit = (hostname: string) => /^(www\.|old\.)?reddit\.com$/.test(hostname);
export function cleanPostUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw,base);
    if (u.protocol !== 'https:' || !isReddit(u.hostname)) return null;
    if (!/^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(u.pathname)) return null;
    u.search=''; u.hash='';
    return u.href;
  } catch {return null;}
}
/** How a link activation opens the page, or null when it is not opening a page (right click, download). Every way
 * of opening is covered: plain click, new-tab links, Ctrl/⌘/Shift-click and middle click. */
export function clickIntent(event: Pick<MouseEvent,'button'|'ctrlKey'|'metaKey'|'shiftKey'>, anchor: {target:string; download:boolean}): 'same' | 'new' | null {
  if (anchor.download || (event.button !== 0 && event.button !== 1)) return null;
  return event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || (anchor.target && anchor.target !== '_self') ? 'new' : 'same';
}
