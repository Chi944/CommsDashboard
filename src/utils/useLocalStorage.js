import { useEffect, useState, useCallback } from 'react';

// Persist a piece of state to localStorage. SSR-safe.
const identity = (value) => value;

export function useLocalStorage(key, initial, normalize = identity) {
  const [value, setStoredValue] = useState(() => {
    try {
      if (typeof window === 'undefined') return initial;
      const raw = localStorage.getItem(key);
      return raw != null ? normalize(JSON.parse(raw)) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);

  const setValue = useCallback((next) => {
    setStoredValue((previous) => normalize(typeof next === 'function' ? next(previous) : next));
  }, [normalize]);
  const reset = useCallback(() => setValue(initial), [initial, setValue]);
  return [value, setValue, reset];
}
