import React from 'react';
import {
  ports, chokepoints, routes, riskStrokeHex,
} from '../data/mockData.js';

// Equirectangular projection. viewBox is 1000 x 500.
const W = 1000;
const H = 500;
const proj = (lat, lon) => ({
  x: ((lon + 180) / 360) * W,
  y: ((90 - lat) / 180) * H,
});

// Hand-drawn simplified continent outlines as [lon, lat] polygons.
const NORTH_AMERICA = [
  [-168, 66], [-156, 71], [-140, 70], [-125, 70], [-110, 73], [-95, 77], [-80, 75],
  [-65, 60], [-55, 52], [-65, 45], [-70, 42], [-77, 35], [-82, 26], [-90, 29],
  [-97, 26], [-105, 22], [-115, 30], [-125, 40], [-130, 55], [-150, 60], [-165, 60],
];
const SOUTH_AMERICA = [
  [-80, 11], [-70, 12], [-60, 8], [-50, 0], [-43, -5], [-35, -8], [-38, -22],
  [-43, -25], [-55, -34], [-58, -40], [-65, -52], [-73, -55], [-72, -45],
  [-72, -30], [-78, -18], [-80, -5],
];
const EUROPE = [
  [-10, 36], [-5, 43], [3, 43], [5, 50], [-2, 55], [5, 60], [12, 65], [25, 70],
  [40, 67], [40, 55], [35, 47], [28, 41], [20, 40], [15, 38], [10, 37], [0, 38],
];
const AFRICA = [
  [-17, 21], [-15, 14], [-10, 6], [0, 4], [10, 4], [15, -5], [12, -15], [18, -23],
  [20, -34], [25, -34], [33, -28], [40, -15], [45, -12], [51, 0], [50, 11],
  [42, 12], [37, 21], [33, 31], [25, 32], [10, 32], [0, 32], [-10, 27],
];
const ASIA = [
  [40, 67], [60, 70], [80, 73], [105, 78], [130, 71], [155, 70], [170, 65],
  [165, 60], [150, 55], [140, 45], [135, 35], [122, 30], [115, 22], [108, 14],
  [100, 5], [95, 16], [88, 22], [76, 8], [68, 23], [60, 25], [55, 27], [48, 30],
  [42, 38], [40, 50],
];
const AUSTRALIA = [
  [113, -22], [122, -18], [135, -12], [142, -10], [148, -20], [153, -28],
  [149, -37], [140, -38], [128, -32], [115, -34], [113, -28],
];

const toPath = (pts) =>
  pts.map(([lon, lat], i) => {
    const { x, y } = proj(lat, lon);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ') + ' Z';

const continents = [NORTH_AMERICA, SOUTH_AMERICA, EUROPE, AFRICA, ASIA, AUSTRALIA].map(toPath);

const routeNodes = (route) => {
  const o = ports[route.origin];
  const d = ports[route.dest];
  const v = (route.via || []).map((id) => chokepoints.find((c) => c.id === id)).filter(Boolean);
  return [o, ...v, d];
};

// Build a smooth path via quadratic curves between successive nodes.
// Latitude bias to make curves arch slightly.
const buildRoutePath = (nodes) => {
  if (nodes.length < 2) return '';
  const pts = nodes.map((n) => proj(n.lat, n.lon));
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2 - Math.abs(p1.x - p0.x) * 0.12;
    d += ` Q${mx.toFixed(1)},${my.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
};

export default function WorldMap({ visibleRoutes, selectedId, onSelect }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-gray-950 rounded-lg border border-gray-800">
      {/* Ocean background grid */}
      <defs>
        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#0f172a" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#020617" />
      <rect width={W} height={H} fill="url(#grid)" />

      {/* Continents */}
      {continents.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="#1f2937"
          stroke="#374151"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      ))}

      {/* Routes */}
      {visibleRoutes.map((r) => {
        const nodes = routeNodes(r);
        const d = buildRoutePath(nodes);
        const active = r.id === selectedId;
        return (
          <path
            key={r.id}
            d={d}
            fill="none"
            stroke={riskStrokeHex(r.risk)}
            strokeWidth={active ? 3 : 1.5}
            strokeOpacity={active ? 1 : 0.55}
            strokeDasharray={active ? '0' : '4 3'}
            strokeLinecap="round"
            className="cursor-pointer transition-all"
            onClick={() => onSelect(r.id)}
          />
        );
      })}

      {/* Chokepoints */}
      {chokepoints.map((c) => {
        const { x, y } = proj(c.lat, c.lon);
        return (
          <g key={c.id}>
            <circle cx={x} cy={y} r="4" fill="#f97316" stroke="#fff7ed" strokeWidth="1" />
            <text x={x + 7} y={y + 3} fontSize="9" fill="#fdba74" fontFamily="ui-monospace, monospace">
              {c.name}
            </text>
          </g>
        );
      })}

      {/* Ports */}
      {Object.entries(ports).map(([name, p]) => {
        const { x, y } = proj(p.lat, p.lon);
        return (
          <g key={name}>
            <circle cx={x} cy={y} r="2.5" fill="#22d3ee" />
            <text x={x + 5} y={y - 3} fontSize="8" fill="#67e8f9" fontFamily="ui-monospace, monospace">
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
