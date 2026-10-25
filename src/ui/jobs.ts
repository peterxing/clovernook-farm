let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number, extra?: unknown) => void }>();

function get(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data as { id: number; progress?: number; best?: unknown; done?: boolean; result?: unknown; error?: string };
    const p = pending.get(d.id);
    if (!p) return;
    if (d.error) { pending.delete(d.id); p.reject(new Error(d.error)); return; }
    if (d.done) { pending.delete(d.id); p.resolve(d.result); return; }
    if (d.progress !== undefined) p.onProgress?.(d.progress, d.best);
  };
  worker.onerror = (e) => {
    for (const [, p] of pending) p.reject(new Error(e.message || 'Worker failed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export function runJob<T>(kind: 'optimize' | 'tornado' | 'montecarlo', payload: Record<string, unknown>, onProgress?: (p: number, extra?: unknown) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    get().postMessage({ id, kind, ...payload });
  });
}
