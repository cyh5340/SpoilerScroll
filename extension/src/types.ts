export type Scope = 'preview' | 'full';
export interface Candidate {
  contentId: string; site: string; url: string; title: string; visibleText: string; scope: Scope;
}
export interface Observation extends Candidate {
  observationId: string; installId: string; sessionId: string; dwellSeconds: number;
}
export interface Decision {
  status: 'pending' | 'ready' | 'unavailable'; intervene: boolean; spoiler?: string;
  scope?: Scope; matchedContentIds: string[]; reason?: string;
}
export type Action = 'SpoilerShown' | 'SpoilerSkipped' | 'ReadAnyway' | 'FalsePositiveReported';
export interface Settings {
  redditEnabled: boolean; paused: boolean; mode: 'fixture' | 'live';
  remoteConsent: boolean; pairingToken: string;
}
export interface QueueItem { id: string; path: '/observations' | '/events'; body: Observation | Record<string, string>; createdAt: number; }
export interface Store {
  settings: Settings; installId: string; sessionId: string; lastActivity: number;
  candidateIds?: Record<string, {id: string; fingerprint: string; version: string}>;
  backendMode?: string;
  observationIds?: Record<string, {id: string; fingerprint: string}>;
  seen: string[]; queue: QueueItem[]; fixtureSeen: string[];
  stats: {views: number; repeats: number; skipped: number; continued: number};
  delivery: string; lastIntervention: number; intervened: string[];
}
export type Message =
 | {type: 'STATE'}
 | {type: 'PAIR'}
 | {type: 'SETTINGS'; patch: Partial<Settings>}
 | {type: 'OBSERVE'; candidate: Candidate; dwellSeconds: number}
 | {type: 'DECISION'; candidate: Candidate}
 | {type: 'ACTION'; candidate: Candidate; action: Action}
 | {type: 'CLAIM'; candidate: Candidate}
 | {type: 'RESET_FIXTURE'}
 | {type: 'CLEAR_QUEUE'};
export interface Reply { ok: boolean; error?: string; state?: Store; decision?: Decision; claimed?: boolean; }
export const unavailable: Decision = {status:'unavailable',intervene:false,matchedContentIds:[]};
export async function send(message: Message): Promise<Reply> {
  return chrome.runtime.sendMessage(message);
}
