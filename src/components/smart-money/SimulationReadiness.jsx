import React from 'react';

const PRIMARY_COPY = 'No rights-cleared free market-price source is currently enabled. Signals remain research-only; no simulated transaction was created.';

export default function SimulationReadiness({ capability }) {
  const researchOnly = capability?.status === 'research_only'
    && capability?.transactionsEnabled === false;
  return (
    <section
      aria-labelledby="simulation-readiness-title"
      className="rounded-xl border border-amber-700/40 bg-amber-950/10 p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/80">Capability status</div>
          <h3 id="simulation-readiness-title" className="mt-1 text-base font-semibold text-gray-100">
            Simulation readiness
          </h3>
        </div>
        <span className="rounded-full border border-amber-600/40 bg-amber-500/10 px-2.5 py-1 text-[10px] uppercase tracking-widest text-amber-300">
          {researchOnly ? 'Research only' : 'Unavailable'}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-gray-200">{PRIMARY_COPY}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 text-xs text-gray-400">
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-gray-200">Entry sources</div>
          <div className="mt-1">None enabled</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-gray-200">Daily mark sources</div>
          <div className="mt-1">None enabled</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
          <div className="text-gray-200">Transactions</div>
          <div className="mt-1">Permanently disabled by this capability</div>
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-gray-500">
        This dashboard does not recommend, prepare, route, sign, or execute trades. Any future simulation capability requires a reviewed rights change and a new server-controlled effective date.
      </p>
    </section>
  );
}

export { PRIMARY_COPY as SIMULATION_READINESS_COPY };
