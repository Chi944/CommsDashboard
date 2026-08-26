import React, { useEffect, useMemo, useState } from 'react';

import { useSmartMoney } from '../../state/SmartMoney.jsx';
import EntityDirectory from './EntityDirectory.jsx';
import EntityProfile from './EntityProfile.jsx';
import ProviderHealthPanel from './ProviderHealthPanel.jsx';
import SimulationReadiness from './SimulationReadiness.jsx';

export default function SmartMoneyView({ recordId = null, onRecordChange }) {
  const smart = useSmartMoney();
  const [localRecordId, setLocalRecordId] = useState(recordId);
  useEffect(() => { setLocalRecordId(recordId); }, [recordId]);
  const selected = useMemo(
    () => smart.entities.find((entity) => entity.id === localRecordId) || null,
    [localRecordId, smart.entities],
  );
  const openRecord = (id) => {
    setLocalRecordId(id);
    onRecordChange?.(id);
  };
  const closeRecord = () => {
    setLocalRecordId(null);
    onRecordChange?.(null);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-100 sm:text-3xl">Smart Money Intelligence</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-400 sm:text-sm">
            Research intelligence only: public filings, disclosed institutional flows, and source-scoped evidence. Rankings never imply that unlike providers or time windows are comparable.
          </p>
        </div>
        <button
          type="button"
          onClick={smart.refreshSmartMoney}
          disabled={smart.loading || smart.briefingLoading}
          className="self-start rounded-md border border-gray-800 bg-gray-900 px-3 py-1.5 text-[10px] uppercase tracking-widest text-gray-300 hover:border-gray-600 disabled:opacity-50"
        >
          {smart.loading || smart.briefingLoading ? 'Refreshing…' : 'Refresh research'}
        </button>
      </div>

      {smart.error && (
        <div role="status" className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3 text-xs text-amber-200">
          Latest refresh degraded: {smart.error}. Last accepted research remains visible.
        </div>
      )}

      {selected && (
        <EntityProfile
          entity={selected}
          activities={smart.activities}
          signals={smart.signals}
          onClose={closeRecord}
        />
      )}

      <ProviderHealthPanel statuses={smart.providerStatuses} sourceLinks={smart.sourceLinks} />

      <EntityDirectory
        entities={smart.entities}
        followedEntityIds={smart.followedEntityIds}
        onFollow={smart.followEntity}
        onUnfollow={smart.unfollowEntity}
        onOpen={openRecord}
      />

      <SimulationReadiness capability={smart.simulationCapability} />
    </div>
  );
}
