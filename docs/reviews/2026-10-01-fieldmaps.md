# FieldMaps / Mahlwinkel data audit — 2026-10-01

Source: clean FieldMaps commit `2998bb6d7413a3e036412fa37443e8eead1238f3`, read-only reference checkout. `node scripts/import-fieldmaps.mjs --check` compares the complete imported snapshot (all coordinates, POI labels, zone metadata, frontlines and HQ points) with that source. Logos, landing-page text, schedules and basemap presentation are deliberately not imported as planning geometry.

| Event | Boundary vertices | Zones | HQ/other headquarters markers | Active POIs |
|---|---:|---:|---:|---:|
| Mission 24 | 45 | 1 | 4 | 51 |
| Dark Emergency | 25 | 4 | 6 | 44 |
| Operation Tschernobyl | 25 | 2 | 6 | 45 |
| LIGHT-SIM | 13 | 0 | 3 | 47 |
| Airsoft Days | 17 | 0 | 3 | 41 |
| Lost Airfield | 16 | 0 | 2 | 68 |

These are **source counts**, before the corrections below. No polygon field was silently discarded by the importer: FieldMaps defines headquarters as points, and zones as ordered polygon rings. Our original Safe Zones were already closed polygons, although their simplified shapes and generic labels concealed their meaning. HQ points cannot establish full HQ boundaries.

## Confirmed defects and corrections

- The built-in terrain bounds ended at latitude 52.3855 north / 52.376 south. DE reaches 52.385885, Airsoft Days 52.385674, and LIGHT-SIM 52.37599. Expanded download bounds: `[11.809,52.375,11.84,52.387]`; the OSM manifest records the actual source timestamp/hash after refetch. A wider rectangle is data coverage, never an event permission boundary.
- The retained organiser image `reference/tactical-maps/de_2026_taktikkarte.jpg` (DE-39517-2026-1) visibly contains **five** hatched safe areas, including the Miliz HQ. FieldMaps contains four; the Miliz area is absent there too.
- The DE white outer boundary at the KGG HQ differs materially from the imported source polygon. Retraced the white perimeter and all five hatched areas from the retained image. This corrects a source-capture omission, not just an AS-TAC conversion error.
- Safe Zones now occupy a separate top layer. Each known safe-area footprint also belongs to the underlying site layer, even where it extends beyond the event play perimeter. Turning off Safe Zones retains that ground. HQ markers remain individually visible; no guessed radius or full HQ perimeter is invented.
- Zone labels now identify the HQ/outpost. Literal `<br>` markup in the Tschernobyl source label becomes plain whitespace. The civilian zone remains an ordinary zone, **not** a Safe Zone.

## Reproducibility and limits

The original snapshot remains byte-for-byte reproducible and unmodified. `scripts/data/dark-emergency-trace.json` stores the manually selected image coordinates in an explicitly declared 1888-pixel-wide reference frame, image dimensions/hash, five turbine controls and polygon traces. The importer uses the pinned FieldMaps `solveTransform` to fit a similarity transform and writes the separate `src/data/dark-emergency-correction.json`. Its fit residual is **4.41 m RMS**. This measures only agreement at the selected turbine controls; **it is not polygon or field-survey accuracy**. Tracing and source artwork can differ by tens of metres, and emblems conceal parts of the outpost contours.

Image SHA-256: `b0cf139b6f3fd76a8b10d83d6b46170229f9f4da9c6bb978931eea84ba34edaa`. Only derived coordinates ship, not organiser imagery or logos. A reference overlay can be generated locally for inspection; it is not an application asset.

All six event snapshots were checked against their TypeScript sources, and all six retained reference images were visually inspected. The deeper calibrated image-to-geometry correction in this change is **Dark Emergency only**.

The remaining image audit found these boundaries of coverage:

- Mission 24's 2026 image includes the southern building block and multiple observation/camera symbols. Its imported boundary explicitly comes from an older image; those tactical symbols are not represented as individual imported elements. Do not claim the snapshot reproduces the complete 2026 print.
- Airsoft Days identifies headquarters by circles/logos, with additional camping/parking/access information outside the event perimeter. These facilities and full headquarters footprints are not all supplied as vector areas by FieldMaps.
- Operation Tschernobyl supplies the irradiated and restricted polygons, but faction circles are point symbols, not measured area outlines. Hatching/biohazard iconography is simplified in AS-TAC; the two meanings must not be conflated with safe areas.
- LIGHT-SIM shows two HQ symbols and a parking symbol, with a UTM grid. The imported grid-free planning data intentionally retains point markers; the print does not provide separate full HQ polygon outlines.
- Lost Airfield places PMC and Rebellen symbols beside the boundary, and has parking/range information and numbered control symbols. Those symbols cannot be used as radii for invented HQ polygons; additional facilities/control symbols are outside the current imported vector coverage.

This explains why a complete visual capture requires more than copying the existing scenario arrays. The known DE omission is corrected here; the other items are recorded gaps, not silently presented as complete. Other events retain their source geometry, including older-edition boundaries (notably Mission 24). Full HQ perimeters, every event's original-image capture completeness, current organiser rules and ground-truth boundaries are **not verified** by snapshot equality. These remain explicit follow-up work; the application must not call these maps surveyed or current official event editions.

Catalogue revision is `fieldmaps-2998bb6-r2`. Existing local/online projects and exported packages are intentionally not rewritten: users install a new event copy to receive the correction, preserving their own annotations.

## Verification result

- `node scripts/import-fieldmaps.mjs --check`: original snapshot and derived correction reproduce exactly; pinned source checkout remains clean.
- `npm run check`: 62 files, zero errors/warnings/hints.
- Production build: successful; 20 offline resources, 4,057,822 bytes, manifest `81e23b83e7f2e001`. Existing large-chunk warning is tracked in the performance review.
- Final full Chromium suite: **54 passed, 1 skipped**, including offline cold starts, event ZIP export/import, layer isolation, new geometry bounds/ring/intersection checks, and the Miliz point-in-polygon regression. The configured live backend browser test is skipped; SQL behavior is exercised in PGlite, not a deployed Supabase instance.
- Fixed an existing test navigation race: the update test now waits for the new document before clicking a workspace tab. All eight offline tests then passed, followed by the complete passing suite above.
- Visually inspected a reference overlay of old/new DE boundaries and the rendered offline desktop workspace. No iPhone 16 Pro / Galaxy A24 field survey, battery benchmark or actual-device acceptance was performed in this audit.
