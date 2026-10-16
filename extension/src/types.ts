import type { HistoryMatch } from './match';
/** A post or headline link on the page; `text` is its visible surrounding text. */
export interface Candidate { contentId: string; url: string; title: string; text: string; }
export type Action = 'shown' | 'skipped' | 'continued';
export interface Settings { enabled: boolean; paused: boolean; rangeDays: number; minShared: number; }
export interface Store { settings: Settings; stats: Record<Action, number>; }
export type Message =
 | {type: 'STATE'}
 | {type: 'SETTINGS'; patch: Partial<Settings>}
 | {type: 'MATCH'; cards: Candidate[]; pageUrl: string; pageTitle: string}
 | {type: 'ACTION'; action: Action};
export interface Reply { ok: boolean; error?: string; state?: Store; matches?: Record<string, HistoryMatch[]>; counts?: Record<string, number>; }
export async function send(message: Message): Promise<Reply> {
  return chrome.runtime.sendMessage(message);
}
