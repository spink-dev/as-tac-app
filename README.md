# as-tac

Privates Projekt von Samuel Spink: Offline-/Online-Kartenplanung und Briefings mit Astro. Die Kartenfunktionalität aus **AST-001** ist integriert: React + MapLibre, lokale OSM-Gebiete Mahlwinkel und Zürich/Benglen, installierbare PWA, kontrollierter Offline-Cache und eigene GPS-Position ohne Standortübertragung.

**Stand 2026-10-01:** v0.5.0 auf `main` integriert AST-001–012 und ergänzt den Kartenarbeitsplatz, Ebenen, sechs Mahlwinkel-Eventvorlagen und das Root-Kartenstudio sowie AS-TAC-Branding mit Tag-/Dunkel-/Rotlichtmodus. Echte Supabase-Bereitstellung und Geräteabnahme auf iPhone 16 Pro / Samsung Galaxy A24 bleiben offen.

**Testing 0.5.1-alpha.1:** Mahlwinkel-Ausgabe r2 erweitert den Offline-Ausschnitt und korrigiert Dark Emergency mit fünf Safe-Zone-Polygonen über den Gelände-Flächen. Bestehende Projektkopien bleiben unverändert; unter Karten die Eventkarte erneut speichern. [Datenabgleich und offene Erfassungslücken](docs/reviews/2026-10-01-fieldmaps.md) · [Performance-Review](docs/reviews/2026-10-01-performance.md).

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

Das neue Gebiet mit ID, Name und Bounds in `src/config/maps.json` aufnehmen. Diese Datei steuert Auswahl, Downloader-Presets und Build-Prüfung gemeinsam. Mahlwinkel und Zürich/Benglen sind mitgelieferte Voreinstellungen. Eigene Gebiete lassen sich seit AST-004 auch direkt in der UI herunterladen oder importieren. Der Downloader bezieht ausgewählte OSM-Objektklassen über Overpass, keine Standard-OSM-Tiles. Metadaten/Hashes stehen neben den GeoJSON-Dateien.

## Projektwissen

- Dauerhafter Kontext: Vault `projects/as-tac/README.md`.
- [Specs](specs/001-foundation/README.md), [Plan](specs/001-foundation/plan.md), [Aufgaben](specs/001-foundation/tasks.md).
- [Credits und Herkunft](CREDITS.md), auch offline in der App verfügbar.
- Die separate Prüfstand-Oberfläche bleibt auf `feature/ast-001-mobile-proof`; `main` enthält die Karten-App ohne Testanweisungen und Messwert-Panel. Remote `origin`: `git@github.com:spink-dev/as-tac-app.git`.

Danke an **[FieldMaps](https://github.com/rwolffgang/FieldMaps) von [@rwolffgang](https://github.com/rwolffgang)** für die technische Referenz und Erlaubnis zur Wiederverwendung. Mahlwinkel-Gebietsgrenzen sowie POIs und Event-Geometrien mit exakter Herkunft übernommen; keine Logos oder Kartenbilder kopiert. Karten: **© OpenStreetMap contributors**, ODbL 1.0.

## App-Grundstruktur (AST-002)

- `src/app/App.tsx`: zusammenhängende React-App innerhalb der Astro-Einstiegsseite.
- `src/features/map/MapView.tsx`: MapLibre-Lifecycle, lokale Kartendaten, Labels und Positionsebene.
- `src/core/location/useLocation.ts`: GPS-Freigabe, Fix/Alter/Fehler und Aufräumen; ohne Karten- oder Netzabhängigkeit.
- `src/core/useOfflineApp.ts`: Registrierung, Cache-Prüfung, Speicheranfrage und bewusster Update-Neustart.
- `src/core/offline.ts` und `src/core/service-worker.js`: Nachrichtenaustausch und versionierter Cache.
- `src/config/maps.json`: gemeinsame Konfiguration vorbereiteter Gebiete.
- `src/i18n/de.ts`: deutsche App-Texte; weitere Sprache noch nicht implementiert.

Der Service Worker aktiviert Updates erst auf ausdrücklichen Klick. Ein fehlerhaftes Ressourcenpaket ersetzt keine gültige Version. Alte App-Caches bleiben für offene Tabs erhalten; ihre sichere Bereinigung ist noch offen. Dynamische Gebietspakete liegen seit AST-004 separat in IndexedDB. Keine Projektpersistenz oder Editor-Funktion in AST-002 vorgezogen.

## Branches und Deployment

| Branch | Zweck | Ziel-URL |
| --- | --- | --- |
| `main` | aktuelle Produktion der neu entwickelten App | `https://test-prod.as-tac.dev` |
| `testing` | Integration und Preview vor Übernahme nach main | `https://test.as-tac.dev` |
| `feature/*` | einzelne Umsetzungsschritte | keine feste URL |
| `feature/ast-001-mobile-proof` | archivierter mobiler Prüfstand | keine Produktionszuordnung |

Die URL-Zuordnung ist die Vorgabe des Nutzers. `testing` wird als Git-Deploy-Quelle bereitgestellt; Hosting-Provider, Domain-/TLS-Anbindung und automatische Deploy-Trigger sind hier nicht eingerichtet oder verifiziert. Beide Umgebungen verwenden denselben Build-Befehl `npm ci && npm run build` und das Verzeichnis `dist/`. Beim Docker-Build wird dieses Verzeichnis über Port 80 ausgeliefert; HTTPS übernimmt der Host/Proxy. Die Origins besitzen getrennte Offline-Caches und Standortfreigaben.

[AST-002-Nachweis](specs/001-foundation/evidence/ast-002-foundation.md) · [AST-003-Nachweis](specs/001-foundation/evidence/ast-003-local-projects.md). Weitere Nachweise: [AST-004](specs/001-foundation/evidence/ast-004-packages.md), [AST-005](specs/001-foundation/evidence/ast-005-editor.md), [AST-006](specs/001-foundation/evidence/ast-006-briefing.md). Weitere Nachweise: [AST-007](specs/001-foundation/evidence/ast-007-portable.md), [AST-008](specs/001-foundation/evidence/ast-008-mobile.md). AST-009–012 als Integrationsstand vorhanden; [Nachweis und Grenzen](specs/001-foundation/evidence/ast-010-012-collaboration.md). Nächste Abnahme: echtes Supabase-Testing und AST-014 auf den Geräten.

## Lokale Projekte (AST-003)

Gebiet auswählen, Projektnamen eingeben und „Projekt erstellen“. Das Projekt lässt sich ohne Konto öffnen, umbenennen, duplizieren oder nach Bestätigung löschen. Name und Gebiet speichern automatisch; „Auf diesem Gerät gespeichert“ erscheint erst nach erfolgreicher Transaktion. Undo/Redo umfasst die letzten 50 Aktionen der geöffneten Sitzung (zusammenhängendes Tippen zählt als eine Aktion). Nach erneutem Öffnen beginnt die Undo-Historie neu; beim App-Start öffnet sich das zuletzt verwendete lesbare Projekt (ohne gespeicherte Auswahl das alphabetisch erste).

`src/core/projects/` enthält das WGS84-Modell, reversible Commands, die IndexedDB-Transaktionen und den Sitzungszustand. `src/features/projects/` enthält die Oberfläche. Der erste lokale Datenstand nutzt Schema 1; keine erfundene Migration für AST-001/002, die keine Projekte gespeichert haben. Explizite spätere Migrationen sichern den Originaldatensatz in derselben Transaktion und ersetzen ihn nur nach Validierung. Unbekannte Formate bleiben unangetastet und können als Original-JSON gesichert werden.

Speicherfehler und Änderungen in einem anderen Tab verhindern stilles Überschreiben. Der ungespeicherte Entwurf bleibt im aktuellen Tab; Wiederholen, eine neue Projektkopie oder eine JSON-Notfallsicherung sind möglich. Projektwechsel, Löschen und Update-Neustart sind bis zum erfolgreichen Speichern gesperrt. Eine Notfallsicherung ist noch **kein portables Kartenpaket** ; für den regulären Austausch den vollständigen `.astac.zip`-Export verwenden. Browser-/Betriebssystem-Abbruch kann ungespeicherte Änderungen verlieren.

IndexedDB ist pro Origin getrennt: `test.as-tac.dev`, `test-prod.as-tac.dev` und localhost teilen keine Projekte. GPS wird weiterhin weder in Projekte geschrieben noch übertragen. Geometrie-, Team- und Phasenmodelle werden inzwischen durch die AST-005/006-Oberflächen bearbeitet.


## Versionierung und Releases

`package.json` ist die Quelle der App-Version; `package-lock.json`, die Anzeige unter „Über & Quellen“ und `offline-manifest.json.appVersion` stimmen damit überein. Release **v0.4.0** integriert den bisherigen Stand bis AST-012 auf `main`. Echte Backend- und Geräteabnahme bleiben offen. Änderungen stehen im [Changelog](CHANGELOG.md).

Release-Stände auf `main` erhalten einen annotierten Git-Tag `vX.Y.Z`. Neue Funktionen erhöhen vor 1.0 die Minor-Version, Fehlerkorrekturen die Patch-Version; inkompatible Änderungen werden ausdrücklich dokumentiert und gegebenenfalls migriert. `testing` enthält die nächste Integration für die Preview. Der vollständige lokale MVP ist mit 0.1.0 noch nicht abgeschlossen.

App-Version, inhaltsbasierte Offline-Cache-Version und Projekt-Schema sind getrennt: Ein Release erhöht das Projektschema nicht automatisch. Schema 1 bleibt in v0.1.0 unverändert. Der Offline-Build berücksichtigt App-Version, Ressourcen und Service-Worker-Code bei seiner Hashbildung.

## Preview 0.2.0-alpha.1 — AST-004

Unter „Gebietspakete“ freie kleine WGS84-Grenzen eingeben oder den sichtbaren Ausschnitt übernehmen. Der Download fragt Overpass einmalig ab (keine automatische Wiederholung, mindestens 60 Sekunden Abstand pro Sitzung), prüft Grösse/Hash/Speicher und installiert das Gebiet atomar. Der öffentliche Pilot-Endpunkt ist kein garantierter Produktionsdienst. Kartenpakete lassen sich separat als `.astac-map.json` sichern und offline importieren; dies sind noch keine vollständigen Projektpakete.

Zusätzliche Gebiete liegen in IndexedDB, getrennt von den gebündelten App-Ressourcen. Schema 1 der Projekte bleibt erhalten; DB-Version 2 ergänzt den Store `maps`. Paketimporte überschreiben keine vorhandenen Gebiete. Ein von einem gespeicherten Projekt verwendetes Gebiet lässt sich nicht löschen. Scheitert das Laden eines gewählten Gebiets, bleibt die bisherige Karte mit ausdrücklichem Hinweis sichtbar.

## Preview 0.2.0-alpha.2 — AST-005

Projekt öffnen und „Plan bearbeiten“ wählen. Punkt/Text per Tap, Linien/Flächen per Eckpunkten und „Zeichnung abschliessen“, Kreis mit Mittelpunkt und Rand, Freihand per Ziehen. Nach jeder Zeichnung wieder Auswahlmodus. Escape oder „Zeichnung abbrechen“ verwirft den laufenden Entwurf; Kartenbewegung in Auswahl/Feldansicht erzeugt keine Objekte.

Elemente über Karte oder Liste auswählen. Beschriftung/Notizen/Farbe/Breite und WGS84-Koordinaten pro Zeile unter „Übernehmen“ anwenden. Kreuz verschiebt das ganze Objekt, Punktgriffe verschieben Eckpunkte (bis 200 sichtbare Griffe; längere Linien über die Koordinatenliste). Distanz und Fläche sind sphärische Näherungen, keine Vermessungszusage. Planänderungen speichern über AST-003 und lassen sich rückgängig machen. Sichtbarkeit und Auswahl bleiben lokal. Teams/Phasen ergänzt AST-006 (siehe unten).

## Preview 0.2.0-alpha.3 — AST-006

Unter „Teams & Phasen“ Teams mit Kürzel/Farbe und geordnete Phasen anlegen. Eine neue Phase übernimmt die aktuelle Kamera und zunächst alle Elemente. Im Phasendetail Notizen, sichtbare Elemente und Kamera anpassen; Änderungen bewusst übernehmen. Im Elementdetail Team/Phasen zuordnen. Löschen entfernt Zuordnungen atomar; Undo stellt sie wieder her. Teamkürzel und -farbe erscheinen an der Planbeschriftung.

„Briefing starten“ zeigt die erste Phase samt Kamera und sichtbaren Elementen. Vor/Zurück oder Pfeiltasten wechseln Phasen; Escape bzw. „Briefing beenden“ verlässt die Präsentation. „Temporär zeichnen“ markiert per Maus/Finger, ohne den Plan zu schreiben. Phasenwechsel/Verlassen verwirft Markierungen. „In Plan übernehmen“ erzeugt ausdrücklich persistierte Freihandelemente mit Phasenzuordnung; diese Aktion ist rückgängig machbar. Dieser historische AST-006-Stand ist lokal; AST-012 ergänzt die Online-Präsentation.

Die folgenden AST-007/008 sind inzwischen in v0.3.0 integriert. Aktuelle Branch-Zuordnung und Versionen stehen oben.

### Projektdateien (AST-007)

Unter „Projekt teilen & importieren“ vollständige `.astac.zip` sichern. Auf einem Gerät mit vorbereiteter App öffnen: Karte und Plan werden zusammen als neue schreibgeschützte Kopie gespeichert. „Bearbeitbare Kopie erstellen“ startet einen eigenen lokalen Plan. Enthält keine GPS-Historie oder Online-Zugriffsrechte. Details und Grenzen in `specs/001-foundation/contracts.md`.

### Mobiler GPS-Betrieb (AST-008)

GPS pausiert bei App-Wechsel/Bildschirmsperre und startet nach Rückkehr nur bei zuvor aktivierter Positionsanzeige wieder. Ein alter Fix bleibt bis zum neuen Signal als veraltet markiert. Stopp oder verweigerte Freigabe werden nicht automatisch aufgehoben. Feldtest-Anleitung: `specs/001-foundation/evidence/ast-008-mobile.md`.

## Online-Grundlage (AST-009)

Optionaler Supabase-Integrationsstand: Anmeldung, leere Online-Projekte und Owner/Admin/Viewer-Verwaltung. Einrichtung und Prüfgrenzen unter [supabase/README.md](supabase/README.md), Entscheidung unter [ADR-002](specs/001-foundation/adr-002-online-backend.md). Keine automatische Übertragung lokaler Pläne oder GPS. Der gemeinsame Karteneditor und das Online-Briefing sind als AST-010–012 implementiert.

## Gemeinsame Planung (AST-010–012)

Nach Konfiguration und Anmeldung unter „Online-Projekte & Mitglieder“ das Projekt wählen und „Gemeinsam auf der Karte öffnen“. Änderungen werden serverseitig versioniert; Mitglieder sehen bestätigte Snapshots. Bei Offline-Betrieb einen eigenen Entwurf bearbeiten und nach Anmeldung bewusst mit dem Server abgleichen. Gesicherte Online-Kopien lassen sich ohne Anmeldung öffnen; dort wird nichts publiziert. Ein `.astac.zip` kann auch dort exportiert werden.

„Briefing leiten“ übernimmt die exklusive Leitung, „Präsentation folgen“ ist freiwillig. Andere Admins können unabhängig weiter planen. Bei Netzverlust läuft die Leitung aus. [Implementierungsnachweis](specs/001-foundation/evidence/ast-010-012-collaboration.md) und [offene Feldabnahme](specs/001-foundation/evidence/ast-014-field-acceptance.md).

## Kartenarbeitsplatz (0.5.0-alpha.1)

- **Orientierung:** Karte, eigenes GPS und lesbare Objekte. Ebenen unter dem Panel ein-/ausblenden oder für die eigene Ansicht transparenter machen.
- **Planung:** aktive Zeichenebene wählen, über bestehenden Objekten zeichnen, Überlagerungen gezielt auswählen; Deckkraft, Reihenfolge und Sperren speichern. Unübernommene Objektangaben vor einem Tabwechsel übernehmen oder verwerfen.
- **Briefing:** Phasen zeigen, temporär zeichnen, optional online präsentieren/folgen.
- **Karten:** Mahlwinkel-Event wählen und offline speichern. Unter „Eigenes Gebiet laden oder importieren“ Kartenausschnitt übernehmen, OSM herunterladen oder `.astac-map.json` einlesen. Offline-Dateien hier prüfen.
- **Projekt:** gespeicherte Pläne, bearbeitbare Kopien, `.astac.zip`, Zusammenarbeit, Quellen und Kartenstudio.

Mahlwinkel enthält Mission 24H, Dark Emergency, Operation Tschernobyl, Light Sim, Airsoft Days und Lost Airfield als getrennte FieldMaps-Referenzstände. Positionen behalten stabile Quell-IDs, Labels/Zonen bleiben je Event unabhängig. Downloads sind schreibgeschützt; „Bearbeitbare Kopie erstellen“ erzeugt einen eigenen Entwurf. Keine Aussage über die aktuelle offizielle Event-Einteilung.

Schema 1 bleibt lesbar. Erst das Anlegen von Ebenen oder Event-Metadaten erweitert ein Projekt auf Schema 2; diese Änderung ist rückgängig machbar und sichert beim Speichern den vorherigen Datensatz atomar. Alte App-Versionen können Schema 2 nicht bearbeiten. ZIP-Format 1 bleibt erhalten und transportiert das angegebene Projektschema. Exportierte Pakete enthalten Karte, Ebenen, Quellen und lokale Lizenztexte.

Das Kartenstudio nutzt den vorhandenen Planeditor zur Datenproduktion. Gelände-ID, Event-ID, Ausgabe und Quellen unter Projekt erfassen; zum Veröffentlichen ist eine separate serverseitige Root-Berechtigung erforderlich. Katalog enthält höchstens die 100 neuesten Ausgaben in seiner aktuellen Liste. Bereits veröffentlichte Ausgaben bleiben unverändert; neue Ausgabe bewusst herunterladen. Keine automatische Verteilung oder Migration im Hintergrund.

[Redesign-Spezifikation](specs/002-map-workspace/spec.md) · [Designregeln](DESIGN.md) · [Prüfstand und Grenzen](specs/002-map-workspace/evidence.md).
