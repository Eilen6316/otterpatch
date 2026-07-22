import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ClientAbortHandle {
  signal: AbortSignal;
  dispose(): void;
}

/** Abort in-flight work when the request body or response connection closes early. */
export function observeClientAbort(req: IncomingMessage, res: ServerResponse): ClientAbortHandle {
  const controller = new AbortController();
  const abort = (): void => {
    if (!res.writableEnded && !controller.signal.aborted) controller.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort);
      res.off('close', abort);
    },
  };
}
