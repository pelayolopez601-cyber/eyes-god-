# San Antonio-area USGS water observations

`san-antonio-usgs-water` is one site-grouped layer of latest USGS observations
inside `bbox=-98.85,29.05,-98.08,29.85`. This rectangle includes neighboring
counties and does not establish complete coverage of San Antonio or Bexar County.
It is independent of the City parks/trails contribution.

## Use

Enable **Data Layers > San Antonio > San Antonio USGS Water**, then click a
station. Blue markers have at least one numeric reading; gray markers have
timestamped observations without numeric values. Colors describe availability,
not danger. Both classes retain station markers and source provenance.

The selected card shows one series at a time. **Reading** controls step through
every series, including two series for the same parameter. Cards show original
numeric text, source units, measurement time in UTC, approval status, qualifiers,
parameter/statistic codes, computation, sublocation, series identity, and a
separate retrieval time. Clicking the card opens the official station page.

**Area** selects the entire rectangle; **Bexar** selects stations with
`state_code='48'` and `county_code='029'`. Neighboring counties retain their own
names. Filters and reading selection are local session controls. Share links
preserve layer visibility and initially show the entire rectangle. **Refresh**
requests another complete snapshot when the source's retry hold permits it.

## Meaning and limits

- Zero and negative readings are valid. Null, blank, textual and nonfinite values
  are not converted to zero. The original source value text remains in records.
- Freshness uses observation `time`; `last_modified` describes database updates.
  A recent database update cannot revive a measurement outside the query window.
- Gage height is not necessarily river depth. Groundwater parameter `72019` is
  depth below land surface. Neither measurement sets a marker's map altitude.
- Parameter `00045` is precipitation, total. Selecting observations within a
  24-hour window does not establish a 24-hour rainfall total.
- USGS provisional observations can be revised. The layer does not classify
  flooding, risk, closures or safe travel. Historical charts are outside its scope.

## Acquisition contract

The standalone keyless adapter uses the current Water Data OGC v1 collections:

- [`latest-continuous`](https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items):
  `f=json`, the fixed rectangle, a dynamic UTC `datetime=<now minus 24 hours>/..`,
  and an explicit bounded limit.
- [`monitoring-locations`](https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/items):
  batched `filter-lang=cql2-text` queries on `id IN (...)`.
- [`time-series-metadata`](https://api.waterdata.usgs.gov/ogcapi/v1/collections/time-series-metadata/items):
  batched `id IN (...)` queries for only the observation series.

The source joins observation `monitoring_location_id` to station `id`, and
`time_series_id` to series `id`, checking station, parameter and statistic
consistency. Missing metadata or conflicting duplicates reject the acquisition.
Same-parameter series remain separate. Null-only stations remain represented.
Station coordinates determine positions; observation values and metadata
altitudes do not. Only approved public fields leave the source.

Pagination follows same-origin, same-collection `rel=next` links with unchanged
query scope. Repeated/ambiguous links, stalled pages, changed limits, malformed
pages, conflicting identities, and mismatched `numberReturned` are errors.
`numberMatched` is optional; when supplied it must match the completed distinct
record count. With an absent count, completeness depends on the provider's
pagination links and completed metadata joins, not a fabricated expected count.

Default ceilings: 500 rows per page, 50 identifiers per metadata batch, 2,000
observations, 256 locations, 2,000 series, 64 total requests/pages, 8 MiB per
response, 32 MiB total, and a 60-second whole-acquisition deadline. Consumers
can lower these limits, not raise them. At most 64 readings can be displayed
at one station; exceeding that bound reports an error instead of truncating.

Observation snapshots use a 15-minute memory cache. Metadata uses bounded
per-identifier memory caches with a 24-hour TTL. Returned snapshots are
defensive copies. Only complete successful acquisitions publish caches.
Failure does not serve expired source data as fresh. An enabled layer keeps
its prior display with a stale/error indication after a failed refresh.

HTTP 429 recognizes delta-seconds and HTTP-date `Retry-After`, with a maximum
one-day hold. Other failures back off from five seconds to five minutes. Calls
during a hold make no provider requests; there is no unbounded retry loop.
Caller cancellation does not impose failure backoff. Deadlines include fetch
and body reads even for injected implementations that ignore AbortSignal.

This adapter supports keyless access. It does not accept or embed operator API
keys. A future authenticated adapter must keep private keys server-side and use
`X-Api-Key`, never a browser key or query-string credential.

## Ownership

`src/layers/usgsWater/` owns configuration, bounded acquisition, plain grouped
records, marker rendering and lifecycle/selection. Package consumers can import
`gods-eye-view/layers/usgs-water` and `gods-eye-view/layers/usgs-water/source`
independently. `sources['usgs-water']` supplies `getSnapshot({signal, force})` to
the catalog. A null source makes the layer unavailable before acquisition.
Construction does not fetch. Disable aborts work and removes owned data sources,
entities, click handlers and cards. Late asynchronous insertion is compensated.

Selected text uses the shared world overlay; no Cesium text labels are added.
Renderer/source state belongs to factory instances rather than global services.

## Source rights and attribution

Credit **U.S. Geological Survey** and link the source and the
[provisional-data statement](https://waterdata.usgs.gov/provisional-data-statement/).
[USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)
states that USGS-authored data and information are in the U.S. public domain;
third-party materials can retain their rights. Acquisition is restricted to
USGS station identities and `agency_code='USGS'`. This contribution does not
copy logos, third-party imagery or other copyrighted materials from USGS pages.
The repository's MIT code license is separate from source-data rights.
See [DATA_SOURCES.md](../DATA_SOURCES.md#san-antonio-area-usgs-water) for credit.

## Share token coordination

Current upstream `591f299d11f38a612629a274463196d57ae3862e` assigns the next
available token `3` to this layer. This allocation is provisional until merge.
The separate City PR also proposes `3`, `4`, and `5`. If that PR merges first,
remove only this contribution's unpublished registry/ledger entry and run
`npm run layer-token:next -- san-antonio-usgs-water` against refreshed main;
it should then allocate the next free token. Never change a published City
token or reserve unused tokens to skip the allocation order.

## Verification

The tests use invented observations and locations. The browser gate intercepts
only the three official OGC collections while exercising the real catalog,
controls, renderer, map picking, cards, share restoration, cache and 429 recovery.
A separate bounded live check records counts and join completeness without
committing downloaded observation payloads.

```sh
npm ci
npm run doctor
npm run build
npm test
npm run format:check
npm run check:boundaries
npm run layer-token:check -- --base-ref upstream/main
# With npm run dev on localhost:4173:
npm run test:track -- --headful
node scripts/qa-usgs-water.mjs --headful
node scripts/qa-usgs-water-live.mjs
```

Current v1 schemas were fetched directly. Actual October 11 research confirmed
that qualifiers can be lists (`EQUIP`, `UNAVAIL`) as well as null/text, despite
the schema's string declaration; the implementation preserves those lists.
Reference docs: [CQL queries](https://api.waterdata.usgs.gov/docs/ogcapi/complex-queries/),
[efficiency](https://api.waterdata.usgs.gov/docs/ogcapi/efficiency/),
[keys](https://api.waterdata.usgs.gov/docs/ogcapi/keys/), and
[migration](https://api.waterdata.usgs.gov/docs/ogcapi/migration/).

## Contribution validation — October 11, 2026 (America/Chicago)

Reviewed against upstream `591f299d11f38a612629a274463196d57ae3862e` using
Windows, Node 24.19.0, npm 11.6.0 and full Chrome for Testing 152.0.7977.75.
The dependency lockfile is unchanged.

- `npm ci`, `npm run doctor`, `npm run build`, `npm run format`,
  `npm run format:check` (1,320 adopted/runtime files), package boundaries,
  token checks against `upstream/main`, and whitespace checks passed.
- The focused browser gate passed 38 checks, including actual drawing/picking,
  cards, units/time/status, qualifier text, safe provider text, local filtering,
  cleanup, cache reuse, fresh share restoration and 429/retry behavior. Each
  scenario had no uncaught page or Cesium render errors.
- The final `npm test` main phase reported **6,262 passed, 1 failed, 10 skipped**.
  The remaining failure is Windows installed-executable resolution in
  `src/codexOauthRealtime.test.mjs`: expected `\home\fixture\.local\bin\codex`,
  received `codex`. A fresh targeted run on unchanged upstream reproduced it.
  Earlier Windows Pinokio fixture cleanup also failed, but passed in the final
  full run. No onboarding test was changed or skipped to accommodate this layer.
- Because a failing main phase prevents allocation phases from running, the
  Node 24 GC-bracketed allocation probes were run separately: **14 passed**.
  That does not make the full required `npm test` command green.
- Final tracking rerun: **109 passed, 0 failed, 0 skipped**, with clean console
  and HTTP 5xx checks. Unchanged upstream also passed 109/0/0. The first
  contribution run had 107 passes and two M3 camera age-out failures: altitude
  delta 295.46 km and horizontal delta 392.01 km against 2 km budgets. Those
  failures did not reproduce in the unchanged-upstream comparison or clean
  contribution rerun (both deltas 0.00 km). Their cause remains unproven;
  aircraft/camera runtime files and the tracking harness are unchanged, and the
  USGS layer stayed disabled throughout those tracking runs. Both reveal-timing
  checks passed at frame 4 with zero heading error in all three runs.

The bounded live gate at **2026-10-12 04:26 UTC** (October 11 local time) recorded:

| Scope | Locations | Series/readings | Numeric readings | Numeric locations | No numeric locations |
| --- | ---: | ---: | ---: | ---: | ---: |
| San Antonio-area rectangle | 45 | 141 | 136 | 43 | 2 |
| Bexar subset of that rectangle | 30 | 103 | 98 | 28 | 2 |

All **45/45 station identities** and **141/141 series identities** joined.
No observations were excluded for being outside the query window. All returned
observations were Provisional. The Bexar subset contained 25 stream sites and
five wells across 11 parameters. These are timestamped observations, not pinned
correctness assertions or guarantees of current coverage. The script saved
only aggregate evidence under ignored `qa-shots/usgs-water/`.

Keep the PR draft pending a green required unit gate or maintainer disposition
of the reproduced upstream failure. Tracking intermittency and merge-time token
reallocation also remain explicit review items. The unchanged lockfile reported
three existing audit findings (one low, two high); no dependency remediation is
included in this source contribution.
