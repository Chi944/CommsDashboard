export const AI_SMOKE_WINDOW_GAP_MS = 65_000;

const defaultWait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function runForcedAiSmokeRequests({
  requestBriefing,
  requestAnalysis,
  requestSmartMoneyBriefing,
  requestSmartMoneyHealth,
  wait = defaultWait,
  windowGapMs = AI_SMOKE_WINDOW_GAP_MS,
}) {
  const [briefing, smartMoneyHealth] = await Promise.all([
    requestBriefing(),
    requestSmartMoneyHealth(),
  ]);
  await wait(windowGapMs);
  const analysis = await requestAnalysis();
  await wait(windowGapMs);
  const smartMoneyBriefing = await requestSmartMoneyBriefing();
  return { briefing, analysis, smartMoneyBriefing, smartMoneyHealth };
}
