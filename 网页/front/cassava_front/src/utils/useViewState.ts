import { useState, type Dispatch, type SetStateAction } from 'react';
import { workspaceStorageKey } from './workspaceContext';

export function useViewState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try { const saved = sessionStorage.getItem(workspaceStorageKey(name)); return saved ? JSON.parse(saved) : initial; }
    catch { return initial; }
  });
  const update: Dispatch<SetStateAction<T>> = value => setState(previous => {
    const next = typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;
    try { sessionStorage.setItem(workspaceStorageKey(name), JSON.stringify(next)); } catch { /* Optional persistence. */ }
    return next;
  });
  return [state, update];
}
