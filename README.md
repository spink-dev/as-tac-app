# as-tac

Privates Projekt von Samuel Spink: Offline-/Online-Kartenplanung und Briefings mit Astro. Die Kartenfunktionalität aus **AST-001** ist integriert: React + MapLibre, lokale OSM-Gebiete Mahlwinkel und Zürich/Benglen, installierbare PWA, kontrollierter Offline-Cache und eigene GPS-Position ohne Standortübertragung.

**Stand 2026-10-01:** AST-003 mit lokalen Projekten, Autosave und Undo/Redo implementiert; Produktions-Browsertests vorhanden; reale Abnahme auf iPhone 16 Pro und Samsung Galaxy A24 noch ausstehend. Editor, Planpakete und Online-Kollaboration sind noch nicht implementiert.

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

Für Telefone muss `dist/` über vertrauenswürdiges HTTPS erreichbar sein. Eine unverschlüsselte LAN-IP unterstützt den benötigten GPS-/Service-Worker-Kontext nicht. Branch-/URL-Zuordnung siehe unten; die konkrete Hosting-Konfiguration liegt ausserhalb dieses Repository-Standes. Dockerfile liefert den statischen Build über Nginx/Port 80; davor ist für Telefone HTTPS nötig (Docker noch nicht getestet).

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

Das neue Gebiet mit ID, Name und Bounds in `src/config/maps.json` aufnehmen. Diese Datei steuert Auswahl, Downloader-Presets und Build-Prüfung gemeinsam. Die UI bietet derzeit ausschliesslich Mahlwinkel und Zürich/Benglen. Freie Gebietsauswahl mit Download/Quota/Abbruch folgt in AST-004. Der Downloader bezieht ausgewählte OSM-Objektklassen über Overpass, keine Standard-OSM-Tiles. Metadaten/Hashes stehen neben den GeoJSON-Dateien.

## Projektwissen

- Dauerhafter Kontext: Vault `projects/as-tac/README.md`.
- [Specs](specs/001-foundation/README.md), [Plan](specs/001-foundation/plan.md), [Aufgaben](specs/001-foundation/tasks.md).
- [Credits und Herkunft](CREDITS.md), auch offline in der App verfügbar.
- Die separate Prüfstand-Oberfläche bleibt auf `feature/ast-001-mobile-proof`; `main` enthält die Karten-App ohne Testanweisungen und Messwert-Panel. Remote `origin`: `git@github.com:spink-dev/as-tac-app.git`.

Danke an **[FieldMaps](https://github.com/rwolffgang/FieldMaps) von [@rwolffgang](https://github.com/rwolffgang)** für die technische Referenz und Erlaubnis zur Wiederverwendung. Mahlwinkel-Gebietsgrenzen übernommen, kein Referenzcode oder Event-Asset kopiert. Karten: **© OpenStreetMap contributors**, ODbL 1.0.

## App-Grundstruktur (AST-002)

- `src/app/App.tsx`: zusammenhängende React-App innerhalb der Astro-Einstiegsseite.
- `src/features/map/MapView.tsx`: MapLibre-Lifecycle, lokale Kartendaten, Labels und Positionsebene.
- `src/core/location/useLocation.ts`: GPS-Freigabe, Fix/Alter/Fehler und Aufräumen; ohne Karten- oder Netzabhängigkeit.
- `src/core/useOfflineApp.ts`: Registrierung, Cache-Prüfung, Speicheranfrage und bewusster Update-Neustart.
- `src/core/offline.ts` und `src/core/service-worker.js`: Nachrichtenaustausch und versionierter Cache.
- `src/config/maps.json`: gemeinsame Konfiguration vorbereiteter Gebiete.
- `src/i18n/de.ts`: deutsche App-Texte; weitere Sprache noch nicht implementiert.

Der Service Worker aktiviert Updates erst auf ausdrücklichen Klick. Ein fehlerhaftes Ressourcenpaket ersetzt keine gültige Version. Alte Caches bleiben für offene Tabs erhalten; Bereinigung und dynamische Gebietspakete folgen in AST-004. Keine Projektpersistenz oder Editor-Funktion in AST-002 vorgezogen.

## Branches und Deployment

| Branch | Zweck | Ziel-URL |
| --- | --- | --- |
| `main` | aktuelle Produktion der neu entwickelten App | `https://test-prod.as-tac.dev` |
| `testing` | Integration und Preview vor Übernahme nach main | `https://test.as-tac.dev` |
| `feature/*` | einzelne Umsetzungsschritte | keine feste URL |
| `feature/ast-001-mobile-proof` | archivierter mobiler Prüfstand | keine Produktionszuordnung |

Die URL-Zuordnung ist die Vorgabe des Nutzers. `testing` wird als Git-Deploy-Quelle bereitgestellt; Hosting-Provider, Domain-/TLS-Anbindung und automatische Deploy-Trigger sind hier nicht eingerichtet oder verifiziert. Beide Umgebungen verwenden denselben Build-Befehl `npm ci && npm run build` und das Verzeichnis `dist/`. Beim Docker-Build wird dieses Verzeichnis über Port 80 ausgeliefert; HTTPS übernimmt der Host/Proxy. Die Origins besitzen getrennte Offline-Caches und Standortfreigaben.

[AST-002-Nachweis](specs/001-foundation/evidence/ast-002-foundation.md) · [AST-003-Nachweis](specs/001-foundation/evidence/ast-003-local-projects.md). Nächster Umsetzungsschritt: **AST-004 — Gebietspakete mit freier Gebietsauswahl**.

## Lokale Projekte (AST-003)

Gebiet auswählen, Projektnamen eingeben und „Projekt erstellen“. Das Projekt lässt sich ohne Konto öffnen, umbenennen, duplizieren oder nach Bestätigung löschen. Name und Gebiet speichern automatisch; „Auf diesem Gerät gespeichert“ erscheint erst nach erfolgreicher Transaktion. Undo/Redo umfasst die letzten 50 Aktionen der geöffneten Sitzung (zusammenhängendes Tippen zählt als eine Aktion). Nach erneutem Öffnen beginnt die Undo-Historie neu; beim App-Start öffnet sich das alphabetisch erste lesbare Projekt.

`src/core/projects/` enthält das WGS84-Modell, reversible Commands, die IndexedDB-Transaktionen und den Sitzungszustand. `src/features/projects/` enthält die Oberfläche. Der erste lokale Datenstand nutzt Schema 1; keine erfundene Migration für AST-001/002, die keine Projekte gespeichert haben. Explizite spätere Migrationen sichern den Originaldatensatz in derselben Transaktion und ersetzen ihn nur nach Validierung. Unbekannte Formate bleiben unangetastet und können als Original-JSON gesichert werden.

Speicherfehler und Änderungen in einem anderen Tab verhindern stilles Überschreiben. Der ungespeicherte Entwurf bleibt im aktuellen Tab; Wiederholen, eine neue Projektkopie oder eine JSON-Notfallsicherung sind möglich. Projektwechsel, Löschen und Update-Neustart sind bis zum erfolgreichen Speichern gesperrt. Eine Notfallsicherung ist noch **kein portables Kartenpaket** und besitzt noch keinen Importdialog (AST-007). Browser-/Betriebssystem-Abbruch kann ungespeicherte Änderungen verlieren.

IndexedDB ist pro Origin getrennt: `test.as-tac.dev`, `test-prod.as-tac.dev` und localhost teilen keine Projekte. GPS wird weiterhin weder in Projekte geschrieben noch übertragen. Geometrie-, Team- und Phasenmodelle sind vorbereitet; ihre Bearbeitungsoberflächen folgen in AST-005/006.


## Versionierung und Releases

`package.json` ist die Quelle der App-Version; `package-lock.json`, die Anzeige unter „Über & Quellen“ und `offline-manifest.json.appVersion` stimmen damit überein. Release **v0.1.0** integriert AST-002 und AST-003. Änderungen stehen im [Changelog](CHANGELOG.md).

Release-Stände auf `main` erhalten einen annotierten Git-Tag `vX.Y.Z`. Neue Funktionen erhöhen vor 1.0 die Minor-Version, Fehlerkorrekturen die Patch-Version; inkompatible Änderungen werden ausdrücklich dokumentiert und gegebenenfalls migriert. `testing` enthält die nächste Integration für die Preview. Der vollständige lokale MVP ist mit 0.1.0 noch nicht abgeschlossen.

App-Version, inhaltsbasierte Offline-Cache-Version und Projekt-Schema sind getrennt: Ein Release erhöht das Projektschema nicht automatisch. Schema 1 bleibt in v0.1.0 unverändert. Der Offline-Build berücksichtigt App-Version, Ressourcen und Service-Worker-Code bei seiner Hashbildung.
