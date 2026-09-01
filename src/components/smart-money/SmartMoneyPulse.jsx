import React, { useMemo } from 'react';

import { evidenceLinkLabel, publicEvidenceUrl } from '../../lib/publicEvidenceUrl.js';
import { useSmartMoney } from '../../state/SmartMoney.jsx';

function fallbackParagraphs(smart) {
  const live = smart.providerStatuses.filter((row) => row.status === 'live').length;
  const latestActivity = [...smart.activities]
    .sort((left, right) => String(right.observedAt).localeCompare(String(left.observedAt)))[0];
  const institutional = smart.entities.filter((row) => row.directoryCategory === 'institutional-flows');
  return [
    {
      id: 'market-regime',
      text: `${live} of ${smart.providerStatuses.length} enabled research providers are currently live. This coverage status is independent of the dashboard's live market-price feed.`,
    },
    {
      id: 'investor-disclosures',
      text: latestActivity
        ? `The latest accepted public activity was observed ${String(latestActivity.observedAt).slice(0, 10)}. Open Smart Money Intelligence for its filing date, effective date, and source evidence.`
        : 'No material new disclosure is present in the accepted snapshot. The directory still shows verified identities and the limits of available performance evidence.',
    },
    {
      id: 'crypto-paper-risk',
      text: `${institutional.length} public institutional crypto-flow subjects are in the research directory. Crypto-whale leaderboards and simulated transactions remain disabled because no rights-cleared free source is enabled.`,
    },
  ];
}

export default function SmartMoneyPulse({ onOpen }) {
  const smart = useSmartMoney();
  const paragraphs = useMemo(() => (
    smart.briefing?.paragraphs?.length === 3
      ? smart.briefing.paragraphs
      : fallbackParagraphs(smart)
  ), [smart]);
  const generated = smart.briefing?.source === 'generated';
  return (
    <section className="overflow-hidden rounded-xl border border-violet-700/30 bg-gradient-to-br from-violet-950/20 via-gray-900/80 to-gray-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 sm:px-5">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-violet-300/80">Smart Money Pulse</div>
          <h3 className="mt-0.5 text-sm font-medium text-gray-100">Daily public-disclosure research</h3>
        </div>
        <button type="button" onClick={onOpen} className="text-[10px] uppercase tracking-widest text-violet-300 hover:text-violet-200">
          Open Intel
        </button>
      </div>
      <div className="grid gap-0 divide-y divide-gray-800 p-4 sm:p-5">
        {paragraphs.map((paragraph, index) => (
          <article key={paragraph.id} className={index === 0 ? 'pb-3' : 'py-3'}>
            <div className="text-[9px] uppercase tracking-[0.18em] text-gray-600">
              {['Coverage', 'Investor disclosures', 'Crypto & simulation limits'][index]}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-300 sm:text-sm">{paragraph.text}</p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 px-4 py-2.5 text-[9px] uppercase tracking-widest text-gray-600 sm:px-5">
        <span>{generated ? 'AI generated from accepted evidence' : 'Deterministic accepted-evidence summary'}</span>
        {(smart.sourceLinks || []).slice(0, 3).map((link) => {
          const destination = publicEvidenceUrl(link.url);
          return destination ? (
            <a key={link.providerId} href={destination.href} target="_blank" rel="noopener noreferrer" className="text-cyan-400/80 hover:underline">
              {evidenceLinkLabel(destination, link.label)}
            </a>
          ) : null;
        })}
      </div>
    </section>
  );
}
