/// <reference lib="webworker" />
import { getContext } from './data';
import { optimize, type OptimizeOptions } from '../engine/optimize';
import { tornado, monteCarlo } from '../engine/risk';
import type { Scenario } from '../engine/types';

type Msg =
  | { id: number; kind: 'optimize'; scenario: Scenario; options: OptimizeOptions }
  | { id: number; kind: 'tornado'; scenario: Scenario }
  | { id: number; kind: 'montecarlo'; scenario: Scenario; runs: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  const post = (data: unknown) => (self as unknown as Worker).postMessage(data);
  try {
    const ctx = getContext();
    if (m.kind === 'optimize') {
      const res = optimize(m.scenario, ctx, m.options, (p) => post({ id: m.id, progress: p.done / p.total, best: p.best }));
      post({ id: m.id, done: true, result: { best: res.best, evaluated: res.evaluated, top: res.top, evaluations: res.evaluations, ms: res.ms } });
    } else if (m.kind === 'tornado') {
      const res = tornado(m.scenario, ctx, (d, t) => post({ id: m.id, progress: d / t }));
      post({ id: m.id, done: true, result: res });
    } else if (m.kind === 'montecarlo') {
      const res = monteCarlo(m.scenario, ctx, m.runs, 42, (d, t) => post({ id: m.id, progress: d / t }));
      post({ id: m.id, done: true, result: res });
    }
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
