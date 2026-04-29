import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import {
  routes, vesselTypes, riskBgClass, riskTextClass,
} from '../data/mockData.js';

const warMultiplier = (risk) => ({
  CRITICAL: 4.5,
  HIGH:     2.4,
  MODERATE: 1.4,
  LOW:      1.0,
}[risk] || 1.0);

const computeCosts = (route, vessel, fuel) => {
  const fuelCost = vessel.fuelTonsPerDay * route.transitDays * fuel * vessel.capex;
  const canal = route.canalFee;
  const crew = vessel.crewPerDay * route.transitDays;
  const insBase = route.cost * 0.012;
  const insurance = insBase * warMultiplier(route.risk);
  const total = fuelCost + canal + crew + insurance;
  return {
    fuel: Math.round(fuelCost),
    canal: Math.round(canal),
    crew: Math.round(crew),
    insurance: Math.round(insurance),
    total: Math.round(total),
  };
};

const fmtUSD = (n) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${(n / 1000).toFixed(0)}k`;

export default function Calculator() {
  const [routeId, setRouteId] = useState('r1');
  const [vesselId, setVesselId] = useState('lgcontainer');
  const [fuel, setFuel] = useState(680);

  const route = routes.find((r) => r.id === routeId);
  const vessel = vesselTypes.find((v) => v.id === vesselId);
  const alt = route?.altId ? routes.find((r) => r.id === route.altId) : null;

  const main = useMemo(() => computeCosts(route, vessel, fuel), [route, vessel, fuel]);
  const altCost = useMemo(() => (alt ? computeCosts(alt, vessel, fuel) : null), [alt, vessel, fuel]);

  const chartData = [
    {
      name: route.name.split(' (')[0],
      Fuel: main.fuel,
      'Canal Fees': main.canal,
      Crew: main.crew,
      Insurance: main.insurance,
    },
    ...(altCost
      ? [{
          name: alt.name.split(' (')[0] + ' (alt)',
          Fuel: altCost.fuel,
          'Canal Fees': altCost.canal,
          Crew: altCost.crew,
          Insurance: altCost.insurance,
        }]
      : []),
  ];

  const swapToAlt = () => alt && setRouteId(alt.id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-50">Voyage Cost Calculator</h2>
        <p className="text-sm text-gray-400 mt-1">Estimate total transit cost with risk-adjusted insurance.</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-gray-500">Route</label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded px-3 py-2"
          >
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-gray-500">Vessel Type</label>
          <select
            value={vesselId}
            onChange={(e) => setVesselId(e.target.value)}
            className="mt-1 w-full bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded px-3 py-2"
          >
            {vesselTypes.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-gray-500 flex justify-between">
            <span>VLSFO Fuel ($/ton)</span>
            <span className="font-mono text-gray-300">${fuel}</span>
          </label>
          <input
            type="range" min="400" max="1200" step="10"
            value={fuel}
            onChange={(e) => setFuel(parseInt(e.target.value, 10))}
            className="mt-3 w-full accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
            <span>$400</span><span>$1200</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-gray-500">Selected Voyage</div>
              <div className="text-lg font-semibold text-gray-100">{route.name}</div>
            </div>
            <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded ${riskBgClass(route.risk)} text-gray-950`}>
              {route.risk}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Total Cost" val={fmtUSD(main.total)} accent="text-cyan-300" />
            <Metric label="Distance" val={`${route.distance.toLocaleString()} nm`} />
            <Metric label="Transit" val={`${route.transitDays} days`} />
            <Metric
              label={`Insurance (${warMultiplier(route.risk).toFixed(1)}x war-risk)`}
              val={fmtUSD(main.insurance)}
              accent={riskTextClass(route.risk)}
            />
          </div>

          <div className="mt-6 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#6b7280" tick={{ fontSize: 10 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
                  formatter={(v) => fmtUSD(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Bar dataKey="Fuel" stackId="a" fill="#06b6d4" />
                <Bar dataKey="Canal Fees" stackId="a" fill="#a78bfa" />
                <Bar dataKey="Crew" stackId="a" fill="#22c55e" />
                <Bar dataKey="Insurance" stackId="a" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          {alt && altCost && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
              <div className="text-[11px] uppercase tracking-widest text-gray-500">Alternative Route</div>
              <div className="text-sm font-semibold text-gray-100 mt-1">{alt.name}</div>
              <div className="mt-3 space-y-1.5 text-xs">
                <Row label="Total" val={fmtUSD(altCost.total)} />
                <Row label="Δ vs current" val={fmtUSD(altCost.total - main.total)}
                     positive={altCost.total < main.total} />
                <Row label="Days" val={`${alt.transitDays}d`} />
                <Row label="Risk" val={alt.risk} />
              </div>
              <button
                onClick={swapToAlt}
                className="mt-4 w-full px-3 py-2 text-xs uppercase tracking-widest rounded bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-semibold"
              >
                Switch to alternative
              </button>
            </div>
          )}

          <div className="bg-gray-900 border border-yellow-500/30 rounded-lg p-5">
            <div className="text-[11px] uppercase tracking-widest text-yellow-400">Key Insight</div>
            <p className="text-xs text-gray-300 mt-2 leading-relaxed">
              War-risk insurance applies a <span className="font-mono text-yellow-300">{warMultiplier(route.risk).toFixed(1)}x</span> multiplier
              to the base hull premium for {route.risk.toLowerCase()}-risk corridors. On this voyage that adds
              <span className="font-mono text-yellow-300"> {fmtUSD(main.insurance - route.cost * 0.012)}</span> over a
              calm-route baseline — often enough to flip the cost-benefit on a Cape diversion.
            </p>
          </div>
        </div>
      </div>

      {alt && altCost && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 text-[11px] uppercase tracking-widest text-gray-500">
            Side-by-side comparison
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-950/50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Component</th>
                <th className="text-right px-4 py-2">{route.name.split(' (')[0]}</th>
                <th className="text-right px-4 py-2">{alt.name.split(' (')[0]}</th>
                <th className="text-right px-4 py-2">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono text-gray-200">
              <CompRow label="Fuel" a={main.fuel} b={altCost.fuel} />
              <CompRow label="Canal Fees" a={main.canal} b={altCost.canal} />
              <CompRow label="Crew" a={main.crew} b={altCost.crew} />
              <CompRow label="Insurance" a={main.insurance} b={altCost.insurance} />
              <CompRow label="Total" a={main.total} b={altCost.total} bold />
              <CompRow label="Transit (days)" a={route.transitDays} b={alt.transitDays} unit="d" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Metric = ({ label, val, accent }) => (
  <div className="bg-gray-950/40 border border-gray-800 rounded px-3 py-3">
    <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
    <div className={`font-mono text-lg mt-1 ${accent || 'text-gray-100'}`}>{val}</div>
  </div>
);

const Row = ({ label, val, positive }) => (
  <div className="flex justify-between">
    <span className="text-gray-400">{label}</span>
    <span className={`font-mono ${positive === true ? 'text-green-400' : positive === false ? 'text-red-400' : 'text-gray-100'}`}>
      {val}
    </span>
  </div>
);

const CompRow = ({ label, a, b, unit, bold }) => {
  const diff = b - a;
  const fmt = unit === 'd' ? (n) => `${n}d` : (n) => fmtUSD(n);
  return (
    <tr className="border-t border-gray-800">
      <td className={`px-4 py-2 ${bold ? 'text-gray-100 font-semibold' : 'text-gray-300'}`}>{label}</td>
      <td className="px-4 py-2 text-right">{fmt(a)}</td>
      <td className="px-4 py-2 text-right">{fmt(b)}</td>
      <td className={`px-4 py-2 text-right ${diff > 0 ? 'text-red-400' : diff < 0 ? 'text-green-400' : 'text-gray-500'}`}>
        {diff > 0 ? '+' : ''}{unit === 'd' ? `${diff}d` : fmtUSD(diff)}
      </td>
    </tr>
  );
};
