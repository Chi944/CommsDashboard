import React, { useMemo, useState } from 'react';
import {
  routes, chokepoints, riskBgClass, riskTextClass, riskBorderClass,
} from '../data/mockData.js';
import WorldMap from './WorldMap.jsx';

const REGIONS = ['All', 'Asia↔Europe', 'Trans-Pacific', 'Trans-Atlantic', 'Middle East', 'Intra-Asia', 'Americas'];

const fmt = (n) => n.toLocaleString();
const fmtMoney = (n) => `$${(n / 1000).toFixed(0)}k`;

export default function Routes() {
  const [region, setRegion] = useState('All');
  const [selectedId, setSelectedId] = useState('r1');

  const visible = useMemo(
    () => (region === 'All' ? routes : routes.filter((r) => r.region === region)),
    [region]
  );
  const selected = routes.find((r) => r.id === selectedId);
  const alt = selected?.altId ? routes.find((r) => r.id === selected.altId) : null;
  const selectedChoke = (selected?.via || []).map((id) => chokepoints.find((c) => c.id === id)).filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-50">Shipping Routes</h2>
        <p className="text-sm text-gray-400 mt-1">15 active maritime lanes. Risk-graded by chokepoint exposure.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {REGIONS.map((r) => (
          <button
            key={r}
            onClick={() => setRegion(r)}
            className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded border
              ${region === r
                ? 'bg-gray-100 text-gray-950 border-gray-100'
                : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'}`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: route list */}
        <div className="col-span-12 lg:col-span-3 bg-gray-900 border border-gray-800 rounded-lg p-3 max-h-[640px] overflow-y-auto">
          <div className="text-[11px] uppercase tracking-widest text-gray-500 px-2 py-2">
            Routes ({visible.length})
          </div>
          <div className="space-y-1">
            {visible.map((r) => {
              const sel = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-3 py-2 rounded transition-colors border
                    ${sel
                      ? `bg-gray-800 ${riskBorderClass(r.risk)}`
                      : 'border-transparent hover:bg-gray-800/40'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-100">{r.name}</span>
                    <span className={`w-2 h-2 rounded-full ${riskBgClass(r.risk)}`} />
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-0.5">{r.region}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: map */}
        <div className="col-span-12 lg:col-span-6">
          <WorldMap visibleRoutes={visible} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-500 justify-center">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500" /> Critical</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-orange-500" /> High</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-yellow-500" /> Moderate</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-green-500" /> Low</span>
          </div>
        </div>

        {/* Right: detail */}
        <div className="col-span-12 lg:col-span-3 bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          {selected ? (
            <>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-gray-100 leading-snug">{selected.name}</div>
                  <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded ${riskBgClass(selected.risk)} text-gray-950`}>
                    {selected.risk}
                  </span>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">{selected.region}</div>
                <p className="text-xs text-gray-400 mt-2 leading-relaxed">{selected.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Distance" val={`${fmt(selected.distance)} nm`} />
                <Stat label="Transit" val={`${selected.transitDays} days`} />
                <Stat label="Total Cost" val={fmtMoney(selected.cost)} />
                <Stat label="Canal Fee" val={fmtMoney(selected.canalFee)} />
              </div>

              {alt && (
                <div className="border border-gray-800 rounded p-3 bg-gray-950/40">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Alternative</div>
                  <div className="text-xs text-gray-100">{alt.name}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                    <div>
                      <span className="text-gray-500">Δ Cost </span>
                      <span className={`font-mono ${alt.cost > selected.cost ? 'text-red-400' : 'text-green-400'}`}>
                        {alt.cost > selected.cost ? '+' : ''}{fmtMoney(alt.cost - selected.cost)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Δ Days </span>
                      <span className={`font-mono ${alt.transitDays > selected.transitDays ? 'text-red-400' : 'text-green-400'}`}>
                        {alt.transitDays > selected.transitDays ? '+' : ''}{alt.transitDays - selected.transitDays}d
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Chokepoints on Route</div>
                {selectedChoke.length ? (
                  <ul className="space-y-1">
                    {selectedChoke.map((c) => (
                      <li key={c.id} className="text-xs text-gray-200 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        {c.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">Open ocean — no major chokepoints.</div>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-500">Select a route from the list.</div>
          )}
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, val }) => (
  <div className="bg-gray-950/40 border border-gray-800 rounded px-3 py-2">
    <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
    <div className="font-mono text-sm text-gray-100 mt-0.5">{val}</div>
  </div>
);
