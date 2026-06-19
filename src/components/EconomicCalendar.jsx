import React, { useMemo, useState } from 'react';

// Upcoming macro events — dates in YYYY-MM-DD, impact: 1-3
const EVENTS = [
  { date: '2026-06-03', event: 'NFP · May Jobs Report',    currency: 'USD', impact: 3, forecast: '180K',  prior: '177K'  },
  { date: '2026-06-10', event: 'CPI · May Inflation',       currency: 'USD', impact: 3, forecast: '3.1%',  prior: '3.2%'  },
  { date: '2026-06-11', event: 'FOMC Meeting (Day 1)',       currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
  { date: '2026-06-12', event: 'FOMC Decision + Press Conf', currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
  { date: '2026-06-13', event: 'PPI · May Producer Prices',  currency: 'USD', impact: 2, forecast: '0.2%', prior: '0.2%'  },
  { date: '2026-06-18', event: 'ECB Rate Decision',          currency: 'EUR', impact: 3, forecast: 'Hold',  prior: '3.25%' },
  { date: '2026-06-25', event: 'GDP Q1 2026 Final',          currency: 'USD', impact: 2, forecast: '1.8%',  prior: '1.8%'  },
  { date: '2026-07-01', event: 'NFP · June Jobs Report',     currency: 'USD', impact: 3, forecast: '175K',  prior: '180K'  },
  { date: '2026-07-09', event: 'FOMC Minutes (June)',        currency: 'USD', impact: 2, forecast: '—',     prior: '—'     },
  { date: '2026-07-14', event: 'CPI · June Inflation',       currency: 'USD', impact: 3, forecast: '3.0%',  prior: '3.1%'  },
  { date: '2026-07-28', event: 'BOJ Policy Decision',        currency: 'JPY', impact: 3, forecast: 'Hold',  prior: '0.5%'  },
  { date: '2026-07-29', event: 'FOMC Meeting (Day 1)',       currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
  { date: '2026-07-30', event: 'FOMC Decision + PCE',        currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
  { date: '2026-08-05', event: 'NFP · July Jobs Report',     currency: 'USD', impact: 3, forecast: '172K',  prior: '175K'  },
  { date: '2026-08-12', event: 'CPI · July Inflation',       currency: 'USD', impact: 3, forecast: '2.9%',  prior: '3.0%'  },
  { date: '2026-08-21', event: 'Jackson Hole Symposium',     currency: 'USD', impact: 3, forecast: '—',     prior: '—'     },
  { date: '2026-09-02', event: 'NFP · August Jobs Report',   currency: 'USD', impact: 3, forecast: '170K',  prior: '172K'  },
  { date: '2026-09-09', event: 'CPI · August Inflation',     currency: 'USD', impact: 3, forecast: '2.8%',  prior: '2.9%'  },
  { date: '2026-09-16', event: 'FOMC Meeting (Day 1)',       currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
  { date: '2026-09-17', event: 'FOMC Decision',              currency: 'USD', impact: 3, forecast: 'Hold',  prior: '4.5%'  },
];

const IMPACT_DOTS = {
  3: { dots: 3, color: 'bg-red-500',    label: 'High' },
  2: { dots: 2, color: 'bg-yellow-500', label: 'Medium' },
  1: { dots: 1, color: 'bg-gray-500',   label: 'Low' },
};

const CCY_COLORS = {
  USD: 'text-cyan-300',
  EUR: 'text-blue-400',
  JPY: 'text-yellow-400',
  GBP: 'text-purple-400',
};

function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function EconomicCalendar() {
  const [impactFilter, setImpactFilter] = useState(0); // 0 = all

  const upcoming = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return EVENTS
      .map((e) => ({ ...e, daysAway: daysUntil(e.date) }))
      .filter((e) => e.daysAway >= 0 && e.daysAway <= 90)
      .filter((e) => impactFilter === 0 || e.impact === impactFilter)
      .sort((a, b) => a.daysAway - b.daysAway);
  }, [impactFilter]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 overflow-hidden">
      <div className="px-4 py-3 sm:px-5 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Economic Calendar</div>
          <div className="text-xs text-gray-300 mt-0.5">Next 90 days · macro events</div>
        </div>
        <div className="flex gap-1 items-center">
          <span className="text-[10px] text-gray-500 mr-1">Impact:</span>
          {[0, 3, 2].map((v) => (
            <button
              key={v}
              onClick={() => setImpactFilter(v)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                impactFilter === v
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-gray-500 hover:text-gray-300 border border-transparent'
              }`}
            >
              {v === 0 ? 'All' : v === 3 ? '🔴 High' : '🟡 Med'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-[10px] uppercase tracking-widest text-gray-500">
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Event</th>
              <th className="px-3 py-2 text-center font-medium">Imp.</th>
              <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Forecast</th>
              <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">Prior</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">No events match the filter.</td>
              </tr>
            )}
            {upcoming.map((e, i) => {
              const meta = IMPACT_DOTS[e.impact];
              const ccy = CCY_COLORS[e.currency] || 'text-gray-400';
              const isToday = e.daysAway === 0;
              const isSoon = e.daysAway <= 3 && e.daysAway > 0;
              return (
                <tr key={i} className={`${isToday ? 'bg-cyan-500/5' : 'hover:bg-gray-800/30'} transition-colors`}>
                  <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                    <div className="text-gray-100">{formatDate(e.date)}</div>
                    <div className={`text-[10px] mt-0.5 ${isToday ? 'text-cyan-400 font-semibold' : isSoon ? 'text-amber-400' : 'text-gray-500'}`}>
                      {isToday ? 'Today' : `in ${e.daysAway}d`}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="text-gray-100 leading-snug">{e.event}</div>
                    <div className={`text-[10px] font-mono mt-0.5 ${ccy}`}>{e.currency}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      {[1, 2, 3].map((d) => (
                        <span
                          key={d}
                          className={`w-1.5 h-1.5 rounded-full ${d <= e.impact ? meta.color : 'bg-gray-700'}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-gray-300 hidden sm:table-cell">
                    {e.forecast}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500 hidden sm:table-cell">
                    {e.prior}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
