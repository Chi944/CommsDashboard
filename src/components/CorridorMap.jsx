import React, { useState } from 'react';
import { corridorData, STATUS_META } from '../data/corridorData.js';

// ---------------------------------------------------------------------------
// Simplified world map SVG — equirectangular projection, viewBox 0 0 800 400
// x = (lon + 180) * 800/360   y = (90 - lat) * 400/180
// Continent polygons are schematic approximations for dashboard use.
// ---------------------------------------------------------------------------
const LAND_PATHS = [
  // North America (incl. Central America isthmus)
  'M 40,68 L 90,44 L 212,15 L 280,84 L 225,145 L 215,156 L 226,182 L 213,179 L 156,150 L 125,93 Z',
  // South America
  'M 213,178 L 262,175 L 323,213 L 288,268 L 271,285 L 247,323 L 236,286 L 212,261 L 228,202 Z',
  // Greenland
  'M 222,10 L 295,8 L 292,46 L 248,52 Z',
  // Europe (West + North + Scandinavia stub)
  'M 381,116 L 390,72 L 406,62 L 412,70 L 397,80 L 413,48 L 462,43 L 470,44 L 491,101 L 461,121 L 436,121 L 388,122 Z',
  // Africa
  'M 362,143 L 430,127 L 472,134 L 514,176 L 480,258 L 440,279 L 427,262 L 362,196 Z',
  // Asia (mainland — wraps from Turkey/Caucasus to SE Asia tip)
  'M 489,101 L 511,104 L 534,38 L 782,38 L 724,112 L 664,199 L 630,197 L 580,184 L 570,183 L 548,145 L 502,128 L 472,134 L 461,121 L 491,101 Z',
  // Australia
  'M 655,274 L 693,226 L 724,222 L 743,261 L 724,287 L 710,280 Z',
  // Japan
  'M 722,110 L 729,130 L 718,141 L 710,129 Z',
  // UK / Ireland stub
  'M 383,75 L 390,70 L 394,80 L 385,84 Z',
];

// Dot radius for corridor markers
const DOT_R = 5;
const PULSE_R = 9;

function CorridorDot({ c, meta, selected, onClick }) {
  const isDisrupted = c.status === 'DISRUPTED';
  const color = c.status === 'OPEN' ? '#22c55e' : '#f59e0b';
  return (
    <g
      onClick={() => onClick(c.id)}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={c.name}
    >
      {/* Pulse ring for non-open corridors */}
      {c.status !== 'OPEN' && (
        <circle cx={c.coords.x} cy={c.coords.y} r={PULSE_R} fill={color} opacity={0.18}>
          <animate attributeName="r" values={`${DOT_R};${PULSE_R + 3};${DOT_R}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.18;0.05;0.18" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Selection ring */}
      {selected && (
        <circle cx={c.coords.x} cy={c.coords.y} r={DOT_R + 4} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
      )}
      {/* Main dot */}
      <circle cx={c.coords.x} cy={c.coords.y} r={DOT_R} fill={color} />
    </g>
  );
}

export default function CorridorMap() {
  const [selected, setSelected] = useState(null);

  const handleClick = (id) => setSelected((prev) => (prev === id ? null : id));

  const activeCorridor = corridorData.find((c) => c.id === selected);
  const activeMeta     = activeCorridor ? STATUS_META[activeCorridor.status] : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Strategic Sea Lanes</div>
          <h3 className="mt-0.5 text-sm font-semibold text-gray-100">Shipping Corridors</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> Open
          </span>
          <span className="flex items-center gap-1.5 text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Disrupted / Monitored
          </span>
        </div>
      </div>

      {/* SVG World Map */}
      <div className="relative rounded-lg overflow-hidden border border-gray-800/60">
        <svg
          viewBox="0 0 800 400"
          className="w-full block"
          style={{ background: '#060f1e' }}
          aria-label="World map showing shipping corridor locations"
        >
          {/* Ocean base */}
          <rect width="800" height="400" fill="#060f1e" />

          {/* Continent land masses */}
          {LAND_PATHS.map((d, i) => (
            <path key={i} d={d} fill="#162032" stroke="#1e3a5f" strokeWidth={0.7} />
          ))}

          {/* Equator guide line */}
          <line x1="0" y1="200" x2="800" y2="200" stroke="#1e3a5f" strokeWidth={0.5} strokeDasharray="4 6" />

          {/* Corridor route arcs (schematic: connect Suez→Malacca, Panama→Malacca) */}
          {/* Red Sea / Indian Ocean route */}
          <path d="M 472,133 Q 560,220 629,196" fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
          {/* Pacific / Panama–Asia route */}
          <path d="M 223,180 Q 120,200 50,200 Q 20,200 10,190 Q 0,180 800,180 Q 750,180 720,160 Q 690,145 655,173" fill="none" stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />

          {/* Corridor markers */}
          {corridorData.map((c) => (
            <CorridorDot
              key={c.id}
              c={c}
              meta={STATUS_META[c.status]}
              selected={selected === c.id}
              onClick={handleClick}
            />
          ))}
        </svg>
      </div>

      {/* Corridor list + disruption card */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {corridorData.map((c) => {
          const meta = STATUS_META[c.status];
          const isSel = selected === c.id;
          return (
            <button
              key={c.id}
              onClick={() => handleClick(c.id)}
              className={`text-left px-3 py-2.5 rounded-lg border transition-all
                ${isSel
                  ? `${meta.border} bg-gray-800/60`
                  : 'border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-800/30'}`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                <span className={`text-[10px] uppercase tracking-wider font-mono ${meta.text}`}>
                  {meta.label}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-300 leading-tight">{c.name}</div>
            </button>
          );
        })}
      </div>

      {/* Disruption note card (shown on click) */}
      {activeCorridor && activeMeta && (
        <div className={`rounded-lg border px-4 py-3 space-y-1 ${activeMeta.border} bg-gray-900/60`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${activeMeta.dot}`} />
              <span className={`text-[10px] uppercase tracking-wider font-mono ${activeMeta.text}`}>
                {activeMeta.label}
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">· {activeCorridor.region}</span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-600 hover:text-gray-300 text-sm leading-none"
              aria-label="close"
            >×</button>
          </div>
          <div className="text-sm font-semibold text-gray-100">{activeCorridor.name}</div>
          <p className="text-xs text-gray-400 leading-relaxed">{activeCorridor.note}</p>
        </div>
      )}
    </div>
  );
}
