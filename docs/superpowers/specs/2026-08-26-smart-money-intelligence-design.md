# Smart Money Intelligence and Paper Simulation

Status: Approved in chat on 2026-08-26; awaiting written-spec review

## Summary

CommsDashboard will gain an evidence-first Smart Money subsystem that follows
publicly disclosed investors and firms, screens crypto accounts using positive
venue-reported performance, and lets users paper-simulate qualifying signals.
The dashboard will never hold trading credentials, construct orders, or execute
trades.

The feature uses a hub-and-spoke layout:

- Intel is the source-of-truth Smart Money hub.
- Overview shows a daily Smart Money Pulse and recent high-confidence signals.
- Portfolio owns local paper simulations and hypothetical performance.
- Prices remains the chart destination for supported assets.
- Notifications can report new evidence and signals but cannot initiate trades.

Only free, public sources are in scope for the initial release. Paid or
redistribution-restricted data providers are excluded.

## Goals

1. Track investors, firms, institutional crypto disclosures, and observed
   profitable crypto traders using auditable sources.
2. Separate facts, provider-reported metrics, and inference in both the data
   contract and interface.
3. Produce three current, evidence-grounded Smart Money paragraphs every UTC
   day, including current market and sentiment context.
4. Provide optional paper-copy simulations that begin only after a signal is
   observed.
5. Keep provider failures isolated from prices, news, the existing market
   briefing, and other dashboard health indicators.
6. Verify every configured provider with automated contract tests and
   production smoke checks before declaring the feature complete.

## Non-goals

- Placing, preparing, routing, or recommending real orders.
- Connecting wallets, exchanges, brokers, or custody accounts.
- Collecting API keys for trading venues from dashboard users.
- Presenting a transfer, wallet balance, reputation, assets under management, or
  a delayed filing as proof of investing success.
- Inferring a real person's identity from an anonymous address.
- Reproducing complete copyrighted investor letters or research documents.
- Publishing data from a provider whose terms prohibit redistribution.
- Claiming that paper results reproduce a manager's or trader's actual returns.

## Product language

The interface uses Investor Intelligence, Institutional Flows, Observed Top
Traders, Signals, and Paper Copy. It avoids Copy Now, Guaranteed, Best Investor,
or similar endorsement language.

Persistent disclosures state:

- Reported public disclosures are not live positions or investment advice.
- On-chain transfers are not necessarily trades.
- Provider-reported P&L is scoped to that venue or wallet and may be incomplete.
- Paper Copy is a simulation. No orders are placed.

## User experience

### Overview

The existing Market Briefing remains intact. A Smart Money Pulse appears below
it and contains exactly three daily paragraphs:

1. Current market regime and validated sentiment context.
2. New investor filings, writings, fund disclosures, or an explicit statement
   that no material new disclosure was found.
3. Crypto-leader changes, qualifying signals, and paper-strategy risk context.

Every paragraph maps to visible evidence links and source dates. The title,
generated time, market date, evidence age, and provider coverage are shown.
Refreshing is quota-protected and cannot cause older cached content to replace a
newer accepted market date.

A compact signal preview links to the relevant Smart Money record or Prices
chart.

### Intel

Intel gains a shareable segmented view:

- News Feed
- Smart Money

The selected view is represented in the URL as tab=Intel and
view=smart-money. The Smart Money view includes:

- Filters: All, Investors, Firms, Crypto Traders, Institutional Flows.
- Entity directory with follow and unfollow controls.
- Evidence timeline for filings, official statements, holding changes,
  positions, rank changes, and transfers.
- Profiles with strategy themes, legal entity, people, official sources,
  verification status, performance status, last checked time, and caveats.
- Signals table with asset, direction, magnitude, effective time, disclosed or
  observed time, delay, provider, identity status, and source link.
- Provider-health panel showing LIVE, STALE, or UNAVAILABLE per source.

Leopold Aschenbrenner and Situational Awareness LP are represented as a public
disclosure and thesis watchlist. Performance is shown as not publicly verified
unless a primary source later provides an auditable result.

### Portfolio

Portfolio gains Holdings and Paper Copy views. Existing user holdings continue
to work unchanged.

Paper Copy is opt-in and local to the browser. Its default virtual starting
balance is USD 100,000 and can be changed or reset. No historical trades are
backfilled when a user starts following an entity.

The view shows:

- Virtual equity, cash, gross exposure, return, and maximum drawdown.
- Open simulated positions and complete simulated transaction history.
- Win rate for closed simulations.
- S&P 500 comparison for equity strategies, Bitcoin comparison for crypto
  strategies, and both for mixed simulations.
- Entry source, observation time, market-price timestamp, simulated friction,
  and reason for every transaction.

### Notifications

The existing drawer gains a Smart Money group. In-app alerts are generated for
high-confidence qualifying signals. Browser notifications are optional and only
generated for entities the user follows.

Allowed actions are View evidence, Open chart, and Add to paper simulation.
There are no broker or exchange actions.

## Architecture

### Client boundary

A dedicated SmartMoneyProvider is mounted separately from LiveDataProvider.
This prevents slow-moving filings and external leaderboard failures from
rerendering or degrading the live market-data subsystem.

SmartMoneyProvider owns:

- Smart Money API state and independent refresh timing.
- Provider-health and freshness metadata.
- Followed entities and paper-simulation preferences stored in localStorage.
- Deduplicated in-app signal notifications.

LiveDataProvider continues to own trusted dashboard prices, market sentiment,
existing news, watchlists, alerts, and manually entered holdings. Smart Money
uses those public interfaces for market context and simulation marks but does
not modify their health status.

### Server boundary

The server is split into small adapters and normalization modules:

- lib/smart-money/entities.js: curated entity registry and official sources.
- lib/smart-money/sec.js: EDGAR client and filing normalization.
- lib/smart-money/publications.js: allowlisted official-feed and publication
  metadata ingestion.
- lib/smart-money/polymarket.js: crypto leaderboard and account records.
- lib/smart-money/hyperliquid.js: leaderboard, portfolio, position, and P&L
  records.
- lib/smart-money/disclosures.js: official treasury and ETF disclosures.
- lib/smart-money/normalize.js: schema validation, timestamps, provenance,
  deduplication, and freshness.
- lib/smart-money/rank.js: source-scoped eligibility and ordering.
- lib/smart-money/store.js: durable snapshots and last-known-good records using
  the project's existing Redis and Blob patterns.
- lib/smart-money/journal.js: immutable qualifying signals, contemporaneous
  trusted reference prices, and daily benchmark and asset marks.
- lib/smart-money/paper.js: pure simulation calculations shared by tests and
  the browser.

RSS or feed parsing shared with the news APIs is extracted into one library
rather than duplicated.

### Routes

All user-facing production routes are read-only with respect to user and domain
state. They may revalidate shared response caches:

- GET /api/smart-money: normalized entities, activity, signals, rankings,
  warnings, and provider coverage.
- GET /api/smart-money/history: bounded signal and reference-price history used
  to reconcile browser-local paper simulations.
- GET /api/smart-money/health: provider status, last success, source as-of time,
  cache age, and sanitized failure code.
- GET /api/smart-money/briefing: daily evidence-grounded Smart Money Pulse.
- GET /api/smart-money/refresh: internal cache-maintenance endpoint.

No route accepts an order, wallet signature, broker token, exchange key,
deposit, withdrawal, or target allocation for execution.

The internal refresh route requires an Authorization: Bearer CRON_SECRET header,
writes only validated provider snapshots and cache metadata, and is never called
by a browser control. A browser refresh rereads or safely revalidates accepted
public data; it does not call the maintenance route or mutate user portfolios or
paper simulations.

## Sources

### Investors and firms

The initial roster is:

- Leopold Aschenbrenner / Situational Awareness LP.
- Berkshire Hathaway / Warren Buffett.
- Pershing Square / Bill Ackman.
- Fundsmith / Terry Smith.
- Oaktree Capital / Howard Marks.
- ARK Invest / Cathie Wood.

Authoritative evidence is limited to SEC EDGAR, adviser records, official firm
sites, official fund factsheets, official letters and memos, and clearly
attributed official publications. Holdings are attributed to the legal reporting
entity, not automatically to a named person.

Form 13F records are labeled with their period end, filing date, and filing lag.
They are never presented as live portfolios. Schedule 13D and 13G records remain
separate because their timing and purpose differ.

Performance appears only when an official fund factsheet, official NAV series,
or audited report identifies the exact vehicle, share class, currency, period,
and return basis.

### Crypto traders

Polymarket's public Data API supplies crypto-category account aliases, wallet
identifiers, P&L, volume, verification flags, positions, and closed positions.
It is used for observed trader research and source-scoped rankings. Prediction
market positions are not paper-copied in the first release because they do not
map to the dashboard's trusted spot-price catalogue.

Hyperliquid's public leaderboard and Info API supply venue accounts, account
value, windowed P&L and ROI, volume, positions, and fills. Qualifying position
changes in supported assets can feed paper simulations.

Anonymous accounts remain anonymous. The dashboard shows a public alias when
provided and otherwise a shortened address. It does not speculate about real
identity.

### Institutional crypto disclosures

The initial watchlist uses official disclosures for:

- Strategy and Tesla treasury positions.
- BlackRock IBIT, Fidelity FBTC, ARK 21Shares ARKB, and Bitwise BITB.

These records are labeled treasury or fund disclosures, not wallet profits.
Exact wallet addresses are shown only when self-declared by the entity or
verified by a source whose terms permit public redistribution.

Each named entity has its own adapter health record. An aggregate Institutional
Disclosures status is a rollup and cannot hide a failed Strategy, Tesla, IBIT,
FBTC, ARKB, or BITB adapter.

### Excluded providers

The first release does not ingest Arkham, Nansen, Zerion production data, Whale
Alert, Etherscan premium labels, or other paid/restricted sources. Adapter
boundaries permit a later licensed integration, but no disabled provider appears
as a broken source in health status.

### Source-rights release gate

Public reachability is not treated as permission to cache or republish data.
Before an adapter is enabled in production, the repository records a
source-rights matrix containing:

- Exact provider, page or endpoint, and data fields used.
- Terms or license URL and the date checked.
- Whether server retrieval, temporary caching, durable historical caching,
  public display, derived metrics, and attribution are permitted.
- Required attribution and link-back language.
- Retention or deletion constraints.
- Final enable, link-only, or exclude decision with supporting evidence.

An adapter is enabled only when its current official terms or license permit the
planned retrieval, caching, and public display, or when written permission has
been obtained at no cost. Silence or ambiguity is not treated as permission.
Link-only sources may appear as research references but cannot supply cached
metrics, rankings, signals, briefings, or paper transactions. Every enabled
adapter must pass this rights gate as well as its technical smoke test.

### Authoritative implementation references

The implementation must recheck these sources and their terms at build time:

- [SEC developer resources](https://www.sec.gov/about/developer-resources) and
  [Form 13F guidance](https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f).
- [Situational Awareness LP EDGAR record](https://www.sec.gov/edgar/browse/?CIK=2045724),
  [Leopold Aschenbrenner's official biography](https://www.forourposterity.com/),
  and [Situational Awareness](https://situational-awareness.ai/).
- [Berkshire shareholder letters](https://www.berkshirehathaway.com/letters/letters.html),
  [Pershing Square official performance](https://pershingsquareholdings.com/performance/nav/),
  [Fundsmith documents](https://www.fundsmith.co.uk/documents),
  [Oaktree insights](https://www.oaktreecapital.com/insights), and
  [ARK trade-notification documentation](https://www.ark-funds.com/ark-trade-notifications).
- [Polymarket leaderboard API](https://docs.polymarket.com/api-reference/core/get-trader-leaderboard-rankings),
  [positions API](https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user),
  and [rate limits](https://docs.polymarket.com/api-reference/rate-limits).
- [Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint),
  [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits),
  and [portfolio-methodology caveats](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/portfolio-graphs).
- [Arkham API terms](https://arkm.com/api-terms-of-service) and
  [Nansen redistribution guidance](https://docs.nansen.ai/guides/redistribution-guide)
  document why those providers are excluded without a separate public-display
  license.

## Data contract

### Entity

- id
- displayName
- legalEntity
- actorType: person, firm, fund, anonymous_wallet, or venue_account
- strategyTags
- people
- officialUrls
- identity status, confidence, provider, and last verification time
- evidence coverage
- performance verification status
- followed state is client-local and is not returned by the public API

### Evidence and activity

- id and entityId
- kind: filing, statement, holding_change, position_change, rank_change,
  transfer, or performance
- source-specific stable identifier
- source URL and publisher
- source grade and identity confidence
- asset and direction when applicable
- magnitude and unit when applicable
- effectiveAt, disclosedAt, observedAt, retrievedAt
- filing or observation delay
- original dashboard-authored summary
- caveats and freshness

### Performance

- provider and venue
- exact vehicle or account scope
- account value when supplied
- realized and unrealized P&L only when supplied
- day, 30-day, and all-time P&L, ROI, and volume when supplied
- methodology: official_reported or provider_reported
- provider as-of time when supplied
- required local retrieval time
- freshness basis: provider_time or retrieval_time
- notComparableAcrossProviders: true for venue accounts

### API envelope

Every response contains:

- ok
- fetchedAt
- partial
- entities
- activities or signals
- provider statuses
- warnings
- source links

The server omits malformed records and marks the owning provider partial rather
than coercing invalid values.

## Ranking and signal rules

### Investors

Investors are ordered by freshness, evidence coverage, and followed state. The
system does not compute a universal success score.

Verified performance badges require an official or audited source. Otherwise the
status is reported, not publicly verified, or unavailable.

### Crypto accounts

Rankings remain separate for each provider and time window. An account qualifies
as an Observed Top Trader only when:

- All-time and 30-day provider-reported P&L are positive.
- The provider supplies sufficient current account value or activity volume.
- ROI and account value are finite and pass anomaly checks.
- The account is not stale, duplicated, or missing its provider scope.
- The source record can be linked and attributed.

Initial eligibility thresholds are:

- Hyperliquid: at least USD 1,000,000 current account value, USD 5,000,000
  30-day volume, positive 30-day P&L, and positive all-time P&L.
- Polymarket: at least USD 100,000 all-time P&L, USD 250,000 30-day volume, and
  positive 30-day P&L in the crypto category.
- Any finite ROI whose absolute value exceeds 1,000 percent is treated as an
  anomaly until the underlying provider records pass an additional consistency
  check; it is not eligible by default.

These values are named, tested constants. Changing them requires an explicit
documented configuration change and production data-quality check. Rankings
never merge P&L from different providers.

### Qualifying signals

A signal requires valid provenance, a fresh source record, a stable identity or
anonymous venue account, a supported action type, and deduplication by
source-specific identifier.

Examples include:

- A newly filed SEC disclosure or a normalized change from the previous
  reporting period.
- A new allowlisted official publication.
- A material supported-asset position change from a qualifying Hyperliquid
  account.
- A material source-scoped rank or P&L-window change.
- An official institutional treasury or fund disclosure.

Transfers remain observations unless a provider explicitly identifies a swap or
position change. They do not automatically create paper transactions.

Initial materiality rules are explicit and source-scoped:

- SEC: new and exited positions always qualify; an increase or reduction
  qualifies when reported shares change by at least ten percent and reported
  value is at least USD 1,000,000; every new Schedule 13D or 13G filing qualifies.
- Official publications: a newly published allowlisted document qualifies once,
  after canonical-URL and content-hash deduplication.
- Hyperliquid: a new position, close, direction reversal, or size change
  qualifies when changed notional is at least the greater of USD 100,000 or one
  percent of account value. The change must appear in two consecutive accepted
  snapshots before it can notify or enter Paper Copy.
- Polymarket: a move of at least ten places while remaining in the crypto
  leaderboard's top 100, a 30-day P&L change of at least the greater of USD
  25,000 or ten percent, or a 30-day volume change of at least USD 100,000
  qualifies for research alerts. Polymarket signals do not create paper
  transactions in the first release.
- Institutional disclosures: a reported acquisition or disposal qualifies at
  the greater of USD 10,000,000 or one percent of the previously disclosed
  holding. A first disclosure or complete exit always qualifies.

Thresholds are named tested constants. The signal records store the threshold
version used so later tuning does not rewrite historical eligibility.

## Paper simulation methodology

Paper Copy simulates a user's reaction to public evidence, not the original
actor's execution.

Rules:

1. A user follows an entity and explicitly starts its simulation.
2. Only qualifying signals observed after that time are eligible.
3. Entry uses the first trusted dashboard price at or after observedAt. The
   refresh process records that price and its timestamp with the immutable
   signal. The source's reported trade price is never invented.
4. Each new directional signal receives five percent of current virtual equity,
   subject to available cash and exposure limits.
5. Exposure is capped at twenty percent per followed entity and one hundred
   percent gross across the paper portfolio. There is no leverage.
6. Supported long and short directions are simulated; short notional counts
   fully toward gross exposure. Short proceeds are not treated as available
   buying power; equal virtual cash is reserved as collateral.
7. A reduce or exit signal reduces or closes only the simulated position created
   from that source. One entity cannot close another entity's paper position.
8. A transparent ten-basis-point total friction is applied on every simulated
   entry and exit.
9. Unsupported assets remain research signals and cannot enter the simulation.
10. Missing or stale market prices prevent a transaction and create a visible
    skipped-signal record.

An increase signal can add another five-percent slice until the entity cap is
reached. A decrease without an existing matching simulated position is recorded
but does not create a transaction. A direction reversal closes the existing
source position before opening a new position, subject to the same limits.

The server retains a rolling 400 days of shared qualifying signals, reference
prices, and daily marks for supported signaled assets, the S&P 500, and Bitcoin.
It stores no followed-entity list or user portfolio. When the browser reopens,
the client requests history since its last processed signal, applies only
signals after that local strategy's start time, and deduplicates them by stable
signal ID. This makes offline catch-up deterministic without backdating an
entry.

Daily marks calculate equity, cash, exposure, return, maximum drawdown, and
benchmarks. Closed transactions calculate win rate. Resetting a simulation is a
local user action with confirmation. Immediately before reset, the client stores
one local backup and offers Undo reset until another reset occurs. Users can
also export and import a versioned JSON simulation backup. Neither mechanism
sends portfolio data to the server.

## Briefing generation

The Smart Money Pulse reuses the existing configured Groq path and its
distributed safeguards, but it has an independent date-partitioned cache and
evidence schema.

Generation inputs are normalized records, never raw instructions from source
documents. Text fields are bounded and treated as quoted untrusted evidence.
Structured output requires:

- Exactly three paragraphs.
- A current UTC market date.
- Paragraph one references validated current market and sentiment evidence.
- Paragraph two references new investor evidence or the checked-at record that
  proves no material new disclosure was found; it adds current market context
  only when the evidence supports a meaningful connection.
- Paragraph three references current crypto or paper-risk evidence and current
  sentiment where it is relevant.
- Evidence references for every factual investor or crypto claim.
- Explicit distinction between disclosure date and effective date.
- No price targets, trade instructions, causal fabrication, or unsupported
  performance claims.

The response is validated before caching. Invalid AI output is rejected. A
deterministic three-paragraph digest built from the same evidence is always
available when AI generation or its guard infrastructure is unavailable.

On a day with no new investor publication or filing, paragraph two explicitly
states that no material new disclosure was found and reports the most recent
source date. Old paragraphs are never silently relabeled as current.

## Freshness, caching, and health

Provider targets:

- Polymarket: ten-minute cache; stale after thirty minutes.
- Hyperliquid: one-hour cache; stale after two hours.
- SEC and official publications: checked at least twice daily; provider health
  becomes stale when the last successful check is older than thirty-six hours.
- Smart Money Pulse: one UTC market-date partition; refreshed on date rollover,
  evidence change, or a quota-protected manual request.

Each concrete adapter records:

- enabled
- status: live, stale, or unavailable
- lastAttemptAt
- lastSuccessAt
- sourceAsOf, nullable when the provider supplies no authoritative timestamp
- retrievedAt, always required
- freshnessBasis: provider_time or retrieval_time
- recordCount
- cacheAgeSeconds
- sanitized error code

A provider is LIVE only after transport, content type, schema, timestamps, and
minimum useful record count pass validation. A successful HTTP status alone is
insufficient.

When a leaderboard does not supply an authoritative as-of timestamp, the
dashboard uses the server's retrieval time for cache freshness, sets sourceAsOf
to null, and visibly states Provider as-of not supplied. Retrieval time proves
when the dashboard observed a response, not when the provider calculated it.

Last-known-good records can be served with a stale warning but are excluded from
new signals and new paper transactions. An unavailable Smart Money provider
does not alter the dashboard's market LIVE or DEGRADED badge.

The configured first-release provider groups are SEC EDGAR, official investor
publications, official institutional crypto disclosures, Polymarket, and
Hyperliquid. Health is still gated at the concrete adapter level: each enabled
SEC reporting entity, each official publication site, each named treasury or ETF
source, Polymarket, and Hyperliquid must independently be LIVE. Group statuses
are rollups for display only. Runtime external outages after release are
represented honestly as partial Smart Money coverage and identify the exact
failed adapter.

## Runtime configuration

The feature introduces no paid data-provider credentials. It uses:

- SEC_USER_AGENT: required identified SEC client string with a monitored contact.
- CRON_SECRET: existing server-only refresh authorization.
- GROQ_API_KEY: existing optional AI generation key; deterministic briefing
  generation works without it.
- Existing Redis and Blob environment variables used by the dashboard's durable
  cache and distributed guards.

Provider base URLs are server-owned constants, not user-controlled inputs.
Missing required production cache or SEC configuration fails the relevant
health check and prevents release.

## Security, privacy, and source rights

- Routes use GET semantics. The protected refresh route performs cache
  maintenance only and no user mutation.
- CRON_SECRET protects refresh work. Existing Redis and Blob credentials remain
  server-only.
- No trading, wallet, broker, or exchange credential fields exist.
- External URLs are allowlisted or safely rendered with noopener and noreferrer.
- Source text is size-limited, sanitized, and isolated from AI instructions.
- SEC automation uses an identified User-Agent and stays below published access
  limits.
- Copyrighted publications are represented by metadata, short dashboard-authored
  summaries, and canonical links rather than full stored copies.
- Wallet identity is shown with its provider and confidence. No inferred
  personal identity is persisted.
- Paper preferences and simulated transactions remain in localStorage for this
  release.

## Error handling

- Timeouts, non-JSON responses, provider error payloads, schema failures,
  implausible numbers, future timestamps, and empty required datasets produce
  typed errors.
- Retries are bounded and use backoff; rate-limit responses respect retry hints.
- Concurrent refreshes use the project's distributed lock pattern.
- Each provider commits a new snapshot atomically only after validation.
- Partial responses identify exactly which provider failed.
- UI loading, empty, stale, partial, and unavailable states are distinct.
- A deterministic briefing prevents an empty Smart Money Pulse.
- Paper simulation records why a signal was skipped rather than silently
  dropping it.

## Testing

### Unit and contract tests

- Provider fixture parsing and schema validation.
- Malformed response, empty response, timeout, rate limit, and retry behavior.
- Timestamp normalization, future-date rejection, freshness, and last-known-good
  handling.
- Stable identifiers and deduplication.
- SEC filing-period comparisons and amendment handling.
- Provider-separated ranking and crypto eligibility thresholds.
- Prohibition on inferred identity and unsupported return claims.
- Exactly three grounded daily briefing paragraphs and deterministic fallback.
- Paper entry timing, position sizing, friction, long and short P&L, exposure
  limits, exits, skipped signals, offline history reconciliation, drawdown, win
  rate, and benchmarks.
- Explicit proof that no server module exposes or invokes a trading operation.

### UI tests

- Accessible segmented controls, tab panels, filters, tables, dialogs, and
  source links.
- Keyboard and focus behavior.
- Loading, empty, partial, stale, unavailable, and last-known-good states.
- Follow persistence and paper-simulation persistence.
- Add-to-simulation, reset confirmation, and unsupported-asset behavior.
- Opening supported assets in Prices.
- Overview preview and notifications linking into the correct Intel record.
- Responsive behavior without adding a sixth mobile navigation item.

### Regression and production checks

- Existing market, news, briefing, watchlist, alerts, Portfolio, and navigation
  tests continue to pass.
- The production build succeeds.
- Production smoke checks verify all configured provider health records are
  LIVE and non-empty.
- The current UTC market-date Smart Money Pulse contains three validated
  paragraphs and current sentiment evidence.
- A browser smoke test follows an entity, starts a paper simulation, observes a
  qualifying fixture or safe test signal, reloads, and confirms persistence.
- Network inspection confirms that the simulation generates no order or
  credential requests.

## Deployment and operations

The protected refresh route is added to the existing scheduled refresh cadence
or invoked from the existing refresh orchestration, avoiding unnecessary new
jobs. Request-time caches keep Polymarket and Hyperliquid within their provider
limits.

README documents sources, methodology, cache windows, disclosure delays,
environment variables, health routes, and simulation caveats. Production
verification records the deployed commit and endpoint results.

The release is complete only when:

1. Tests and the production build pass.
2. The production deployment matches the committed code.
3. Every configured free provider is LIVE with validated, non-empty data.
4. The current daily Smart Money Pulse is grounded and available, including its
   deterministic fallback.
5. Intel, Overview, Portfolio, Prices, and Notifications are connected as
   designed on desktop and mobile.
6. Paper simulation demonstrably cannot place or prepare real trades.
7. Existing live market status and daily market briefing remain healthy.

## Future extensions

Future work may add a licensed entity-attribution provider, accounts and cloud
sync, email digests, or deeper paper-risk controls. Each requires a separate
design and source-rights review. Automatic trading remains outside the product
boundary unless the user initiates a separate, explicitly approved project.
