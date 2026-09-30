# as-tac

Privates Projekt von Samuel Spink: Offline-/Online-Kartenplanung und Briefings mit Astro. Die Kartenfunktionalität aus **AST-001** ist integriert: React + MapLibre, lokale OSM-Gebiete Mahlwinkel und Zürich/Benglen, installierbare PWA, kontrollierter Offline-Cache und eigene GPS-Position ohne Standortübertragung.

**Stand 2026-10-01:** Produktions-Browsertests vorhanden; reale Abnahme auf iPhone 16 Pro und Samsung Galaxy A24 noch ausstehend. Editor, Planpakete und Online-Kollaboration sind noch nicht implementiert.

## Starten

Node.js >=22.12.0. Installation anhand des Lockfiles:

```sh
npm ci
npm run check
npm run build
npm run preview -- --background
```

Vorschau unter `http://localhost:4000`. `npx astro preview stop` beendet sie. Entwicklung: `npm run dev -- --background` auf Port 9000; der Service Worker wird nur im Produktionsbuild registriert. Entwicklung und Preview verwenden getrennte Origins, damit kein alter Offline-Build die Entwicklung verdeckt.

```sh
npx playwright install chromium
npm test
```

Tests starten ihren eigenen Produktions-Preview auf Port 4000. Eine laufende manuelle Preview davor mit `npx astro preview stop` beenden. `npm run build` vor den Tests ausführen.

Für Telefone muss `dist/` über vertrauenswürdiges HTTPS erreichbar sein. Eine unverschlüsselte LAN-IP unterstützt den benötigten GPS-/Service-Worker-Kontext nicht. Hosting wurde noch nicht gewählt oder veröffentlicht. Dockerfile liefert den statischen Build über Nginx/Port 80; davor ist für Telefone HTTPS nötig (Docker noch nicht getestet).

## Offline und GPS testen

1. App online öffnen, beide Gebiete ansehen, „Offline bereit · Dateien geprüft“ abwarten.
2. Optional „Speicher sichern“, dann PWA installieren bzw. unter Safari zum Home-Bildschirm hinzufügen.
3. Browser/App vollständig schliessen, Flugmodus und WLAN aus, erneut öffnen. Beide Gebiete bleiben auswählbar.
4. Draussen „Meine Position“ drücken. Genauigkeit, Fix-Alter und Fehlerzustände beobachten. Manuelles Verschieben pausiert Follow. Positionen ausserhalb des vorbereiteten Gebiets werden als solche gemeldet.

GPS-Daten werden weder gespeichert noch übertragen. Nach 30 Sekunden ohne Fix oder bei Fehler/Stop erscheint die letzte Position als veraltet. Hintergrundtracking ist nicht zugesagt. Browser können lokale Daten löschen; „Offline bereit“ bestätigt die momentane Integritätsprüfung, keine dauerhafte Speicherzusage.

[Geräteprotokoll und Messwerte](specs/001-foundation/evidence/ast-001-mobile.md) · [Renderer-/Paket-ADR](specs/001-foundation/adr-001-offline-renderer.md).

## Karten aktualisieren

Die OSM-Daten sind bereits enthalten; normale Builds benötigen keinen OSM-Download. Bewusste Aktualisierung:

```sh
npm run map:fetch -- mahlwinkel
npm run map:fetch -- benglen
npm run build
```

Eigene kleine Gebiete lassen sich bereits zur Build-Zeit vorbereiten:

```sh
MAP_BOUNDS='[8.52,47.36,8.55,47.38]' MAP_NAME='Zürich Zentrum' npm run map:fetch -- zuerich-zentrum
```

Die neue ID anschliessend zur Gebietsauswahl in `src/features/map/MapApp.tsx` hinzufügen. Die UI bietet derzeit ausschliesslich Mahlwinkel und Zürich/Benglen. Freie Gebietsauswahl mit Download/Quota/Abbruch folgt in AST-004. Der Downloader bezieht ausgewählte OSM-Objektklassen über Overpass, keine Standard-OSM-Tiles. Metadaten/Hashes stehen neben den GeoJSON-Dateien.

## Projektwissen

- Dauerhafter Kontext: Vault `projects/as-tac/README.md`.
- [Specs](specs/001-foundation/README.md), [Plan](specs/001-foundation/plan.md), [Aufgaben](specs/001-foundation/tasks.md).
- [Credits und Herkunft](CREDITS.md), auch offline in der App verfügbar.
- Die separate Prüfstand-Oberfläche bleibt auf `feature/ast-001-mobile-proof`; `main` enthält die Karten-App ohne Testanweisungen und Messwert-Panel. Remote `origin`: `git@github.com:spink-dev/as-tac-app.git`.

Danke an **[FieldMaps](https://github.com/rwolffgang/FieldMaps) von [@rwolffgang](https://github.com/rwolffgang)** für die technische Referenz und Erlaubnis zur Wiederverwendung. Mahlwinkel-Gebietsgrenzen übernommen, kein Referenzcode oder Event-Asset kopiert. Karten: **© OpenStreetMap contributors**, ODbL 1.0.
