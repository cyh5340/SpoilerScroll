/** Server-only contracts. Fixtures implement these without credentials or network access. */
export type Revision = string | number;
export interface Identity { agentId: string; capabilityId: string; revision?: Revision }
export interface ViewedContent {
  installId: string; contentId: string; site: string; summaryId?: string;
  agentId: string; viewedAt: string;
}
export interface Performance extends Identity {
  site: string; contentType: string; attempts: number; successes: number;
}
export type ReadResult<T> =
  | { status: 'available'; data: T; source: 'keewano' | 'fixture' }
  | { status: 'unavailable'; reason: 'credentials' | 'schema' | 'query' };
export interface HistoryReader {
  recentViewed(installId: string, since: Date, limit?: number): Promise<ReadResult<ViewedContent[]>>;
  extractorPerformance(site: string, contentType: string, since: Date): Promise<ReadResult<Performance[]>>;
}
export interface Capability extends Identity {
  readiness: string; canStartThread: boolean; metadata: Readonly<Record<string, unknown>>;
}
export interface CapabilitySearch { search(description: string): Promise<Capability[]> }
export interface Extraction {
  text: string; scope: 'preview' | 'full'; evidence: { quote: string; start: number; end: number }[];
}
/** Only public URL travels to this adapter; DOM/cookies are deliberately absent. */
export interface ExecutionAdapter {
  identity: Identity;
  /** Set only after verifying the protocol, operation, authority and route outside discovery. */
  verified: boolean;
  execute(publicUrl: string, signal: AbortSignal): Promise<unknown>;
}
export interface ExtractionRequest {
  site: string; contentType: string; publicUrl?: string;
  remoteConsent: boolean; localDom: () => Promise<unknown>;
}
export type ExtractionEvent =
  | { state: 'discovered'; identity: Identity }
  | { state: 'unavailable'; identity?: Identity; reason: string }
  | { state: 'ready' | 'attempted'; identity: Identity }
  | { state: 'failed'; identity?: Identity; reason: 'timeout' | 'provider' | 'validation' | 'local'; latencyMs: number }
  | { state: 'extracted'; identity?: Identity; source: 'local-dom' | 'provider'; latencyMs: number };
