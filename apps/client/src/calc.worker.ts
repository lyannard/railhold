/// <reference lib="webworker" />
import { previewShot, type PreviewResult } from '@railhold/engine';
import type { Blueprint } from '@railhold/shared';

declare const self: DedicatedWorkerGlobalScope;

export interface CalcRequest {
  req: number;
  bp: Blueprint;
}
export interface CalcReply {
  req: number;
  result: PreviewResult;
}

self.onmessage = (e: MessageEvent<CalcRequest>) => {
  self.postMessage({ req: e.data.req, result: previewShot(e.data.bp) } satisfies CalcReply);
};
