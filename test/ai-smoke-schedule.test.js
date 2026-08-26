import assert from 'node:assert/strict';
import test from 'node:test';

test('forced AI smoke places every Groq generation in its own 65-second quota window', async () => {
  const { AI_SMOKE_WINDOW_GAP_MS, runForcedAiSmokeRequests } = await import(
    '../lib/ai/smoke-schedule.js'
  );
  let now = 0;
  const calls = [];
  const waits = [];
  const request = (name) => async () => {
    calls.push({ name, at: now });
    return { name };
  };

  const result = await runForcedAiSmokeRequests({
    requestBriefing: request('market-briefing'),
    requestAnalysis: request('analysis'),
    requestSmartMoneyBriefing: request('smart-money-briefing'),
    requestSmartMoneyHealth: request('smart-money-health'),
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  assert.equal(AI_SMOKE_WINDOW_GAP_MS, 65_000);
  assert.deepEqual(waits, [65_000, 65_000]);
  assert.deepEqual(calls, [
    { name: 'market-briefing', at: 0 },
    { name: 'smart-money-health', at: 0 },
    { name: 'analysis', at: 65_000 },
    { name: 'smart-money-briefing', at: 130_000 },
  ]);
  assert.deepEqual(result, {
    briefing: { name: 'market-briefing' },
    analysis: { name: 'analysis' },
    smartMoneyBriefing: { name: 'smart-money-briefing' },
    smartMoneyHealth: { name: 'smart-money-health' },
  });
});
