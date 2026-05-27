import React, { useState, useCallback } from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  Tooltip, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { generateMockData, parseCodeburnExport } from '../lib/codeburn.js';

// ---------------------------------------------------------------------------
// StatStrip — 4 metric tiles across the top
// ---------------------------------------------------------------------------
const StatStrip = ({ today, month }) => {
  const tiles = [
    { label: 'Today · Cost',  value: `$${today.cost.toFixed(2)}` },
    { label: 'Today · Calls', value: today.calls.toLocaleString() },
    { label: 'Month · Cost',  value: `$${month.cost.toFixed(2)}` },
    { label: 'Month · Calls', value: month.calls.toLocaleString() },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-gray-800 bg-gray-900/70 px-4 py-3 sm:px-5 sm:py-4">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{t.label}</div>
          <div className="mt-2 font-mono text-2xl sm:text-3xl tracking-tight text-gray-50">{t.value}</div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// DailyTrend — AreaChart, cost per day, last 30 days
// ---------------------------------------------------------------------------
const DailyTrend = ({ data }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5 h-full">
    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-4">Daily cost · last 30 days</div>
    <div className="h-52 sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="tfCostGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 10 }} minTickGap={28} />
          <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={42} />
          <Tooltip
            contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            itemStyle={{ color: '#e5e7eb' }}
            formatter={(v) => [`$${v}`, 'Cost']}
          />
          <Area type="monotone" dataKey="cost" stroke="#3b82f6" strokeWidth={2} fill="url(#tfCostGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// ModelBreakdown — PieChart, spend split by model
// ---------------------------------------------------------------------------
const ModelBreakdown = ({ data }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5 h-full">
    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-4">Spend by model</div>
    <div className="h-52 sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data} dataKey="cost" nameKey="model"
            cx="50%" cy="45%" outerRadius={72} innerRadius={40}
            paddingAngle={3} strokeWidth={0}
          >
            {data.map((d) => <Cell key={d.model} fill={d.color} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
            formatter={(v, name, props) => [`$${v.toFixed(2)} (${props.payload.pct}%)`, name]}
          />
          <Legend
            iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 8 }}
            formatter={(value, entry) => (
              <span style={{ fontSize: 11, color: '#d1d5db' }}>
                {value}{' '}
                <span style={{ color: '#6b7280', fontFamily: 'monospace' }}>
                  {entry.payload.pct}%
                </span>
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// ActivityBreakdown — BarChart, calls per hour 0–23
// ---------------------------------------------------------------------------
const ActivityBreakdown = ({ data }) => (
  <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4 sm:p-5">
    <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-4">Calls by hour · UTC</div>
    <div className="h-40 sm:h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="hour" stroke="#6b7280" tick={{ fontSize: 10 }}
            tickFormatter={(h) => `${h}h`} minTickGap={16}
          />
          <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} width={28} />
          <Tooltip
            contentStyle={{ background: '#0b0f19', border: '1px solid #1f2937', borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v) => [v, 'Calls']}
            labelFormatter={(h) => `${String(h).padStart(2, '0')}:00 UTC`}
          />
          <Bar dataKey="calls" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// FileDropzone — drag-and-drop codeburn export JSON
// ---------------------------------------------------------------------------
const FileDropzone = ({ onLoad, exportDate }) => {
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState(null);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseCodeburnExport(e.target.result);
      if (result) { onLoad(result); setError(null); }
      else setError('Could not parse — expected codeburn JSON export.');
    };
    reader.readAsText(file);
  }, [onLoad]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors
        ${dragging
          ? 'border-blue-500/60 bg-blue-500/5'
          : 'border-gray-700 bg-gray-900/40 hover:border-gray-600'}`}
    >
      {exportDate ? (
        <div className="text-xs font-mono text-amber-400">Viewing export from {exportDate}</div>
      ) : (
        <>
          <div className="text-sm text-gray-400">Drop codeburn export</div>
          <div className="mt-1 text-[11px] text-gray-600">
            Run{' '}
            <code className="font-mono bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">
              codeburn export --json &gt; export.json
            </code>{' '}
            then drop the file here
          </div>
        </>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      <label className="mt-3 inline-block cursor-pointer text-[11px] text-gray-500 hover:text-gray-300 underline">
        or choose file
        <input
          type="file" accept=".json" className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </label>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TokenFlow — main page component
// ---------------------------------------------------------------------------
export default function TokenFlow() {
  const [data, setData] = useState(() => generateMockData());
  const handleLoad = useCallback((d) => setData(d), []);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">
            Token Flow
            {data.source === 'mock' && (
              <span className="ml-2 text-amber-400/70">· demo data</span>
            )}
          </div>
          <h2 className="mt-1.5 text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-br from-gray-50 to-gray-300 bg-clip-text text-transparent">
            Codeburn
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-gray-400 max-w-2xl">
            Token usage flowing through the agent pipeline — cost, call volume, model mix, and hourly activity.
            Drop a codeburn export to replace demo data with live session stats.
          </p>
        </div>
        {data.source === 'file' && data.sourceDate && (
          <div className="self-start px-3 py-1.5 text-xs font-mono rounded-md border bg-amber-500/10 border-amber-500/30 text-amber-300">
            export · {data.sourceDate}
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <StatStrip today={data.today} month={data.month} />

      {/* Charts row: trend + model breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <DailyTrend data={data.dailyData} />
        </div>
        <div className="lg:col-span-2">
          <ModelBreakdown data={data.modelData} />
        </div>
      </div>

      {/* Hourly activity */}
      <ActivityBreakdown data={data.activityData} />

      {/* File drop */}
      <FileDropzone onLoad={handleLoad} exportDate={data.sourceDate} />
    </div>
  );
}
