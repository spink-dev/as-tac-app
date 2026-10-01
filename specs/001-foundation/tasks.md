# Geordnete Arbeitspakete

Offline-Stack bis AST-008 in 0.3.0 integriert; AST-009–012 als Preview implementiert; AST-001-Geräteabnahme weiterhin offen · 2026-10-01. Nach jedem Paket Ergebnis, Prüfkommando und verbleibende Grenzen kurz dokumentieren. Priorität P0 bis zum vollständigen Nutzerauftrag, P1 für spätere Erweiterungen.

| ID | Prio / Phase | Aufgabe | Abhängigkeit | Fertigkriterium |
| --- | --- | --- | --- | --- |
| AST-001 | P0 / M0 | Offline-/GPS-/Renderer-Spike — Implementierung vorhanden, Feldnachweis offen | — | Ein lokales Gebiet, Labels/Icons, Flugmodus-Kaltstart und GPS auf iOS/Android; Messbericht und Renderer-/Paket-ADR |
| AST-002 | P0 / M1 | App-Grundstruktur, Versionskontrolle und Prüfkommandos — implementiert | 001 | Astro/React-App, Manifest, kontrollierter Service Worker, lokale Ressourcen; Build/Checks dokumentiert |
| AST-003 | P0 / M1 | Domäne, Commands, lokale Speicherung — implementiert | 002 | WGS84-Schema, Transaktionen, Autosave-Status, Undo/Redo und Migrationstests |
| AST-004 | P0 / M1 | Gebietspakete verwalten — implementiert, Anbieter-/Geräteprüfung offen | 003 | Import/Download, Grösse/Quota, Hashprüfung, atomarer Wechsel, Attribution; Abbruch erhält gültigen Stand |
| AST-005 | P0 / M1 | Karteneditor und präzise Ergänzungen — implementiert, Geräteabnahme offen | 003, 004 | Punkte, Linien, Flächen/Kreise, Text, Freihand, Attribute, Koordinaten und Messung; Desktop/Touch geprüft |
| AST-006 | P0 / M1 | Teams, Phasen und lokales Briefing — implementiert | 005 | Zuordnung, Vor/Zurück, Kamera, temporäre Zeichnungen und klare Feldansicht |
| AST-007 | P0 / M1 | Portables Paket und Teilen — implementiert, iOS-Abnahme offen | 004, 006 | Vollständiger Roundtrip auf zweitem Gerät; begrenzte Dekompression, Hash-/Schemafehler, iOS-Dateiimport |
| AST-008 | P0 / M1 | GPS und mobile Feldnutzung härten — implementiert, Feldabnahme offen | 001, 004 | Genauigkeit/Alter, denied/timeout/stale, Follow/Explore, ausserhalb Gebiet; offline auf Telefon getestet |
| AST-009 | P0 / M2 | Backend, Auth/Membership und Sync-Basis — Implementierungsstand vorhanden, Supabase-Integration offen | 003 | Backend-ADR, Rollenmatrix, API-/Storage-/Subscription-Schutz, transaktionale Objektversionen/Sequenzen |
| AST-010 | P0 / M2 | Gleichzeitige Bearbeitung und Live-Mitgliederansicht — implementiert, Live-Integration offen | 005, 009 | Zwei Admins bearbeiten unabhängig, Viewer sieht bestätigte Änderungen; direkte Viewer-Mutation scheitert |
| AST-011 | P0 / M2 | Konflikte, Offline-Entwürfe und Reconnect — implementiert, Live-Integration offen | 010 | Konflikt-UI, deduplizierte Wiederholung, Event-Lücken, Snapshot-Replay, Rollenentzug; A04–A06 bestanden |
| AST-012 | P0 / M2 | Gemeinsames Online-Briefing — implementiert, Live-Integration offen | 006, 010 | Ein Präsentationsleiter, freiwilliges Folgen, unabhängige Ansicht; Reconnect verändert Plan nicht |
| AST-013 | P0 / M1–M3 | Credits und Quellen pflegen | Ab erster Übernahme | CREDITS-Inventar, FieldMaps/@rwolffgang in App/README, OSM-Attribution und lokale Lizenzhinweise |
| AST-014 | P0 / M3 | End-to-End-Feldabnahme | 007, 008, 011, 012, 013 | A01–A10 auf Produktionsbuild; Gerätematrix und Messwerte; offene Fehler vor Ablösung bewertet |
| AST-015 | P1 | Alte `.tacmap`-Projekte importieren | 007 | Explizite Format-/Koordinatenmigration, unkalibrierte Bildkarte korrekt behandeln; vor Bedarf prüfen |
| AST-016 | P1 | Weitere Karten, private Notizen, optionale Teampositionen | 014 | Separate Specs und ausdrückliche Produktentscheidung statt stiller Scope-Erweiterung |

## Definition of Done pro Meilenstein

- Verhalten anhand Spec nachgewiesen und fehlende Nachweise offen benannt.
- Keine falschen Speicher-/Live-/GPS-Erfolgsmeldungen.
- Quelldateien, übernommener Code und relevante Entscheidungen dokumentiert.
- M1-Abnahme erfüllt lokalen Ablauf; vollständiger Auftrag bleibt bis M2/M3 offen.

## Kurzer Startauftrag für die nächste Implementierung

„Implementiere AST-001 in as-tac-app. Lies AGENTS.md, Vault projects/as-tac/README.md und dieses Spec-Paket. Behalte Astro, prüfe React + MapLibre mit einem kleinen lokalen OSM-Gebiet. Beweise Offline-Kaltstart und eigene GPS-Anzeige; dokumentiere reale Geräteprüfungen getrennt von Simulationen. Nutze FieldMaps als Referenz, erfasse jede Codeübernahme in CREDITS.md. Keine vorgezogene vollständige TacMap-Portierung.“

## AST-001 — aktueller Stand

React-/MapLibre-Prüfstand, Mahlwinkel und Zürich/Benglen, Offline-Cache mit Ressourcenprüfung und GPS-Anzeige implementiert. [ADR](adr-001-offline-renderer.md) und [Nachweisprotokoll](evidence/ast-001-mobile.md) dokumentieren die Abnahmegrenze. AST-002-Grundlagen (Git, Manifest, Build-/Check-Kommandos) wurden nur soweit für diesen Nachweis erforderlich vorgezogen. M0 bleibt bis zur realen iPhone-16-Pro-/Galaxy-A24-Prüfung offen.

AST-004 erhält zusätzlich eine freie Gebietsauswahl als Nutzerwunsch vom 2026-10-01; nicht auf zwei Demo-Gebiete beschränken.

## AST-002 — abgeschlossen auf Implementierungsebene

App ohne Prüfstand-Oberfläche, getrennte Karten-/GPS-/Offline-Module, gemeinsame Gebietskonfiguration, deutsche Sprachdatei und vorhandene Build-/Check-Kommandos. Kontrolliertes Update und Erhalt der gültigen Offline-Version bei fehlerhaftem Update sind automatisiert geprüft. [Nachweis](evidence/ast-002-foundation.md).

Fortsetzung trotz noch offener AST-001-Geräteabnahme ausdrücklich vom Nutzer beauftragt; daraus folgt keine bestandene M0-Abnahme. AST-003 folgte als nächster Auftrag; freie Gebietsauswahl gehört zu AST-004 und Online-Kollaboration zu M2. Feature-Stände werden zunächst nach `testing` (`test.as-tac.dev`) übernommen; `main` gehört zu `test-prod.as-tac.dev`.


## AST-003 — abgeschlossen auf Implementierungsebene

Validiertes WGS84-Modell, atomare reversible Commands, lokale Projekte mit Autosave nach Commit, sitzungsbezogenes Undo/Redo und Revisionsprüfung gegen parallele Tabs. Speicherfehler bewahren den Entwurf; Migrationstransaktionen sichern Originale und rollen Fehler vollständig zurück. 16 automatisierte Tests einschliesslich realer Browser-IndexedDB und Offline-Prozessneustart bestanden. [Nachweis](evidence/ast-003-local-projects.md).

Auf AST-003 folgte **AST-004**, Gebietspakete und freie Gebietsauswahl. AST-001-Geräteabnahme und Hosting-Nachweis bleiben offen. AST-003 enthält noch keine Zeichenwerkzeuge, Team-/Phasenoberfläche oder portable Paketimporte.

## AST-004 — Preview-Checkpoint

Freie Bounds/Ausschnittsauswahl, begrenzter Download, importierbare OSM-GeoJSON-Pakete, Hash-/Quota-Prüfung, atomare Installation und Löschschutz für Projektreferenzen. Datenbank-Upgrade erhält bestehende Projekte. Automatisierte Providerantworten ersetzen keinen Live-Overpass-/iPhone-Nachweis. Weiter mit AST-005; siehe `evidence/ast-004-packages.md`.

## AST-005 — Preview-Checkpoint

Sechs Geometrietypen, Planungs-/Feldmodus, Attribute/Koordinaten, Messungen, Auswahl/Suche, lokale Sichtbarkeit, Objekt-/Vertexverschieben und Undo/Redo. Desktop und Chromium-Touchautomation geprüft, keine reale Geräteabnahme. Siehe `evidence/ast-005-editor.md`. Weiter mit AST-006.

## AST-006 — Preview-Checkpoint

Teams/Phasen bearbeiten, zuordnen, atomar bereinigen und rückgängig machen. Offline-Briefing mit Kamera, Elementsichtbarkeit, Reihenfolge und temporären Markierungen; nur bewusste Übernahme schreibt den Plan. Nächster Umsetzungsschritt ist AST-007 (portables vollständiges Projektpaket). AST-008/014 benötigen weiterhin echte Telefone und Feldabnahme. Siehe `evidence/ast-006-briefing.md`.

## AST-007 — Preview-Checkpoint

Vollständiger Datei-Roundtrip in isolierten Chromium-Profilen einschliesslich Offline-Neustart. Begrenzter ZIP-Leser, Hash-/Schema-Prüfung, atomarer Import und schreibgeschützte Kopie. Geräteabnahme offen; siehe `evidence/ast-007-portable.md`.

## AST-008 — Preview-Checkpoint

GPS-Watch im Hintergrund stoppen, expliziten Nutzerwunsch im Speicher behalten und im Vordergrund genau einmal neu starten. Bis zum neuen Fix bleibt die letzte Position veraltet. Alte Watch-Callbacks, rückläufige und mehr als fünf Sekunden zukünftige Zeitstempel werden verworfen; bei über 50 m Genauigkeitsradius erscheint eine Warnung. Stop/Freigabeentzug starten nach Rückkehr nicht automatisch neu. Sensorautomation bestanden, reale Geräteprüfung weiterhin offen (`evidence/ast-008-mobile.md`). Nächster Implementierungsschritt: AST-009.

## AST-009 — Integrationsstand

SQL-/Client-Grundlage und Mitgliederoberfläche implementiert. Vier echte PostgreSQL-Logiktests unter PGlite; konfigurierter Browserflow mit kontrollierten API-Antworten. Echter Supabase-/Mehrverbindungs-/Subscription-Nachweis offen. Nächster UI-Schritt AST-010; Produktionsfreigabe des Backends erst nach Integrationsgate. Siehe ADR-002 und `evidence/ast-009-online.md`.

## AST-010–012 — Preview-Stack 0.4.0-alpha.2

Gemeinsamer Editor, sequenzierte Snapshots, Offline-Kopien/Entwürfe, ausdrücklicher Konfliktabgleich, Rechteentzug und exklusive Briefing-Leitung mit freiwilligem Folgen. Nachweis unter `evidence/ast-010-012-collaboration.md`. Der bisherige nächste UI-Schritt AST-010 ist damit umgesetzt. Offen bleiben echte Supabase-Integration, Mehrverbindungs-/Lastmessung und die vorbereitete AST-014-Feldabnahme. Keine bestandene Telefonprüfung aus Browserautomation ableiten.
