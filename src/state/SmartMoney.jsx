import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  createDailyBriefingState,
  dailyBriefingReducer,
} from '../lib/dailyBriefingState.js';
import {
  researchOnlyCapabilityCopy,
  validateSmartMoneySnapshot,
} from '../lib/smartMoneyContract.js';
import {
  loadSmartMoneyPreferences,
  saveSmartMoneyPreferences,
} from '../lib/smartMoneyStorage.js';

const SmartMoneyContext = createContext(null);

function safeMessage(value, fallback) {
  return String(value?.message ?? value ?? fallback)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200) || fallback;
}

async function readPublicJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Smart Money request failed (${response.status}).`);
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `Smart Money request failed (${response.status}).`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function requestOptions(signal) {
  return {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    signal,
  };
}

export function SmartMoneyProvider({ children }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [preferences, setPreferences] = useState(() => loadSmartMoneyPreferences());
  const [briefingState, dispatchBriefing] = useReducer(
    dailyBriefingReducer,
    undefined,
    () => createDailyBriefingState(),
  );
  const mountedRef = useRef(false);
  const snapshotRequestRef = useRef(0);
  const briefingRequestRef = useRef(0);
  const snapshotAbortRef = useRef(null);
  const briefingAbortRef = useRef(null);

  const loadSnapshot = useCallback(async (refresh = false) => {
    const requestId = snapshotRequestRef.current + 1;
    snapshotRequestRef.current = requestId;
    snapshotAbortRef.current?.abort();
    const controller = new AbortController();
    snapshotAbortRef.current = controller;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch(
        refresh ? '/api/smart-money?refresh=1' : '/api/smart-money',
        requestOptions(controller.signal),
      );
      const payload = await readPublicJson(response);
      const candidate = validateSmartMoneySnapshot(payload);
      if (!candidate) throw new Error('Smart Money response was invalid.');
      if (!mountedRef.current || requestId !== snapshotRequestRef.current) return;
      setSnapshot((current) => (
        current === null || candidate.fetchedAt >= current.fetchedAt ? candidate : current
      ));
      setError(null);
    } catch (caught) {
      if (!mountedRef.current || requestId !== snapshotRequestRef.current
          || caught?.name === 'AbortError') return;
      const degraded = validateSmartMoneySnapshot(caught?.payload?.lastKnownGood);
      if (degraded) {
        setSnapshot((current) => (
          current === null || degraded.fetchedAt >= current.fetchedAt ? degraded : current
        ));
      }
      setError(safeMessage(caught, 'Smart Money data is temporarily unavailable.'));
    } finally {
      if (mountedRef.current && requestId === snapshotRequestRef.current) setLoading(false);
    }
  }, []);

  const loadBriefing = useCallback(async (refresh = false) => {
    const requestId = briefingRequestRef.current + 1;
    briefingRequestRef.current = requestId;
    briefingAbortRef.current?.abort();
    const controller = new AbortController();
    briefingAbortRef.current = controller;
    dispatchBriefing({ type: 'request', requestId });
    try {
      const response = await fetch(
        refresh ? '/api/smart-money/briefing?refresh=1' : '/api/smart-money/briefing',
        requestOptions(controller.signal),
      );
      const payload = await readPublicJson(response);
      if (!mountedRef.current || requestId !== briefingRequestRef.current) return;
      dispatchBriefing({ type: 'success', requestId, candidate: payload });
    } catch (caught) {
      if (!mountedRef.current || requestId !== briefingRequestRef.current
          || caught?.name === 'AbortError') return;
      dispatchBriefing({ type: 'failure', requestId, error: safeMessage(
        caught, 'Smart Money briefing is temporarily unavailable.',
      ) });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadSnapshot(false);
    loadBriefing(false);
    const onFocus = () => {
      loadSnapshot(false);
      loadBriefing(false);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      mountedRef.current = false;
      snapshotAbortRef.current?.abort();
      briefingAbortRef.current?.abort();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadBriefing, loadSnapshot]);

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    const scheduleNextUtcDay = () => {
      const current = new Date();
      const next = Date.UTC(
        current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() + 1,
        0, 1, 0,
      );
      timer = window.setTimeout(async () => {
        if (cancelled || !mountedRef.current) return;
        await Promise.allSettled([loadSnapshot(true), loadBriefing(true)]);
        if (!cancelled) scheduleNextUtcDay();
      }, Math.max(1_000, next - current.getTime()));
    };
    scheduleNextUtcDay();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadBriefing, loadSnapshot]);

  useEffect(() => {
    saveSmartMoneyPreferences(undefined, preferences);
  }, [preferences]);

  const followEntity = useCallback((entityId) => {
    if (!snapshot?.entities.some((entity) => entity.id === entityId)) return;
    setPreferences((current) => current.followedEntityIds.includes(entityId) ? current : ({
      ...current,
      followedEntityIds: [...current.followedEntityIds, entityId],
    }));
  }, [snapshot]);

  const unfollowEntity = useCallback((entityId) => {
    setPreferences((current) => ({
      ...current,
      followedEntityIds: current.followedEntityIds.filter((id) => id !== entityId),
    }));
  }, []);

  const setBrowserNotificationsEnabled = useCallback((enabled) => {
    setPreferences((current) => ({
      ...current,
      browserNotificationsEnabled: enabled === true,
    }));
  }, []);

  const refreshResearch = useCallback(() => Promise.allSettled([
    loadSnapshot(true),
    loadBriefing(true),
  ]), [loadBriefing, loadSnapshot]);

  const value = useMemo(() => ({
    snapshot,
    entities: snapshot?.entities ?? [],
    activities: snapshot?.activities ?? [],
    performances: snapshot?.performances ?? [],
    signals: snapshot?.signals ?? [],
    rankings: snapshot?.rankings ?? null,
    providerStatuses: snapshot?.providerStatuses ?? [],
    warnings: snapshot?.warnings ?? [],
    sourceLinks: snapshot?.sourceLinks ?? [],
    simulationCapability: snapshot?.simulationCapability ?? researchOnlyCapabilityCopy(),
    loading,
    error,
    refreshSmartMoney: refreshResearch,
    briefingEnvelope: briefingState.accepted,
    briefing: briefingState.accepted?.briefing ?? null,
    briefingLoading: briefingState.loading,
    briefingError: briefingState.error,
    refreshBriefing: () => loadBriefing(true),
    followedEntityIds: preferences.followedEntityIds,
    browserNotificationsEnabled: preferences.browserNotificationsEnabled,
    followEntity,
    unfollowEntity,
    setBrowserNotificationsEnabled,
  }), [
    briefingState.accepted,
    briefingState.error,
    briefingState.loading,
    error,
    followEntity,
    loadBriefing,
    loadSnapshot,
    loading,
    preferences.browserNotificationsEnabled,
    preferences.followedEntityIds,
    refreshResearch,
    setBrowserNotificationsEnabled,
    snapshot,
    unfollowEntity,
  ]);

  return <SmartMoneyContext.Provider value={value}>{children}</SmartMoneyContext.Provider>;
}

export function useSmartMoney() {
  const value = useContext(SmartMoneyContext);
  if (!value) throw new Error('useSmartMoney must be used within SmartMoneyProvider');
  return value;
}
