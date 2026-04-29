import React, { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import {
  commodities, corridors, riskBgClass, riskTextClass, riskBorderClass, riskStrokeHex,
} from '../data/mockData.js';
import Sparkline from './Sparkline.jsx';

const StatCard = ({ label, value, sub, accent }) => (
  <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
    <div className="text-[11px] uppercase tracking-widest text-gray-500">{label}</div>
    <div className={`mt-2 font-mono text-3xl ${accent || 'text-gray-100'}`}>{value}</div>
    {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
  </div>
);

const CorridorCard = ({ c }) => (
  <div className={`bg-gray-900 border ${riskBorderClass(c.risk)} rounded-lg p-5 flex flex-col gap-4`}>
    <div className="flex items-start justify-between">
      <div>
        <div className="text-base font-semibold text-gray-100">{c.name}</div>
        <div className="text-xs text-gray-500 mt-0.5">Vessels affected: <span className="font-mono text-gray-300">{c.vessels}</span></div>
      </div>
      <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded ${riskBgClass(c.risk)} text-gray-950`}>
        {c.risk}
      </span>
    </div>

    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500 uppercase tracking-wider">Disruption Score</span>
        <span className={`font-mono ${riskTextClass(c.risk)}`}>{c.score}/100</span>
      </div>
      <div className="h-2 bg-gray-800 rounded">
        <div className={`h-2 rounded ${riskBgClass(c.risk)}`} style={{ width: `${c.score}%` }} />
      </div>
    </div>

    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-widest text-gray-500">30-day trend</span>
      <Sparkline
        data={c.scoreHistory.map((p) => p.score)}
        color={riskStrokeHex(c.risk)}
        width={140}
        height={28}
        fill
      />
    </div>

    <p className="text-xs text-gray-400 leading-relaxed">{c.description}</p>

    <div className="flex flex-wrap gap-1.5">
      {c.tags.map((t) => (
        <span key={t} className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">
          {t}
        </span>
      ))}
    </div>
  </div>
);

const TopMovers = () => {
  const sorted = useMemo(
    () => [...commodities].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
    []
  );
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wider">Top Movers</h3>
        <span className="text-[10px] text-gray-500">|Δ| ranked</span>
      </div>
      <ul className="divide-y divide-gray-800">
        {sorted.slice(0, 5).map((c) => {
          const up = c.changePct >= 0;
          return (
            <li key={c.ticker} className="py-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-100">{c.name}</div>
                <div className="text-[10px] text-gray-500 font-mono">{c.ticker}</div>
              </div>
              <Sparkline
                data={c.history.map((h) => h.price)}
                color={up ? '#22c55e' : '#ef4444'}
                width={70}
                height={22}
              />
              <div className={`font-mono text-xs ${up ? 'text-green-400' : 'text-red-400'} w-16 text-right`}>
                {up ? '+' : ''}{c.changePct.toFixed(2)}%
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const DisruptionTrend = () => {
  // Combine all four corridors' history into a single series indexed by day.
  const data = useMemo(() => {
    const ref = corridors[0].scoreHistory;
    return ref.map((_, i) => {
      const row = { day: i === ref.length - 1 ? 'today' : `D-${ref.length - 1 - i}` };
      corridors.forEach((c) => { row[c.name] = c.scoreHistory[i].score; });
      return row;
    });
  }, []);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-100 uppercase tracking-wider">Corridor Risk — 30-day</h3>
        <span className="text-[10px] text-gray-500">Score 0–100</span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
            <defs>
              {corridors.map((c) => (
                <linearGradient key={c.id} id={`g-${c.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={riskStrokeHex(c.risk)} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={riskStrokeHex(c.risk)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#6b7280" tick={{ fontSize: 10 }} interval={4} />
            <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} domain={[0, 100]} />
            <Tooltip
              contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Legend wrapperStyle={{ fontSize: 10, color: '#9ca3af' }} />
            {corridors.map((c) => (
              <Area
                key={c.id}
                type="monotone"
                dataKey={c.name}
                stroke={riskStrokeHex(c.risk)}
                fill={`url(#g-${c.id})`}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default function Overview() {
  const wti = commodities.find((c) => c.symbol === 'WTI');
  const gold = commodities.find((c) => c.symbol === 'GOLD');
  const totalVessels = corridors.reduce((s, c) => s + c.vessels, 0);
  const activeAlerts = corridors.filter((c) => c.risk === 'CRITICAL' || c.risk === 'HIGH').length + 9;

  return (
    <div className="space-y-8">
      <div>
        <div className="text-xs uppercase tracking-[0.3em] text-gray-500">Live Operations</div>
        <h2 className="mt-1 text-4xl font-bold text-gray-50">Global Disruption Overview</h2>
        <p className="mt-2 text-sm text-gray-400 max-w-3xl">
          Real-time monitoring of commodity flows and shipping chokepoints. Risk-weighted view across the four
          most active maritime corridors driving global trade volatility.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="WTI Crude"
          value={`$${wti.price.toFixed(2)}`}
          sub={`${wti.changePct >= 0 ? '+' : ''}${wti.changePct.toFixed(2)}% today`}
          accent={wti.changePct >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Gold"
          value={`$${gold.price.toLocaleString()}`}
          sub={`${gold.changePct >= 0 ? '+' : ''}${gold.changePct.toFixed(2)}% today`}
          accent={gold.changePct >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Active Alerts"
          value={activeAlerts}
          sub="Across 4 corridors"
          accent="text-orange-400"
        />
        <StatCard
          label="Vessels Affected"
          value={totalVessels.toLocaleString()}
          sub="Currently rerouting / delayed"
          accent="text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><DisruptionTrend /></div>
        <TopMovers />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-100">Corridor Disruption Index</h3>
          <span className="text-xs text-gray-500 uppercase tracking-wider">4 corridors monitored</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {corridors.map((c) => <CorridorCard key={c.id} c={c} />)}
        </div>
      </div>
    </div>
  );
}
