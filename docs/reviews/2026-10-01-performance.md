# Performance review — 2026-10-01

Baseline: `d1bfff5` / v0.5.0, after merging the complete approved workspace/branding stack to main. Scope: application entry points and UI, MapLibre rendering/labels, GPS, IndexedDB/project commands, portable packages, offline worker/build, online sync/briefing, SQL migrations, build/deployment configuration and existing tests. This is a static whole-application review, not a phone CPU, battery or production database benchmark. Findings remain open unless explicitly noted.

## Findings, in priority order

1. **P1 — unchanged online projects rebuild the map repeatedly.** `src/core/sync/session.ts:110–160` polls every 1.5 s, fetches membership and a full validated snapshot, then publishes a fresh project object even when `server_seq` is unchanged. `src/features/editor/useEditor.ts` responds to project identity by rebuilding GeoJSON and DOM markers. Briefing independently polls (`src/core/sync/briefing.ts:103`). With low latency this approaches 120 requests/minute/client across the three requests, including unchanged documents. Cache writes already have sequence/role guards; UI publication does not. Preserve snapshot/document identity on unchanged sequences, then consider conditional snapshot fetches. Continue checking membership and applying draft/conflict/permission transitions; never optimize away revocation checks. Verify with unchanged/changing sequence and role-revocation tests before release.

2. **P1 — map metadata paths deserialize whole map packages.** `src/core/projects/database.ts:79` uses `getAll()` on packages (up to 25 MiB each) to list metadata. `:182` fetches an entire local package merely to verify existence on every project save. Several large custom maps can create avoidable memory spikes on phones. Use `getKey()` for existence and a metadata-only store/indexed representation for the list. Keep bundle import atomic and maintain referential checks. Measure multiple near-limit packages, not only the small built-in map.

3. **P2 — editor state changes can trigger full offline integrity checks.** `src/core/useOfflineApp.ts:15–27,108` ties registration/verification to changing `canReload` callback identity; callers change that callback when editing/briefing state changes. Verification reads and hashes all cached resources. Keep a stable lifecycle effect with a current reload-guard ref and coalesce concurrent checks; retain explicit repair, visibility and update verification. Offline/update tests must cover a dirty form during a waiting update.

4. **P2 — label layout work scales poorly during pan/zoom.** `src/features/map/labels.ts:45–104` projects every candidate before culling, writes SVG paths, reads text/path geometry and checks an increasingly large occupied list on every move. `src/features/editor/useEditor.ts` similarly measures DOM labels. This mixes layout reads/writes and quadratic collision checks. Cull by viewport first, cache text metrics, batch reads/writes and coalesce frames; consider a spatial occupancy grid. Preserve offline system-font rendering and curved-road label containment. Benchmark dense named-road imports and 500 plan objects on the Galaxy A24.

5. **P2 — large imports/exports block the UI thread.** `src/core/packages/maps.ts` converts OSM synchronously; `src/core/portable/archive.ts:18` calls `zipSync` for archives with an expanded-size limit of 64 MiB. A busy state cannot make these CPU operations cancellable. Move conversion/compression to a worker or asynchronous library path and lazy-load their code while retaining offline precaching. Keep byte/vertex/ZIP limits and transactional installation; cancellation must not leave partial projects.

6. **P2 — retained release caches have no lifecycle bound.** `src/core/service-worker.js:33` intentionally retains previous caches so older tabs work, but there is no subsequent collection. Repeated releases consume device quota, risking failed offline installs. Add version-aware collection only after proving no controlled client still requires a cache. Do not delete all old caches on activation.

## Additional scaling risks, not measured defects

- SQL atomic writes lock the project row and rebuild/validate its JSON document; briefing RPCs also lock this row. Large collaboration groups and batches may contend. Profile real PostgreSQL before splitting documents or relaxing transaction boundaries. PGlite functional tests do not establish production throughput.
- Project/catalog lists fetch complete documents; phase forms render per-phase element checklists even in mounted hidden panels. Bound counts help, but deferred panels/metadata queries are worthwhile after measuring.
- GPS age timers cause periodic parent renders even with no useful location update. Isolate age display/timer scheduling before broader memoization.
- A large JS chunk is reported by the production build. MapLibre includes its local worker intentionally; raw bundle size alone is not evidence of a regression. Measure cold start and interaction before removing functionality.

## Preserved properties

Offline integrity, bounded import sizes, local-only GPS, transactional saves/CAS, explicit draft conflict handling and server authorization are performance constraints, not shortcuts to remove. No performance gain is claimed by this review. The data corrections in this branch are independent of these open optimization findings.
