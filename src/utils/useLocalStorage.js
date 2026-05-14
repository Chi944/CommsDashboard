import { useEffect, useState, useCallback } from 'react';

// Persist a piece of state to localStorage. SSR-safe.
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      if (typeof window === 'undefined') return initial;
      const raw = localStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);

  const reset = useCallback(() => setValue(initial), [initial]);
  return [value, setValue, reset];
}
