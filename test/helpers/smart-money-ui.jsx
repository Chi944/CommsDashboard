import React from 'react';

import { useSmartMoney } from '../../src/state/SmartMoney.jsx';

export function SmartMoneyProbe() {
  const value = useSmartMoney();
  return (
    <>
      <output data-testid="entity-count">{value.entities.length}</output>
      <output data-testid="performance-count">{value.performances.length}</output>
      <output data-testid="smart-error">{value.error || ''}</output>
      <output data-testid="briefing-date">{value.briefing?.marketDate || ''}</output>
      <output data-testid="briefing-first-id">{value.briefing?.paragraphs?.[0]?.id || ''}</output>
      <output data-testid="simulation-status">{value.simulationCapability.status}</output>
      <button type="button" onClick={value.refreshSmartMoney}>Refresh Smart Money</button>
      <button type="button" onClick={value.refreshBriefing}>Refresh Smart Money briefing</button>
    </>
  );
}
