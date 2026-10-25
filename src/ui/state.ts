import { createContext, useContext } from 'react';
import type { Result, Scenario } from '../engine/types';

export interface AppState {
  scenario: Scenario;
  result: Result;
  setScenario: (s: Scenario) => void;
  update: (mutate: (s: Scenario) => void) => void;
  go: (tab: string) => void;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error('AppCtx missing');
  return v;
}
