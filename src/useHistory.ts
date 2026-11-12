import { useRef, useState, useCallback } from 'react';
export function useHistory<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const ref = useRef(value), past = useRef<T[]>([]), future = useRef<T[]>([]);
  const [, refresh] = useState(0);
  const update = useCallback((next: T | ((current: T) => T), record = true) => {
    const result = typeof next === 'function' ? (next as (current: T) => T)(ref.current) : next;
    if (result === ref.current) return;
    if (record) { past.current = [...past.current.slice(-79), ref.current]; future.current = []; }
    ref.current = result; setValue(result);
  }, []);
  const commit = useCallback((before: T) => {
    if (JSON.stringify(before) === JSON.stringify(ref.current)) return;
    past.current = [...past.current.slice(-79), before]; future.current = []; refresh(n => n + 1);
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop(); if (!previous) return;
    future.current.push(ref.current); ref.current = previous; setValue(previous);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    past.current.push(ref.current); ref.current = next; setValue(next);
  }, []);
  return { value, ref, update, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
