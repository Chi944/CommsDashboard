// Data loading helpers for codeburn token usage stats.
// generateMockData() returns realistic demo data when no real export is available.
// parseCodeburnExport() parses a JSON file dropped via FileDropzone.

function deterministicRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

export function generateMockData() {
  const rand = deterministicRand(20260528);
  const today = new Date('2026-05-28');

  const dailyData = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const base = isWeekend ? 0.8 : 4.5;
    const cost = parseFloat((rand() * base + 0.3).toFixed(2));
    const calls = Math.max(1, Math.floor(rand() * (isWeekend ? 30 : 120) + 5));
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      cost,
      calls,
    };
  });

  const todayEntry = dailyData[dailyData.length - 1];
  const monthCost   = parseFloat(dailyData.reduce((s, d) => s + d.cost,  0).toFixed(2));
  const monthCalls  = dailyData.reduce((s, d) => s + d.calls, 0);

  // Calls per hour — peaks during work hours
  const activityData = Array.from({ length: 24 }, (_, h) => {
    let base = 2;
    if (h >= 8  && h <= 11) base = 60;
    if (h >= 12 && h <= 14) base = 45;
    if (h >= 15 && h <= 18) base = 70;
    if (h >= 19 && h <= 21) base = 25;
    return { hour: h, calls: Math.max(0, Math.floor(rand() * base)) };
  });

  const totalCost = monthCost || 1;
  const modelData = [
    { model: 'Sonnet', cost: parseFloat((totalCost * 0.65).toFixed(2)), pct: 65, color: '#22d3ee' },
    { model: 'Opus',   cost: parseFloat((totalCost * 0.25).toFixed(2)), pct: 25, color: '#a78bfa' },
    { model: 'Haiku',  cost: parseFloat((totalCost * 0.10).toFixed(2)), pct: 10, color: '#34d399' },
  ];

  return {
    today:       { cost: todayEntry.cost, calls: todayEntry.calls },
    month:       { cost: monthCost, calls: monthCalls },
    dailyData,
    activityData,
    modelData,
    source:      'mock',
    sourceDate:  null,
  };
}

export function parseCodeburnExport(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const sessions = data.sessions || data.data || data.entries || [];

    // Group by calendar date
    const byDate = {};
    for (const s of sessions) {
      const dateStr = (s.date || s.timestamp || '').split('T')[0];
      if (!dateStr) continue;
      if (!byDate[dateStr]) byDate[dateStr] = { cost: 0, calls: 0, sessions: [] };
      byDate[dateStr].cost  += s.cost       || s.usd     || 0;
      byDate[dateStr].calls += s.calls      || s.count   || 0;
      byDate[dateStr].sessions.push(s);
    }

    const sortedDates = Object.keys(byDate).sort();
    const last30 = sortedDates.slice(-30);

    const dailyData = last30.map((date) => ({
      date:  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      cost:  parseFloat(byDate[date].cost.toFixed(2)),
      calls: byDate[date].calls,
    }));

    const todayKey = new Date().toISOString().split('T')[0];
    const todayBucket = byDate[todayKey] || { cost: 0, calls: 0 };

    const monthCost  = Object.values(byDate).reduce((s, d) => s + d.cost,  0);
    const monthCalls = Object.values(byDate).reduce((s, d) => s + d.calls, 0);

    // Model breakdown
    const modelTotals = {};
    for (const s of sessions) {
      const m = (s.model || '').toLowerCase();
      const label = m.includes('opus') ? 'Opus' : m.includes('haiku') ? 'Haiku' : 'Sonnet';
      modelTotals[label] = (modelTotals[label] || 0) + (s.cost || s.usd || 0);
    }
    const modelColors = { Sonnet: '#22d3ee', Opus: '#a78bfa', Haiku: '#34d399' };
    const totalModel  = Object.values(modelTotals).reduce((s, v) => s + v, 0) || 1;
    const modelData = Object.entries(modelTotals).map(([model, cost]) => ({
      model,
      cost: parseFloat(cost.toFixed(2)),
      pct:  parseFloat(((cost / totalModel) * 100).toFixed(1)),
      color: modelColors[model] || '#6b7280',
    }));

    // Calls per hour
    const byHour = Array(24).fill(0);
    for (const s of sessions) {
      const h = new Date(s.date || s.timestamp).getHours();
      if (!isNaN(h)) byHour[h] += s.calls || s.count || 1;
    }
    const activityData = byHour.map((calls, hour) => ({ hour, calls }));

    return {
      today:       { cost: parseFloat(todayBucket.cost.toFixed(2)), calls: todayBucket.calls },
      month:       { cost: parseFloat(monthCost.toFixed(2)), calls: monthCalls },
      dailyData,
      activityData,
      modelData,
      source:      'file',
      sourceDate:  sortedDates[sortedDates.length - 1] || null,
    };
  } catch {
    return null;
  }
}
