import type { PreviewResult } from '@railhold/engine';
import type { Blueprint } from '@railhold/shared';
import type { CalcReply, CalcRequest } from './calc.worker.ts';

/** Runs the physics solver off the page's main thread, so dragging a slider never stutters. */
export class Calc {
  private readonly worker = new Worker(new URL('./calc.worker.js', import.meta.url), { type: 'module' });
  private seq = 0;
  private readonly waiting = new Map<number, (r: PreviewResult) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<CalcReply>) => {
      const cb = this.waiting.get(e.data.req);
      this.waiting.delete(e.data.req);
      cb?.(e.data.result);
    };
  }

  preview(bp: Blueprint): Promise<{ req: number; result: PreviewResult }> {
    const req = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(req, (result) => resolve({ req, result }));
      this.worker.postMessage({ req, bp } satisfies CalcRequest);
    });
  }

  /** Request number of the most recent call; older answers are stale. */
  latest(): number {
    return this.seq;
  }

  close(): void {
    this.worker.terminate();
  }
}
