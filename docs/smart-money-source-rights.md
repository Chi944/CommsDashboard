# Smart Money source-rights matrix

Reviewed: 2026-08-26. Next mandatory review: 2027-02-26.

This is a pre-network fail-closed gate. An adapter may run only if its source
record is current, `enable`, free without credentials, and affirmatively allows
every operation it needs: retrieval, temporary and historical caching, public
display, derived metrics, and attribution. A public page, public API, or an API
that does not require authentication is not evidence of redistribution rights.
Link-only records cannot be fetched, cached, ranked, briefed, or used for paper
signals. They may only be represented by an attributed outgoing link. Excluded
records never enter an adapter configuration.

The machine-readable matrix is [config/smart-money-source-rights.json](../config/smart-money-source-rights.json).
It records every endpoint, field, decision, permission, retention rule, cost
evidence, and reviewed official URL.

## Enabled SEC filing records

`sec-edgar`, `strategy-disclosures`, `tesla-disclosures`, `ibit-disclosures`,
`fbtc-disclosures`, `arkb-disclosures`, and `bitb-disclosures` use the exact
`data.sec.gov/submissions/CIK...json` endpoints in the matrix. `sec-edgar` then
uses the filing's bounded `www.sec.gov/Archives/.../index.json` and exactly one
recognized information-table document; its rights record enumerates those
templates and every retrieved, persisted, and displayed filing/holding field.
Each production refresh fetches only the newest canonical 13F filing selected
from the current submissions metadata; the prior accepted quarter supplies the
comparison state, so quarter-over-quarter reductions and exits remain visible
without repeatedly downloading older filing documents.
The six institutional adapters use their aligned submissions tuple and one
bounded primary filing document with a fixed reviewed inline-XBRL profile.
Schedule 13D/G rows are retained only as filing metadata with filing-date timing;
they never imply a ticker, holding, ownership-effective date, or trade. SEC's
[website-dissemination policy](https://www.sec.gov/about/privacy-information)
says information on sec.gov may be copied or further distributed and asks users
to cite the SEC; its [webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions)
also states that EDGAR public filing content is free to access and reuse. The
[developer resources](https://www.sec.gov/about/developer-resources) document
the API and fair-access requirement. Every display must retain SEC attribution,
the filing/source link, report period, filing date, and filing lag; none may be
presented as a live position.

## Link-only records

`leopold-official`, `berkshire-letters`, `pershing-performance`,
`fundsmith-documents`, `oaktree-insights`, and `ark-publications` are official
publication pages but the reviewed pages did not provide affirmative permission
for server retrieval, metadata caching, derived metrics, or republication. They
remain outgoing, attributed research links only.

`polymarket-data-api` is also link-only. Its documentation describes public,
unauthenticated endpoints, but that does not grant redistribution rights; its
[institutional page](https://institutional.polymarket.com/) requires capital
markets entities to consult Polymarket and ICE before consuming or redistributing
Polymarket data, including derived or aggregated data. No Polymarket ranking,
briefing, signal, or paper-simulation adapter is enabled.

`hyperliquid-stats-api` (whose exact dormant leaderboard link is
`https://stats-data.hyperliquid.xyz/Mainnet/leaderboard`) and
`hyperliquid-info-api` are link-only. The reviewed
[API documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api)
and [Info endpoint documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
describe access but do not affirm the required no-cost cache, redistribution,
and derived-metric rights. No Hyperliquid adapter is enabled.

## Excluded records

`arkham-excluded` is excluded. Arkham's [API terms](https://arkm.com/api-terms-of-service)
prohibit disclosure, distribution, publication, and displaying a compilation or
directory derived from service data without prior written consent.

`nansen-excluded` is excluded. Nansen's [redistribution guide](https://docs.nansen.ai/guides/redistribution-guide)
and authenticated API access require separate provider authorization before
redistribution. These exclusions are intentional and are not shown as failed
providers.

## Registry boundary

The static registry keeps people and legal entities separate: Leopold
Aschenbrenner and Situational Awareness LP are distinct related entries, as are
the other five person/firm pairs. Strategy, Tesla, IBIT, FBTC, ARKB, and BITB
are institutional-flow entities. Dynamic venue accounts are intentionally not
static entities. This subsystem is read-only and never prepares or executes a
trade.
