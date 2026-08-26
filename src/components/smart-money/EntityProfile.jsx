import React from 'react';

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function sourceLabel(value) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  return hostname === 'sec.gov' || hostname.endsWith('.sec.gov')
    ? 'SEC EDGAR'
    : hostname;
}

export default function EntityProfile({ entity, activities, signals, onClose }) {
  if (!entity) return null;
  const entityActivities = activities
    .filter((row) => row.entityId === entity.id)
    .sort((left, right) => String(right.observedAt).localeCompare(String(left.observedAt)));
  const entitySignals = signals.filter((row) => row.entityId === entity.id);
  return (
    <section aria-labelledby="entity-profile-title" className="rounded-xl border border-cyan-800/40 bg-cyan-950/10 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-cyan-300/80">Research profile</div>
          <h3 id="entity-profile-title" className="mt-1 text-lg font-semibold text-gray-100">{entity.displayName}</h3>
          {(entity.people || []).length > 0 && <p className="mt-1 text-sm text-gray-300">{entity.people.join(', ')}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close profile</button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-400">
        {entity.caveats?.join(' ') || 'Evidence is limited to accepted public sources and does not establish investment performance.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {(entity.officialUrls || []).map((value) => {
          const href = safeHttps(value);
          return href ? (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 hover:underline">
              {sourceLabel(href)}
            </a>
          ) : null;
        })}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Accepted activity</div>
          <div className="mt-1 font-mono text-lg text-gray-100">{entityActivities.length}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Research signals</div>
          <div className="mt-1 font-mono text-lg text-gray-100">{entitySignals.length}</div>
        </div>
      </div>
      <div className="mt-5 border-t border-cyan-900/50 pt-4">
        <h4 className="text-[10px] uppercase tracking-widest text-gray-500">Latest accepted public findings</h4>
        {entityActivities.length ? (
          <ul className="mt-3 space-y-3">
            {entityActivities.slice(0, 5).map((activity) => {
              const href = safeHttps(activity.sourceUrl);
              return (
                <li key={activity.id} className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
                  <p className="text-xs leading-relaxed text-gray-200">{activity.summary}</p>
                  <dl className="mt-2 grid gap-1 text-[10px] text-gray-500 sm:grid-cols-3">
                    <div><dt className="inline text-gray-600">Effective: </dt><dd className="inline">{String(activity.effectiveAt).slice(0, 10)}</dd></div>
                    <div><dt className="inline text-gray-600">Disclosed: </dt><dd className="inline">{activity.disclosedAt ? String(activity.disclosedAt).slice(0, 10) : 'Not separately reported'}</dd></div>
                    <div><dt className="inline text-gray-600">Observed: </dt><dd className="inline">{String(activity.observedAt).slice(0, 10)}</dd></div>
                  </dl>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] text-cyan-300 hover:underline">
                      Open accepted public evidence
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            No material new public activity is present in the accepted snapshot. The source links and provider dates above remain the current evidence boundary.
          </p>
        )}
      </div>
    </section>
  );
}
