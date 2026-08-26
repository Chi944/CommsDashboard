import React, { useMemo, useState } from 'react';

const categoryLabel = {
  investors: 'Investors',
  firms: 'Firms',
  'institutional-flows': 'Institutional crypto flows',
  'crypto-traders': 'Crypto accounts',
};

function verificationLabel(entity) {
  const status = entity.performanceVerification?.status;
  if (status === 'official_reported') return 'Officially reported performance';
  if (status === 'provider_reported') return 'Provider-reported performance';
  return 'Performance not publicly verified';
}

export default function EntityDirectory({
  entities, followedEntityIds, onFollow, onUnfollow, onOpen,
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle ? entities.filter((entity) => [
      entity.displayName,
      entity.legalEntity,
      ...(entity.people || []),
      ...(entity.strategyTags || []),
    ].some((value) => String(value || '').toLowerCase().includes(needle))) : entities;
    const followed = new Set(followedEntityIds);
    return [...rows].sort((left, right) => (
      Number(followed.has(right.id)) - Number(followed.has(left.id))
      || left.displayName.localeCompare(right.displayName)
    ));
  }, [entities, followedEntityIds, query]);

  const grouped = filtered.reduce((result, entity) => {
    const category = entity.directoryCategory;
    if (!result[category]) result[category] = [];
    result[category].push(entity);
    return result;
  }, {});
  const hasCryptoAccounts = Boolean(grouped['crypto-traders']?.length);

  return (
    <section aria-labelledby="entity-directory-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="entity-directory-title" className="text-base font-semibold text-gray-100">People, firms, and public flows</h3>
          <p className="mt-1 text-xs text-gray-500">Follow research subjects locally; following never creates a trade or allocation.</p>
        </div>
        <label className="text-[10px] uppercase tracking-widest text-gray-500">
          Search directory
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm normal-case tracking-normal text-gray-100 sm:w-64"
            placeholder="Leopold, AI, ETF…"
          />
        </label>
      </div>
      {Object.entries(grouped).map(([category, rows]) => (
        <div key={category}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
            {categoryLabel[category] || category}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((entity) => {
              const followed = followedEntityIds.includes(entity.id);
              return (
                <article key={entity.id} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                  <button
                    type="button"
                    onClick={() => onOpen(entity.id)}
                    aria-label={`Open ${entity.displayName} research profile`}
                    className="block w-full text-left"
                  >
                    <div className="text-sm font-semibold text-gray-100">{entity.displayName}</div>
                    {(entity.people || []).map((person) => (
                      <div key={person} className="mt-1 text-xs text-cyan-300">{person}</div>
                    ))}
                    <div className="mt-2 text-[11px] text-gray-500">{verificationLabel(entity)}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(entity.strategyTags || []).slice(0, 4).map((tag) => (
                        <span key={tag} className="rounded border border-gray-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-gray-400">{tag}</span>
                      ))}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => (followed ? onUnfollow(entity.id) : onFollow(entity.id))}
                    aria-label={`${followed ? 'Unfollow' : 'Follow'} ${entity.displayName}`}
                    className="mt-4 text-[10px] uppercase tracking-widest text-cyan-300 hover:text-cyan-200"
                  >
                    {followed ? 'Following · unfollow' : 'Follow research'}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      ))}
      {!hasCryptoAccounts && (
        <div className="rounded-lg border border-violet-800/40 bg-violet-950/10 p-4 text-xs leading-relaxed text-gray-400">
          <span className="font-medium text-violet-200">Crypto whale coverage:</span>{' '}
          No rights-cleared free crypto-whale leaderboard is enabled. Public SEC filings for corporate treasuries and spot-Bitcoin funds remain visible as institutional-flow evidence, without describing them as verified profitable whales.
        </div>
      )}
    </section>
  );
}
