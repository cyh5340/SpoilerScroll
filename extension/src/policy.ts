export const DWELL_MS = 3000;
export const COOLDOWN_MS = 60_000;
export const SESSION_IDLE_MS = 600_000;
export const REDDIT_ORIGINS = ['https://www.reddit.com/*', 'https://old.reddit.com/*'];
export const BACKEND = 'http://127.0.0.1:8787';
export const BACKEND_ORIGIN = 'http://127.0.0.1/*';

export function allowedRedditPage(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !['www.reddit.com','old.reddit.com'].includes(u.hostname)) return false;
    if(/^\/(?:r\/[a-z0-9_]+\/)?search\/?$/i.test(u.pathname))return !u.searchParams.has('type') || ['link','posts'].includes(u.searchParams.get('type')!);
    // Public feeds and posts; private routes and editors remain excluded.
    return /^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/[^/]+)?\/?$/i.test(u.pathname) || /^\/(?:|(?:hot|new|top|rising|best)\/?|r\/[a-z0-9_]+\/?(?:hot\/?|new\/?|top\/?|rising\/?)?)$/i.test(u.pathname);
  } catch {return false;}
}
export function cleanPostUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw,base);
    if (u.protocol !== 'https:' || !['www.reddit.com','old.reddit.com'].includes(u.hostname)) return null;
    if (!/^\/r\/[a-z0-9_]+\/comments\/[a-z0-9]+(?:\/|$)/i.test(u.pathname)) return null;
    u.search=''; u.hash='';
    return u.href;
  } catch {return null;}
}
export function normalNavigation(event: Pick<MouseEvent,'button'|'ctrlKey'|'metaKey'|'shiftKey'|'altKey'|'defaultPrevented'>, anchor: {target:string; download:boolean}): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !event.defaultPrevented && !anchor.download && (!anchor.target || anchor.target === '_self');
}
export class DwellTracker {
  private started = new Map<string,number>();
  private done = new Set<string>();
  update(id: string, ratio: number, active: boolean, now: number): boolean {
    if (this.done.has(id)) return false;
    if (!active || ratio < .5) {this.started.delete(id);return false;}
    const since = this.started.get(id);
    if (since === undefined) {this.started.set(id,now);return false;}
    if (now-since < DWELL_MS) return false;
    this.started.delete(id); this.done.add(id); return true;
  }
  reset(id: string) {this.started.delete(id);}
  resetAll() {this.started.clear();}
  retry(id: string) {this.done.delete(id);this.started.delete(id);}
}
