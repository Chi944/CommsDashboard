# Provider Core whole-branch review fix report

## Scope

- Reviewed base: `9bca944ed311902ef71a154cdc0e633998583b43`
- Review result addressed: 1 Critical, 9 Important, 1 Minor
- Final implementation commit: `f5857504f69ac9077e2eb02b5a05a0afb5b0bd8c`
- No deployment or push is part of this repair.

## Implemented repairs

1. The existing authenticated `/api/market/refresh` GET cron now runs the market
   and Smart Money services through isolated `Promise.allSettled` calls. Its
   response contains only bounded public outcomes and returns 503 when either
   service is nondurable or partial.
2. SEC submissions recognize canonical `SC` and live `SCHEDULE` 13D/G forms as
   metadata-only filing events. Filing-date timing is explicit, beneficial-
   ownership effective dates are not inferred, initial Schedule history is a
   silent baseline, and only a later unseen accession creates a research-only
   filing signal.
3. Every 13F delta, including an exit, uses the newest current filing's
   accession, URL, period, and filing date. The older holding supplies numerical
   comparison data only.
4. Failed and not-due SEC reuse preserves accepted source evidence and activity
   timestamps byte-for-byte; only provider attempt/status diagnostics change.
5. A selected 13F must have exactly one recognized nonempty information table.
   Missing, ambiguous, empty, or malformed content fails closed for LKG reuse.
6. Production refresh invokes ETag-safe journal pruning under the refresh lock
   after accepted publication. Cleanup failures keep acceptance durable while
   returning a sanitized partial warning.
7. History now pages one ordered signal/daily-mark event stream. The cursor
   freezes `through`, the limit bounds total events, exact timestamps enforce
   `since`, relevant dates are selected before partition reads, and events do
   not repeat across pages.
8. The enabled SEC rights record now enumerates all three production endpoint
   templates and every raw/persisted filing and holding field. Documentation
   records the newest-13F-only production policy.
9. The dormant Hyperliquid rights record now names the exact link-only adapter
   endpoint without enabling any transport.
10. Production `sec-edgar` is bounded to the newest canonical 13F per refresh;
    the prior accepted quarter supplies forward comparisons and Schedule
    metadata remains present.

## Test evidence

- Focused integrated Provider Core + scheduled market gate: 308/308 passed
  after the final fulfilled-partial scheduler regression.
- Full `npm test`: 388 Node tests + 33 UI tests = 421/421 passed.
- `npm run build`: passed; Vite transformed 623 modules.
- `git diff --check`: passed.
- History adversarial coverage includes a 399-partition one-day read bound,
  1,000 marks with limit 1, exact 23:00 vs 20:00 filtering, non-repeating pages,
  and a frozen cursor boundary during concurrent append.
- Scheduler coverage includes both-success, synchronous market failure,
  Smart Money failure, and fulfilled partial results from either service.
- Persistence coverage includes production prune invocation, current/superseded
  compaction, unresolved-stage preservation, and sanitized prune failure.

The original implementer created the complete failing regression set before
production edits and reported entering the RED phase. Its raw combined RED
transcript was not retained after the sub-agent reached its usage limit; this
report does not recreate or claim a fabricated transcript. All final GREEN
commands above were rerun directly in the shared worktree.

## Bounded live evidence

Before the final local gate, the implementer reran the production SEC path with
an identified User-Agent and reported the newest 2026-06-30 13F live with 26
holdings plus six canonical Schedule metadata filings. No response bodies were
retained. Earlier independent review also verified all six institutional
profiles against their current official SEC filings.

## Preserved safety boundaries

- Exactly seven production adapters remain enabled.
- Production makes zero Yahoo, Polymarket, or Hyperliquid Smart Money calls and
  persists no price marks under current rights.
- Schedule filings and 13F holdings remain research-only and cannot become
  executable trade instructions.
- No order, broker, exchange, wallet-signing, credential, deposit, withdrawal,
  or trading preparation capability was added.

## Remaining production prerequisite

Production still requires a user-confirmed monitored `SEC_USER_AGENT` contact.
The repository intentionally rejects placeholder addresses.
