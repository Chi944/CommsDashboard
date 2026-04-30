import React from 'react';
import { severityBg } from '../data/mockData.js';
import { useLiveData } from '../state/LiveData.jsx';

export default function NotificationsDrawer({ open, onClose }) {
  const { notifications, newsLive, newsUpdatedAt } = useLiveData();

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-gray-950 border-l border-gray-800 z-50
          transform transition-transform duration-200
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Live wire</div>
              <h3 className="text-base font-semibold text-gray-100">Alerts &amp; notifications</h3>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-xl leading-none px-2"
              aria-label="close"
            >×</button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px]">
            <span className={`flex items-center gap-1.5 ${newsLive ? 'text-green-400' : 'text-yellow-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${newsLive ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
              {newsLive ? 'derived from live news feed' : 'fallback (mock)'}
            </span>
            {newsUpdatedAt && (
              <span className="text-gray-500 font-mono">
                {new Date(newsUpdatedAt).toUTCString().slice(17, 25)}Z
              </span>
            )}
          </div>
        </header>
        <div className="overflow-y-auto h-[calc(100%-95px)]">
          {notifications.length === 0 && (
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
