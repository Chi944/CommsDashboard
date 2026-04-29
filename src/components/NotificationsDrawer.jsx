import React from 'react';
import { notifications, severityBg } from '../data/mockData.js';

export default function NotificationsDrawer({ open, onClose }) {
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
        <header className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">Live wire</div>
            <h3 className="text-base font-semibold text-gray-100">Alerts &amp; notifications</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-xl leading-none px-2"
            aria-label="close"
          >×</button>
        </header>
        <div className="overflow-y-auto h-[calc(100%-65px)]">
          {notifications.map((n) => (
            <div key={n.id} className="px-5 py-4 border-b border-gray-800 hover:bg-gray-900/50">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${severityBg(n.severity)}`} />
                <span className="text-[10px] uppercase tracking-widest text-gray-400">{n.severity}</span>
                <span className="text-[10px] text-gray-600 ml-auto">{n.time}</span>
              </div>
              <div className="mt-1.5 text-sm font-semibold text-gray-100">{n.title}</div>
              <div className="mt-1 text-xs text-gray-400 leading-relaxed">{n.body}</div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
