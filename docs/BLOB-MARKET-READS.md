# Market snapshot Blob usage

`/api/market/snapshot` reads the Redis provider-cache mirror first. A valid
generation no more than 13 hours old avoids a Blob origin read; this matches the
06:00/18:00 UTC refresh schedule and existing provider cache freshness window.
`providers.blobReadSkipped` explicitly reports that Blob was not probed. It does
not assert Blob health. CoinGecko remains live, and the existing EIA/Alpha Vantage
observation timestamps, stale flags, and live-recovery behavior are unchanged.

Missing, failed, invalid, future-dated, or expired Redis reads fall back to Blob
with origin caching disabled. Stale Redis data can remain last-good data if Blob
is unavailable, with degraded persistence reported and normal row freshness
checks still applied. The maintenance read path continues comparing both stores
and selecting the newest generation. Conditional origin reads and writes used to
prevent older refreshes from overwriting newer ones are unchanged.

This avoids normal visitor-triggered Blob reads while Redis is current. It does
not cap operations during a Redis outage, reset existing Vercel usage, or impose
a limit that could interrupt website access. A successful Blob-only refresh can
remain ahead of the Redis mirror until its 13-hour window expires; cron write
failures remain visible in the protected refresh result.
The browser skips automatic supplemental snapshot reads while hidden, resumes
when visible, and shares concurrent requests. Yahoo price and alert polling stay
active. Failed or expired supplemental rows yield to a current Yahoo baseline,
or remain visibly stale when no baseline exists. A 45-second timeout bounds
shared snapshot requests, including response-body reads, so retries can recover.

Smart Money snapshot and briefing reads also pause while the tab is hidden,
including their daily scheduled refreshes. Returning to the tab fetches the
latest accepted research once even when the browser emits both visibility and
focus events. Manual refresh remains immediate. The full production smoke is
manual-only in GitHub Actions, avoiding daily synthetic visits and forced AI
generations when the dashboard is not being used.

The two authenticated provider refreshes per day remain enabled. They keep EIA
and SEC research current for the next visit; public browser requests cannot
trigger SEC collection or access its server-side contact configuration. This
bounded maintenance still uses Blob operations. No stored data or freshness
validation is removed to save quota.
