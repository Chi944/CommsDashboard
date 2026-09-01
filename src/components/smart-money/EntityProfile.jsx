import React, { forwardRef } from 'react';

import { evidenceLinkLabel, publicEvidenceUrl } from '../../lib/publicEvidenceUrl.js';

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
  if (hostname === 'situational-awareness.ai') return 'Situational Awareness: The Decade Ahead';
  if (hostname === 'forourposterity.com') return 'For Our Posterity';
  return hostname === 'sec.gov' || hostname.endsWith('.sec.gov')
    ? 'SEC EDGAR'
    : hostname;
}

function sourceAction(value) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'situational-awareness.ai') return 'Read Situational Awareness: The Decade Ahead';
  if (hostname === 'forourposterity.com') return 'Open For Our Posterity';
  if (hostname === 'sec.gov' || hostname.endsWith('.sec.gov')) return 'Browse SEC EDGAR';
  return `Open ${sourceLabel(value)}`;
}

function officialSourceUrls(entity) {
  const values = [...(entity.officialUrls || [])];
  if (entity.id === 'leopold-aschenbrenner'
      && !values.some((value) => safeHttps(value)?.startsWith('https://situational-awareness.ai/'))) {
    values.unshift('https://situational-awareness.ai/');
  }
  return values;
}

function RelatedProfileCard({ entry, onOpenEntity }) {
  const { entity, filingCount } = entry;
  const monitored = filingCount > 0;
  return (
    <button
      type="button"
      onClick={() => onOpenEntity?.(entity.id)}
      aria-label={`View ${entity.displayName} research profile`}
      className="rounded-lg border border-cyan-800/50 bg-cyan-950/20 p-3 text-left hover:border-cyan-600"
    >
      <span className="block text-xs font-medium text-gray-100">{entity.displayName}</span>
      <span className="mt-1 block text-[10px] text-gray-400">
        {monitored
          ? `${filingCount} accepted public filing${filingCount === 1 ? '' : 's'}`
          : 'Official sources only; no monitored filing feed'}
      </span>
      <span className="mt-2 block text-[10px] text-cyan-300">
        {monitored ? 'View related evidence' : 'Open related profile'} →
      </span>
    </button>
  );
}

const EntityProfile = forwardRef(function EntityProfile({
  entity, entities = [], activities, signals, onClose, onOpenEntity,
}, ref) {
  if (!entity) return null;
  const entityActivities = activities
    .filter((row) => row.entityId === entity.id)
    .sort((left, right) => (
      String(right.disclosedAt || right.effectiveAt || right.observedAt || '').localeCompare(
        String(left.disclosedAt || left.effectiveAt || left.observedAt || ''),
      )
      || String(right.effectiveAt || right.observedAt || '').localeCompare(
        String(left.effectiveAt || left.observedAt || ''),
      )
      || String(right.observedAt || '').localeCompare(String(left.observedAt || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    ));
  const entitySignals = signals.filter((row) => row.entityId === entity.id);
  const coverage = Array.isArray(entity.evidenceCoverage)
    ? entity.evidenceCoverage
    : [entity.evidenceCoverage];
  const sourceOnly = coverage.some((value) => String(value || '').endsWith('-link-only'));
  const relatedEntities = (entity.relatedEntityIds || [])
    .map((id) => entities.find((candidate) => candidate.id === id))
    .filter(Boolean);
  const relatedEntries = relatedEntities.map((related) => ({
    entity: related,
    filingCount: activities.filter((row) => (
      row.entityId === related.id && row.kind === 'filing'
    )).length,
  }));
  const monitoredRelated = relatedEntries.filter((entry) => entry.filingCount > 0);
  const unmonitoredRelated = relatedEntries.filter((entry) => entry.filingCount === 0);
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="entity-profile-title" className="scroll-mt-20 rounded-xl border border-cyan-800/40 bg-cyan-950/10 p-4 outline-none sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-cyan-300/80">Research profile</div>
          <h3 id="entity-profile-title" className="mt-1 text-lg font-semibold text-gray-100">{entity.displayName}</h3>
          {(entity.people || []).length > 0 && <p className="mt-1 text-sm text-gray-300">{entity.people.join(', ')}</p>}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close profile</button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-400">
        {sourceOnly
          ? 'Official-source profile. Automated monitoring is not enabled for these publications. Use the attributed public links and related profiles below; this evidence does not establish investment performance.'
          : (entity.caveats?.join(' ') || 'Evidence is limited to accepted public sources and does not establish investment performance.')}
      </p>
      {(entity.strategyTags || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Research topics">
          {(entity.strategyTags || []).map((tag) => (
            <span key={tag} className="rounded border border-cyan-900/60 bg-cyan-950/20 px-2 py-1 text-[9px] uppercase tracking-wider text-cyan-200/80">
              {tag}
            </span>
          ))}
        </div>
      )}
      {sourceOnly ? (
        <div className="mt-5 space-y-4 border-t border-cyan-900/50 pt-4">
          <div>
            <h4 className="text-[10px] uppercase tracking-widest text-gray-500">Official research sources</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {officialSourceUrls(entity).map((value) => {
                const href = safeHttps(value);
                return href ? (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group rounded-lg border border-gray-800 bg-gray-950/40 p-3 transition-colors hover:border-cyan-700/60"
                  >
                    <span className="block text-xs font-medium text-gray-200">{sourceLabel(href)}</span>
                    <span className="mt-2 block text-[10px] text-cyan-300 group-hover:underline">{sourceAction(href)} ↗</span>
                  </a>
                ) : null;
              })}
            </div>
          </div>
          {monitoredRelated.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-widest text-gray-500">Related firm disclosures</h4>
              {entity.actorType === 'person' && (
                <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                  These are delayed public filings by the related firm, not {entity.displayName}&apos;s personal holdings, trades, or performance.
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {monitoredRelated.map((entry) => (
                  <RelatedProfileCard key={entry.entity.id} entry={entry} onOpenEntity={onOpenEntity} />
                ))}
              </div>
            </div>
          )}
          {unmonitoredRelated.length > 0 && (
            <div>
              <h4 className="text-[10px] uppercase tracking-widest text-gray-500">Related profiles</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {unmonitoredRelated.map((entry) => (
                  <RelatedProfileCard key={entry.entity.id} entry={entry} onOpenEntity={onOpenEntity} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-3">
            {officialSourceUrls(entity).map((value) => {
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
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Public records</div>
              <div className="mt-1 font-mono text-lg text-gray-100">{entityActivities.length}</div>
              <div className="mt-1 text-[10px] text-gray-600">Accepted filings and public observations</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">New material changes</div>
              <div className="mt-1 font-mono text-lg text-gray-100">{entitySignals.length}</div>
              <div className="mt-1 text-[10px] text-gray-600">Detected since the prior accepted snapshot</div>
            </div>
          </div>
          <div className="mt-5 border-t border-cyan-900/50 pt-4">
            <h4 className="text-[10px] uppercase tracking-widest text-gray-500">Latest accepted public findings</h4>
            {entityActivities.length ? (
              <ul className="mt-3 space-y-3">
                {entityActivities.slice(0, 5).map((activity) => {
                  const destination = publicEvidenceUrl(activity.sourceUrl, {
                    sourceStableId: activity.sourceStableId,
                  });
                  return (
                    <li key={activity.id} className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
                      <p className="text-xs leading-relaxed text-gray-200">{activity.summary}</p>
                      <dl className="mt-2 grid gap-1 text-[10px] text-gray-500 sm:grid-cols-3">
                        <div><dt className="inline text-gray-600">Effective: </dt><dd className="inline">{String(activity.effectiveAt).slice(0, 10)}</dd></div>
                        <div><dt className="inline text-gray-600">Disclosed: </dt><dd className="inline">{activity.disclosedAt ? String(activity.disclosedAt).slice(0, 10) : 'Not separately reported'}</dd></div>
                        <div><dt className="inline text-gray-600">Observed: </dt><dd className="inline">{String(activity.observedAt).slice(0, 10)}</dd></div>
                      </dl>
                      {destination && (
                        <a href={destination.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[10px] text-cyan-300 hover:underline">
                          {evidenceLinkLabel(destination, 'Open accepted public evidence')}
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
        </>
      )}
    </section>
  );
});

export default EntityProfile;
