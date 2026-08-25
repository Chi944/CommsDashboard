import React, { useEffect, useId, useRef, useState } from 'react';
import { severityBg } from '../data/mockData.js';
import { useLiveData } from '../state/LiveData.jsx';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableElements = (container) => (
  container ? Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)) : []
);

export default function NotificationsDrawer({ open, onClose }) {
  const { notifications, triggeredAlerts, clearTriggered, newsLive, newsUpdatedAt, requestNotificationPermission } = useLiveData();
  const [notifPerm, setNotifPerm] = useState(() => {
    try { return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'; } catch { return 'unsupported'; }
  });
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const headingId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      try { setNotifPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'); } catch {}
    };
    update();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      previousFocus?.focus?.();
    };
  }, [open]);

  const enableNotifications = async () => {
    const result = await requestNotificationPermission();
    setNotifPerm(result);
  };

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/50 z-40 transition-opacity opacity-100"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="fixed top-0 right-0 h-full w-full sm:w-[28rem] max-w-full bg-gray-950/95 backdrop-blur border-l border-gray-800 z-50 shadow-2xl
          transform transition-transform duration-300 ease-out
          translate-x-0"
      >
        <header className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Live wire</div>
              <h3 id={headingId} className="text-base font-semibold text-gray-100">Alerts &amp; notifications</h3>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-xl leading-none px-2"
              aria-label="Close notifications"
            >×</button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] flex-wrap">
            <span className={`flex items-center gap-1.5 ${newsLive ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400'}`} />
              {newsLive ? 'live news + price alerts' : 'fetching'}
            </span>
            {newsUpdatedAt && (
              <span className="text-gray-500 font-mono">
                {new Date(newsUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
            {notifPerm === 'default' && (
              <button
                type="button"
                onClick={enableNotifications}
                className="ml-auto px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30 transition-colors"
              >Enable push notifications</button>
            )}
            {notifPerm === 'granted' && (
              <span className="ml-auto flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Push on
              </span>
            )}
            {notifPerm === 'denied' && (
              <span className="ml-auto text-gray-500">Push blocked in browser</span>
            )}
          </div>
        </header>
        <div className="overflow-y-auto h-[calc(100%-95px)]">

          {/* Triggered price alerts */}
          {triggeredAlerts.length > 0 && (
            <div>
              <div className="px-5 py-2 text-[10px] uppercase tracking-widest text-cyan-300 flex items-center justify-between border-b border-gray-800 bg-cyan-900/10">
                <span>🔔 Price alerts triggered</span>
                <button type="button" onClick={clearTriggered} aria-label="Clear triggered price alerts" className="text-gray-500 hover:text-gray-200 normal-case">clear</button>
              </div>
              {triggeredAlerts.map((t) => (
                <div key={t.id} className="px-5 py-3 border-b border-gray-800 bg-cyan-500/5">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-cyan-300">
                    <span>Crossed</span>
                    <span className="font-mono text-cyan-200">{t.ticker} {t.op} {t.threshold}</span>
                    <span className="ml-auto text-gray-500 normal-case">{new Date(t.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-1 text-sm text-gray-100">{t.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-cyan-200">now {t.price}</div>
                </div>
              ))}
            </div>
          )}

          {notifications.length === 0 && triggeredAlerts.length === 0 && (
            <div className="px-5 py-8 text-sm text-gray-500 text-center">
              No active alerts.
            </div>
          )}
          {notifications.map((n) => {
            const inner = (
              <>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${severityBg(n.severity)}`} />
                  <span className="text-[10px] uppercase tracking-widest text-gray-400">{n.severity}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">{n.time}</span>
                </div>
                <div className="mt-1.5 text-sm font-semibold text-gray-100">{n.title}</div>
                {n.body && <div className="mt-1 text-xs text-gray-400 leading-relaxed">{n.body}</div>}
              </>
            );

            return n.url ? (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-5 py-4 border-b border-gray-800 hover:bg-gray-900/70"
              >{inner}</a>
            ) : (
              <div key={n.id} className="px-5 py-4 border-b border-gray-800 hover:bg-gray-900/50">
                {inner}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
