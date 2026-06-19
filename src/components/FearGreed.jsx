import React, { useEffect, useState } from 'react';

const ZONES = [
  { label: 'Extreme Fear', color: '#ef4444', min: 0,  max: 25  },
  { label: 'Fear',         color: '#f97316', min: 26, max: 45  },
  { label: 'Neutral',      color: '#eab308', min: 46, max: 55  },
  { label: 'Greed',        color: '#84cc16', min: 56, max: 75  },
  { label: 'Extreme Greed',color: '#22c55e', min: 76, max: 100 },
];

function zoneColor(v) {
  for (const z of ZONES) if (v >= z.min && v <= z.max) return z.color;
  return '#6b7280';
}

function zoneLabel(v) {
  for (const z of ZONES) if (v >= z.min && v <= z.max) return z.label;
  return 'Unknown';
}

function Gauge({ value }) {
  const cx = 80, cy = 80, r = 62;
  const toAngle = (v) => Math.PI - (v / 100) * Math.PI;
  const ax = (a) => cx + r * Math.cos(a);
  const ay = (a) => cy - r * Math.sin(a);

  const na = toAngle(value);
  const nx = cx + 52 * Math.cos(na);
  const ny = cy - 52 * Math.sin(na);
  const color = zoneColor(value);

  // Background track
  const bgPath = `M ${ax(Math.PI)} ${ay(Math.PI)} A ${r} ${r} 0 0 1 ${ax(0)} ${ay(0)}`;

  // Filled arc (sweep-flag=1 clockwise, large-arc=0 since max span is 180°)
  const fa = toAngle(value);
  const fillPath = value > 0
    ? `M ${ax(Math.PI)} ${ay(Math.PI)} A ${r} ${r} 0 0 1 ${ax(fa)} ${ay(fa)}`
    : null;

  return (
    <svg width="160" height="90" viewBox="0 0 160 90" className="overflow-visible">
      <path d={bgPath} fill="none" stroke="#374151" strokeWidth={9} strokeLinecap="round" />
      {fillPath && (
        <path d={fillPath} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
      )}
      {/* Zone ticks */}
      {ZONES.slice(1).map((z) => {
        const a = toAngle(z.min);
        const ix = cx + (r - 5) * Math.cos(a);
        const iy = cy - (r - 5) * Math.sin(a);
        const ox = cx + (r + 5) * Math.cos(a);
        const oy = cy - (r + 5) * Math.sin(a);
        return <line key={z.min} x1={ix} y1={iy} x2={ox} y2={oy} stroke="#4b5563" strokeWidth={1.5} />;
      })}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </svg>
  );
}

export default function FearGreed() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/fear-greed')
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.ok) setData(j); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-3">
        Crypto Fear &amp; Greed
      </div>
      {loading ? (
        <div className="h-24 animate-pulse bg-gray-800/40 rounded" />
      ) : !data ? (
        <div className="h-24 flex items-center justify-center text-xs text-gray-600">
          Unavailable
        </div>
      ) : (
        <div className="flex items-center gap-5">
          <Gauge value={data.value} />
          <div>
            <div className="font-mono text-4xl font-bold text-gray-50 leading-none">
              {data.value}
            </div>
            <div className="text-sm font-semibold mt-1.5" style={{ color: zoneColor(data.value) }}>
              {zoneLabel(data.value)}
            </div>
            {data.updatedAt && (
              <div className="text-[10px] text-gray-500 font-mono mt-1.5">
                {new Date(data.updatedAt).toLocaleDateString(undefined, {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </div>
            )}
            {/* Legend dots */}
            <div className="mt-3 flex flex-col gap-0.5">
              {ZONES.map((z) => (
                <div key={z.label} className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: z.color }} />
                  {z.min}–{z.max} {z.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
