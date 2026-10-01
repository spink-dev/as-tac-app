# Credits und Herkunft

Stand: 2026-10-01. Auch ohne Internet muss die spätere App diese Hinweise unter „Über / Credits“ anzeigen können.

## FieldMaps — @rwolffgang

Vielen Dank an **[@rwolffgang](https://github.com/rwolffgang)**, Entwickler von **[FieldMaps](https://github.com/rwolffgang/FieldMaps)**, für die Referenzarbeit zu Offline-Karten, GPS und mobiler Nutzung sowie die Samuel mitgeteilte Erlaubnis zur Wiederverwendung.

Samuel Spink berichtete am 2026-10-01 ausdrücklich, der Entwickler habe ihm erlaubt, so viel Code zu kopieren wie gewünscht. Ein gesonderter schriftlicher Lizenztext wurde in dieser Vorbereitung nicht eingesehen; keine öffentliche Standardlizenz wird daraus abgeleitet. Vorhandene Hinweise in übernommenen Dateien bleiben erhalten.

| Status | Quelle / Stand | Verwendung in as-tac |
| --- | --- | --- |
| Technische Referenz, kein Code kopiert | FieldMaps `2998bb6d7413a3e036412fa37443e8eead1238f3`; `src/geo.ts`, `src/osm-map.ts`, `vite.config.ts`, `scripts/fetch-osm.mjs` | Offline-/GPS-Planung und Architekturvergleich |
| Eigene Vorgänger-App, kein Code kopiert | TacMap `77474d8a0a69ef10f94d69a44687c1fa4ed647ec` | Feature-, Paket-, Briefing- und Rollenreferenz |

Jede spätere Übernahme bekommt eine zusätzliche Zeile mit Quelle/Commit, Zieldatei, übernommenem Umfang und Änderungen. „Inspiriert von“ darf eine echte Codeübernahme nicht verschleiern. Keine fremden Eventlogos oder Kartenbilder pauschal mitübernehmen.

## Kartendaten

Sobald OSM-Daten enthalten sind: auf der Karte **© OpenStreetMap contributors** sichtbar anzeigen und auf [Copyright / ODbL](https://www.openstreetmap.org/copyright) verlinken. Offline-Pakete führen Quelle, Datenstand, Lizenzhinweis und erforderliche Lizenztexte mit. Der konkrete Datenlieferant und seine Bedingungen werden pro Paket erfasst.

## Abhängigkeiten und weitere Assets

Bei Aufnahme der Karten-/PWA-Abhängigkeiten ihre tatsächlichen Lizenzhinweise erfassen. Schriften, Icons, Bilder und exportierte Daten separat inventarisieren. Dieses Dokument behauptet keine allgemeine Veröffentlichungslizenz für as-tac.

## AST-001 — implementierter Stand

- `scripts/fetch-map.mjs`: eigene Implementierung; Overpass-JSON wird mit osmtogeojson nach WGS84-GeoJSON konvertiert, einschliesslich Multipolygon-Innenringen. Keine FieldMaps-/TacMap-Codekopie.
- Mahlwinkel-Bounds `[11.809, 52.376, 11.84, 52.3855]` stammen als Gebietskonfiguration aus FieldMaps `2998bb6d7413a3e036412fa37443e8eead1238f3`, `scripts/fetch-osm.mjs`. Übernommen nach `scripts/fetch-map.mjs`, ohne Pixeltransformation oder Event-Assets.
- Die beiden frischen OSM-Auszüge liegen unter `public/maps/`. Zugehörige JSON-Manifeste nennen Quelle, Datenzeit, SHA-256 und Bytezahl. OSM-Daten bleiben ODbL 1.0; lokale Lizenz unter `public/licenses/ODbL-1.0.txt`.
- React (MIT), MapLibre GL JS (BSD-3-Clause), Astro (MIT), Astro React (MIT) und osmtogeojson (MIT): Hinweise unter `public/licenses/dependencies.txt`. MapLibre enthält zusätzliche Fremdcodehinweise in seinem Lizenztext.
- App-Icon, einfache Gebietssymbole und Kartenstil sind eigene Arbeit. Labels nutzen die installierte Systemschrift. Keine heruntergeladenen Fonts, Sprites, fremden Logos oder Kartenbilder.
- `CREDITS.md` wird beim Produktionsbuild nach `/licenses/CREDITS.md` kopiert und ebenfalls offline gespeichert.

## AST-004

Eigene Gebietspaket- und Downloadimplementierung, kein kopierter Referenzcode. osmtogeojson wird nun auch im Browser zur OSM-Konvertierung verwendet; zusätzliche Hinweise für den gebündelten Lodash-Build, geojson-rewind und osm-polygon-features stehen im Offline-Lizenzinventar. Overpass liefert auf bewussten Nutzeraufruf kleine OSM-Auszüge; keine Rastertile-Vorabdownloads.

## AST-007

- Eigenes Projektpaketformat und begrenzter ZIP-Leser; fflate 0.8.3 (MIT) für ZIP-Export. Lizenz unter `public/licenses/dependencies.txt`. Keine weitere Referenzcodeübernahme.

## AST-009

- Supabase JavaScript-Client und Laufzeitabhängigkeiten: MIT/Apache-2.0-Lizenztexte unter `public/licenses/dependencies.txt`. Keine Übernahme von TacMap-Backend-Code.
- PGlite dient ausschliesslich als PostgreSQL-Testlaufzeit in Node; wird nicht mit der App ausgeliefert. Lizenz im npm-Paket (`@electric-sql/pglite/LICENSE`).

## AST-010–012

Eigene Client-Synchronisierung, Konfliktoberfläche und PostgreSQL-Briefing-Leases. Keine zusätzliche Referenzcodeübernahme und keine neuen Laufzeitabhängigkeiten. Quellen-/Lizenzansicht und vollständiger Paketexport stehen auch im gemeinsamen Workspace zur Verfügung.

## Kartenarbeitsplatz / Mahlwinkel-Eventvorlagen

- Übernommene Daten: FieldMaps `2998bb6d7413a3e036412fa37443e8eead1238f3`, `src/points-of-interest.ts` und `src/scenarios/{mission24,dark-emergency,operation-tschernobyl,light-sim,airsoft-days,lost-airfield}.ts` → `src/data/mahlwinkel-fieldmaps.json`. Konverter: `scripts/import-fieldmaps.mjs`; AS-TAC-Projekte: `src/features/catalog/catalog.ts`.
- Gemeinsame physische Punkte, eventspezifische Namen, Spielfeldgrenzen, Zonen, Hauptquartiere und Grenzlinien übernommen. Keine Logos, Bildkarten, Termine, CSS-Themes oder Vermarktungstexte. Koordinaten beim Projektaufbau von `[lat, lon]` nach `[lon, lat]` umgeordnet. Stabile Quell-IDs erhalten; frische Projekt-/Element-/Ebenen-IDs je Kopie.
- Quellenhinweis des Originals: Dark Emergency nutzt die gedruckte Karte DE-39517-2026-1; Windturbinen-Kontrollpunkte schlossen dort mit 3,0 m RMS. Handgezeichnete Spiel- und Sicherheitszonengrenzen sind nur auf einige zehn Meter genau. Diese Genauigkeit wurde in AS-TAC nicht unabhängig verifiziert. Andere Eventdaten ebenfalls als Referenzstand, nicht als aktuelle offizielle Einteilung verstehen.
- Schraffuren/Biohazard-Symbole werden als transparente Flächen mit Originalbezeichnung vereinfacht. Eine „Zivile Zone“ wird nicht als „Safe Zone“ umgedeutet. Verbindlich bleibt die Einweisung des Veranstalters.

### Mahlwinkel audit and Dark Emergency correction (AS-TAC r2)

The original FieldMaps snapshot remains unchanged. `scripts/data/dark-emergency-trace.json`
records an AS-TAC manual retrace of the retained organiser reference image
`reference/tactical-maps/de_2026_taktikkarte.jpg` (DE-39517-2026-1, SHA-256
`b0cf139b6f3fd76a8b10d83d6b46170229f9f4da9c6bb978931eea84ba34edaa`).
`scripts/import-fieldmaps.mjs` additionally executes the pinned FieldMaps
`src/transform.ts` similarity fit against its turbine registry to produce
`src/data/dark-emergency-correction.json`. This adds the missing Miliz safe area,
revises all five safe-area contours and the event perimeter. Image/logos are not
bundled. The measured 4.41 m control residual is not boundary accuracy; contours
are approximate, sometimes obscured by symbols, and require on-site verification.
See `docs/reviews/2026-10-01-fieldmaps.md` for coverage and unresolved HQ boundaries.
