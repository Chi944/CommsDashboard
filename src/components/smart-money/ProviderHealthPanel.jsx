import React from 'react';
import { evidenceLinkLabel, publicEvidenceUrl } from '../../lib/publicEvidenceUrl.js';

const tone = {
  live: 'text-emerald-300 border-emerald-700/40 bg-emerald-500/5',
  stale: 'text-amber-300 border-amber-700/40 bg-amber-500/5',
  unavailable: 'text-red-300 border-red-700/40 bg-red-500/5',
};

export default function ProviderHealthPanel({ statuses, sourceLinks }) {
  const links = new Map((sourceLinks || []).map((row) => [row.providerId, row]));
  const live = (statuses || []).filter((row) => row.status === 'live').length;
  return (
    <section aria-labelledby="provider-coverage-title" className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 id="provider-coverage-title" className="text-sm font-semibold text-gray-100">Provider coverage</h3>
        <span className="font-mono text-[10px] text-gray-500">{live}/{statuses?.length || 0} live</span>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {(statuses || []).map((status) => {
          const link = links.get(status.id);
          const destination = publicEvidenceUrl(link?.url);
          return (
            <li key={status.id} className={`min-w-0 rounded-lg border p-3 ${tone[status.status] || tone.unavailable}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-gray-200">{link?.label || status.id}</span>
                <span className="text-[9px] uppercase tracking-widest">{status.status}</span>
              </div>
              <div className="mt-1 text-[10px] text-gray-500">
                {status.recordCount || 0} records · {status.sourceAsOf ? `source ${status.sourceAsOf.slice(0, 10)}` : 'no source date'}
              </div>
              {destination && (
                <a href={destination.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block break-words text-[10px] text-cyan-300 hover:underline">
                  {evidenceLinkLabel(destination, `Open ${link.label || 'source'}`)}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
