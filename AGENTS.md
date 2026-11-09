# as-tac — Projektkontext

Privates Projekt von Samuel Spink, kein Neovo-Kundenprojekt. AS-TAC 1.0 ist die Neuentwicklung, die as-tac 0.6 (Astro, echte OSM-Karten) und TacMap 0.12 (Bildkarten, umfangreiche Werkzeuge) zusammenführt. Vor der Arbeit lesen: `PRODUCT.md`, `DESIGN.md`, `CREDITS.md`, dann die betroffenen Module.

## Stack

Vite 8 · React 19 · TypeScript 7 · MapLibre GL 6 · Zustand 5 + Immer 11 · Dexie 4 (IndexedDB) · Zod 4 · fflate · osmtogeojson · Supabase JS (optional, nur Live) · GSAP + Lenis (Bewegung) · lucide-react · vite-plugin-pwa. Astro wurde mit 1.0 bewusst abgelöst (reine Client-App, ein React-Baum).

```sh
npm ci
npm run dev        # Port 9000, ohne Service Worker
npm run check      # tsc + vitest + build
npm run preview    # Port 4000, Produktionsbuild mit Service Worker
node tests/e2e/smoke.mjs && node tests/e2e/tools.mjs   # gegen laufende Preview
```

## Nicht verhandelbar

1. Jede Geometrie ist WGS84 `[longitude, latitude]`. Bildkarten liegen über vier Eckkoordinaten auf der Karte (`ImageOverlay.corners`), nie in Bildpixeln.
2. Kernfunktionen (Planen, Feld, Briefing, Import/Export) funktionieren ohne Netz. Netzwerk nur für bewusste Aktionen: Gebietsdownload (Overpass), Ortssuche (Nominatim), Live-Zusammenarbeit.
3. Projektänderungen laufen über `mutate(...)` aus `src/core/store/project.ts`. Die Undo-Historie besteht aus Entitäts-Operationen (`src/core/store/diff.ts`), nicht aus Index-Patches; Rückgängig überschreibt keine Objekte, die ein Live-Partner inzwischen geändert hat.
4. Importierte Daten sind nicht vertrauenswürdig: Grössenlimits, SHA-256, Zod-Validierung, MIME-Allowlist (nur passive Typen im Asset-Speicher).
5. Eigene GPS-Position wird nie automatisch gespeichert oder übertragen. Eine Pfadaufnahme wird nur auf ausdrücklichen Wunsch als Track gespeichert.
6. Zuschauer (Live-Rolle `viewer`) und der Feldmodus schreiben keine Plandaten (Panels prüfen `canEdit()`). Einzige Ausnahme im Feldmodus: Protokolleinträge anhängen (`canLog()`) und eine ausdrücklich gestartete Pfadaufnahme als Track speichern. Zuschauer dürfen keine gemeinsamen Live-Daten schreiben — auch serverseitig per RLS durchgesetzt.
7. Streamer Safe ist eine Datenschutz-Ansicht: Er ändert weder Modus, Werkzeug, Entwurf, Auswahl noch Panels. Streamer-Zeichnungen sind sitzungsgebunden. Briefing-Zeichnungen sind temporär, ausser «Briefing-Zeichnungen behalten» ist bewusst aktiviert (`briefingOnly`).
8. Tastenkürzel nur über `src/core/shortcuts/registry.ts`; Hierarchie Werkzeug → Ziffer (M/R/Z/D/U). Eigene Belegungen sind Gerätepräferenz, nie Projektinhalt.
9. Keine fremden Event-Assets (Logos, Kartenbilder) ins Repository. Bekannte Eventkarten werden nur per SHA-256 erkannt und ausgerichtet, wenn Nutzer sie selbst importieren (`src/core/templates/knownImages.ts`).
10. FieldMaps-Übernahmen mit Quelle, Commit und Zieldatei in `CREDITS.md` nennen. OSM-Attribution sichtbar halten (© OpenStreetMap, ODbL).
11. Touch-Ziele mindestens 48 px auf groben Zeigern, sichtbarer Fokus, Safe Areas, reduzierte Bewegung respektieren.
12. Keine bestandenen Offline-/Sensor-/Mehrgeräteprüfungen behaupten, die nicht durchgeführt wurden.

## Code-Stil

Bei Brace-Sprachen stets geschweifte Klammern und Körper auf Folgezeilen verwenden. Deutsche Oberfläche in Schweizer Schreibweise (ss statt ß), Englisch als zweite Sprache in `src/i18n/strings.ts`.

## Architektur

- `src/core/model` — Zod-Schema, Fabriken, Geometrie-Operationen
- `src/core/store` — Projekt (Undo/Redo, Diff), UI-, Präferenz-, Routen- und Dialogzustand
- `src/core/storage` — Dexie, Asset-Speicher (SHA-256), Autosave
- `src/core/areas` — Offline-Grundkarten: mitgelieferte Gebiete, Overpass-Download, Dateien
- `src/core/files`, `src/core/legacy` — `.astac`-Format, Import von `.tacmap` und as-tac 0.x
- `src/core/live` — Live-Zusammenarbeit (Supabase oder lokaler Testmodus über BroadcastChannel)
- `src/map` — MapLibre: Grundkartenstil, Planebenen, Symbole, Interaktion, Überlagerungen
- `src/features` — Oberflächen: Bibliothek, Arbeitsbereich, Panels, Feld, Briefing, Teilen, Live
- `supabase/migrations` — Live-Schema mit RLS; nur Publishable Key im Browser, nie Service-Role
