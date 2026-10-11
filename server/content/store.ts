import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { PipelineState } from './types.js';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const observationKey = (installId: string, observationId: string) => hash(JSON.stringify([installId, observationId]));
/** Single-process owner. Atomic snapshots; resolve writes only after fsync + rename + directory fsync. */
export class ContentStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string) {}
  private async load(): Promise<PipelineState> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as PipelineState;
      if (state.version !== 1 || !state.records || !state.decisions) throw new Error('Invalid content store');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, records: {}, decisions: {} };
      throw error;
    }
  }
  async read(): Promise<PipelineState> { await this.tail; return this.load(); }
  update<T>(fn: (state: PipelineState) => T): Promise<T> {
    const job = this.tail.then(async () => {
      const state = await this.load();
      const result = fn(state);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(tmp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(tmp, this.path);
      const directory = await open(dirname(this.path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result;
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
  async clearInstall(installId: string) {
    await this.update(state => {
      for (const [key, record] of Object.entries(state.records)) if (record.observation.installId === installId) {
        delete state.records[key]; delete state.decisions[key];
      }
    });
  }
}
