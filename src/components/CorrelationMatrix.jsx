import React, { useMemo } from 'react';
import { useLiveData } from '../state/LiveData.jsx';

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const d1 = ax[i] - ma;
    const d2 = bx[i] - mb;
    num += d1 * d2;
    da += d1 * d1;
    db += d2 * d2;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

function dailyReturns(prices) {
  const r = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return r;
}

function corrColor(r) {
  if (r == null) return '#1f2937';
  if (r > 0.7)  return 'rgba(34,197,94,0.55)';
  if (r > 0.4)  return 'rgba(34,197,94,0.25)';
  if (r > 0.1)  return 'rgba(34,197,94,0.1)';
  if (r > -0.1) return 'rgba(156,163,175,0.07)';
  if (r > -0.4) return 'rgba(239,68,68,0.1)';
  if (r > -0.7) return 'rgba(239,68,68,0.25)';
  return 'rgba(239,68,68,0.55)';
}

export default function CorrelationMatrix({ tickers }) {
  const { commodities } = useLiveData();

  const matrix = useMemo(() => {
    if (!tickers || tickers.length < 2) return null;
    const returnsMap = {};
    for (const t of tickers) {
      const c = commodities.find((x) => x.ticker === t);
      if (c?.history?.length > 1) {
        returnsMap[t] = dailyReturns(c.history.map((h) => h.price));
      }
    }
    const result = {};
    for (const a of tickers) {
      result[a] = {};
      for (const b of tickers) {
        if (a === b) { result[a][b] = 1; continue; }
        if (!returnsMap[a] || !returnsMap[b]) { result[a][b] = null; continue; }
        result[a][b] = pearson(returnsMap[a], returnsMap[b]);
      }
    }
    return result;
  }, [tickers, commodities]);

  if (!tickers || tickers.length < 2) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-2">Correlation Matrix</div>
        <div className="text-xs text-gray-500 py-4 text-center">
          Add 2+ positions to see return correlations.
        </div>
      </div>
    );
  }

  const MAX_SHOW = 8;
  const shown = tickers.slice(0, MAX_SHOW);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
      <div className="px-4 py-3 sm:px-5 border-b border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Correlation Matrix</div>
          <div className="text-xs text-gray-300 mt-0.5">30-day daily returns · Pearson r</div>
        </div>
        {tickers.length > MAX_SHOW && (
          <div className="text-[10px] text-gray-500">showing first {MAX_SHOW}</div>
        )}
      </div>

      <div className="overflow-x-auto p-4">
        <table className="border-collapse text-xs select-none">
          <thead>
            <tr>
              <th className="w-12 pb-1" />
              {shown.map((t) => (
                <th key={t} className="font-mono text-[10px] text-gray-400 font-medium pb-1.5 px-0.5 text-center min-w-[52px]">
                  {t.length > 5 ? t.slice(0, 5) : t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a}>
                <td className="font-mono text-[10px] text-gray-400 font-medium pr-2 text-right py-0.5">
                  {a.length > 5 ? a.slice(0, 5) : a}
                </td>
                {shown.map((b) => {
                  const r = matrix?.[a]?.[b] ?? null;
                  const isDiag = a === b;
                  return (
                    <td
                      key={b}
                      style={{ background: corrColor(isDiag ? 1 : r) }}
                      className="min-w-[52px] h-10 text-center rounded-sm m-0.5 transition-colors"
                      title={isDiag ? `${a}` : `${a} vs ${b}: ${r != null ? r.toFixed(3) : '—'}`}
                    >
                      <span className={
                        isDiag ? 'text-gray-300 font-semibold text-[11px]'
                        : r == null ? 'text-gray-600 text-[10px]'
                        : Math.abs(r) > 0.5 ? 'text-gray-50 font-semibold text-[11px]'
                        : 'text-gray-300 text-[11px]'
                      }>
                        {isDiag ? '1.00' : r != null ? r.toFixed(2) : '—'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(34,197,94,0.55)' }} />
            Strong positive
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(156,163,175,0.07)' }} />
            Neutral
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.55)' }} />
            Strong negative
          </div>
        </div>
      </div>
    </div>
  );
}
