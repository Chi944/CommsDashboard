import React, { useState } from 'react';
import { useLiveData } from '../state/LiveData.jsx';

export default function AlertButton({ asset, compact = false }) {
  const { alerts, addAlert, removeAlert, toggleAlert, requestNotificationPermission } = useLiveData();
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState('>');
  const [price, setPrice] = useState('');

  const myAlerts = alerts.filter((a) => a.ticker === asset?.ticker);
  const hasAny = myAlerts.length > 0;

  const submit = async (e) => {
    e?.preventDefault?.();
    const p = Number(price);
    if (!asset || !p || !isFinite(p)) return;
    if ('Notification' in window) await requestNotificationPermission();
    addAlert({ ticker: asset.ticker, op, price: p, name: asset.name });
    setPrice('');
  };

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`${compact ? 'text-sm' : 'text-base'} leading-none transition-colors ${hasAny ? 'text-cyan-400' : 'text-gray-600 hover:text-gray-300'}`}
        title={hasAny ? `${myAlerts.length} alert${myAlerts.length > 1 ? 's' : ''} set` : 'Set price alert'}
        aria-label="price alerts"
      >
        🔔
      </button>

      {open && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-xl border border-gray-800 bg-gray-950/95 shadow-2xl p-5 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500">Price alert</div>
                <div className="text-sm font-semibold text-gray-100">{asset.name} <span className="text-gray-500 font-mono">· {asset.ticker}</span></div>
                <div className="text-xs text-gray-400 mt-1 font-mono">Current: {asset.price?.toLocaleString()}</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-200 text-xl leading-none">×</button>
            </div>

            <form onSubmit={submit} className="flex items-end gap-2 mb-4">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-gray-500">Trigger when</label>
                <div className="mt-1 flex gap-1">
                  {['>', '<'].map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOp(o)}
                      className={`w-9 h-9 text-sm rounded-md font-mono transition
                        ${op === o ? 'bg-cyan-500 text-gray-950 border border-cyan-400' : 'bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-500'}`}
                    >{o}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-widest text-gray-500">Price</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={asset.price?.toString() || '0'}
                  className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-md px-3 py-2 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="submit"
                disabled={!price}
                className="h-9 px-4 rounded-md text-xs uppercase tracking-wider bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >Add</button>
            </form>

            {myAlerts.length > 0 && (
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-gray-500">Active alerts</div>
                {myAlerts.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 bg-gray-900/60 border border-gray-800 rounded-md px-3 py-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${a.enabled ? 'bg-cyan-400 animate-pulse-soft' : 'bg-gray-600'}`} />
                    <span className="font-mono text-xs text-gray-100">when {a.op} {a.price.toLocaleString()}</span>
                    {a.lastTriggeredAt && (
                      <span className="text-[10px] text-amber-300">last fired {new Date(a.lastTriggeredAt).toLocaleTimeString()}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => toggleAlert(a.id)}
                        className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
                      >{a.enabled ? 'pause' : 'enable'}</button>
                      <button
                        onClick={() => removeAlert(a.id)}
                        className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-red-700/50 text-red-300 hover:bg-red-500/10"
                      >remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-[10px] text-gray-500 mt-3">
              Alerts trigger when price crosses the threshold (intraday) — checked every 60s with each price poll.
              Browser notifications fire if you allow them.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
