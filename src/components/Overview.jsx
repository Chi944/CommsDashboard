import React from 'react';
import { commodities, corridors, riskBgClass, riskTextClass, riskBorderClass } from '../data/mockData.js';

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
        <div
          className={`h-2 rounded ${riskBgClass(c.risk)}`}
          style={{ width: `${c.score}%` }}
        />
      </div>
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
