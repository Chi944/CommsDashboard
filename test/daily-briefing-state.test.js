import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDailyBriefingState,
  dailyBriefingReducer,
  isValidDailyBriefingEnvelope,
} from '../src/lib/dailyBriefingState.js';

function envelope(marketDate, generatedAt, label = marketDate) {
  return {
    ok: true,
    briefing: {
      marketDate,
      generatedAt,
      paragraphs: [
        { id: 'market-tone', text: `${label} tone`, evidenceIds: [] },
        { id: 'themes-catalysts', text: `${label} themes`, evidenceIds: [] },
        { id: 'watchpoints', text: `${label} watchpoints`, evidenceIds: [] },
      ],
      text: `${label} tone\n\n${label} themes\n\n${label} watchpoints`,
    },
  };
}

test('a slower earlier request cannot overwrite the latest accepted response', () => {
  let state = createDailyBriefingState();
  state = dailyBriefingReducer(state, { type: 'request', requestId: 1 });
  state = dailyBriefingReducer(state, { type: 'request', requestId: 2 });
  state = dailyBriefingReducer(state, {
    type: 'success', requestId: 2,
    candidate: envelope('2026-08-27', '2026-08-27T02:00:00.000Z', 'latest'),
  });
  const accepted = state.accepted;
  state = dailyBriefingReducer(state, {
    type: 'success', requestId: 1,
    candidate: envelope('2026-08-27', '2026-08-27T03:00:00.000Z', 'slow'),
  });
  assert.equal(state.accepted, accepted);
  assert.match(state.accepted.briefing.text, /latest/);
});

test('null, malformed, failed, and older responses preserve last-known-good content', () => {
  const current = envelope('2026-08-27', '2026-08-27T02:00:00.000Z', 'current');
  let state = createDailyBriefingState(current);
  for (const [requestId, candidate] of [
    [1, null],
    [2, { ok: true, briefing: null }],
    [3, envelope('2026-08-26', '2026-08-27T23:00:00.000Z', 'older day')],
  ]) {
    state = dailyBriefingReducer(state, { type: 'request', requestId });
    state = dailyBriefingReducer(state, { type: 'success', requestId, candidate });
    assert.equal(state.accepted, current);
  }
  state = dailyBriefingReducer(state, { type: 'request', requestId: 4 });
  state = dailyBriefingReducer(state, { type: 'failure', requestId: 4, error: 'network failed' });
  assert.equal(state.accepted, current);
  assert.equal(state.loading, false);
  assert.equal(state.error, 'network failed');
});

test('newer market dates and then newer same-date generations are accepted monotonically', () => {
  let state = createDailyBriefingState(envelope(
    '2026-08-26', '2026-08-26T23:59:00.000Z', 'day one',
  ));
  state = dailyBriefingReducer(state, { type: 'request', requestId: 1 });
  state = dailyBriefingReducer(state, {
    type: 'success', requestId: 1,
    candidate: envelope('2026-08-27', '2026-08-27T00:01:00.000Z', 'day two'),
  });
  state = dailyBriefingReducer(state, { type: 'request', requestId: 2 });
  state = dailyBriefingReducer(state, {
    type: 'success', requestId: 2,
    candidate: envelope('2026-08-27', '2026-08-27T00:02:00.000Z', 'newer generation'),
  });
  assert.match(state.accepted.briefing.text, /newer generation/);
});

test('envelope validation requires canonical timestamps and three distinct nonempty paragraphs', () => {
  assert.equal(isValidDailyBriefingEnvelope(envelope(
    '2026-08-27', '2026-08-27T00:01:00.000Z',
  )), true);
  assert.equal(isValidDailyBriefingEnvelope({
    briefing: {
      marketDate: '2026-8-27',
      generatedAt: 'not-an-instant',
      paragraphs: [],
    },
  }), false);
  const duplicate = envelope('2026-08-27', '2026-08-27T00:01:00.000Z');
  duplicate.briefing.paragraphs[1].id = duplicate.briefing.paragraphs[0].id;
  assert.equal(isValidDailyBriefingEnvelope(duplicate), false);
});
