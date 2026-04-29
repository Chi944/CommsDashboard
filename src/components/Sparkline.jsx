import React from 'react';

// Minimal inline SVG sparkline. `data` is an array of numbers.
export default function Sparkline({ data, width = 80, height = 24, color = '#22d3ee', fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y];
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${path} L${width.toFixed(1)},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className="block">
      {fill && <path d={area} fill={color} fillOpacity="0.15" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
