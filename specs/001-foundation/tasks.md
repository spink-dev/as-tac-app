# Geordnete Arbeitspakete

AST-003 implementiert; AST-001-Geräteabnahme weiterhin offen · 2026-10-01. Nach jedem Paket Ergebnis, Prüfkommando und verbleibende Grenzen kurz dokumentieren. Priorität P0 bis zum vollständigen Nutzerauftrag, P1 für spätere Erweiterungen.

| ID | Prio / Phase | Aufgabe | Abhängigkeit | Fertigkriterium |
| --- | --- | --- | --- | --- |
| AST-001 | P0 / M0 | Offline-/GPS-/Renderer-Spike — Implementierung vorhanden, Feldnachweis offen | — | Ein lokales Gebiet, Labels/Icons, Flugmodus-Kaltstart und GPS auf iOS/Android; Messbericht und Renderer-/Paket-ADR |
| AST-002 | P0 / M1 | App-Grundstruktur, Versionskontrolle und Prüfkommandos — implementiert | 001 | Astro/React-App, Manifest, kontrollierter Service Worker, lokale Ressourcen; Build/Checks dokumentiert |
| AST-003 | P0 / M1 | Domäne, Commands, lokale Speicherung — implementiert | 002 | WGS84-Schema, Transaktionen, Autosave-Status, Undo/Redo und Migrationstests |
| AST-004 | P0 / M1 | Gebietspakete verwalten | 003 | Import/Download, Grösse/Quota, Hashprüfung, atomarer Wechsel, Attribution; Abbruch erhält gültigen Stand |
| AST-005 | P0 / M1 | Karteneditor und präzise Ergänzungen | 003, 004 | Punkte, Linien, Flächen/Kreise, Text, Freihand, Attribute, Koordinaten und Messung; Desktop/Touch geprüft |
| AST-006 | P0 / M1 | Teams, Phasen und lokales Briefing | 005 | Zuordnung, Vor/Zurück, Kamera, temporäre Zeichnungen und klare Feldansicht |
| AST-007 | P0 / M1 | Portables Paket und Teilen | 004, 006 | Vollständiger Roundtrip auf zweitem Gerät; begrenzte Dekompression, Hash-/Schemafehler, iOS-Dateiimport |
| AST-008 | P0 / M1 | GPS und mobile Feldnutzung härten | 001, 004 | Genauigkeit/Alter, denied/timeout/stale, Follow/Explore, ausserhalb Gebiet; offline auf Telefon getestet |
| AST-009 | P0 / M2 | Backend wählen, Auth/Membership und dauerhafte Sync-Basis | 003 | Backend-ADR, Rollenmatrix, API-/Storage-/Subscription-Schutz, transaktionale Objektversionen/Sequenzen |
| AST-010 | P0 / M2 | Gleichzeitige Bearbeitung und Live-Mitgliederansicht | 005, 009 | Zwei Admins bearbeiten unabhängig, Viewer sieht bestätigte Änderungen; direkte Viewer-Mutation scheitert |
| AST-011 | P0 / M2 | Konflikte, Offline-Entwürfe und Reconnect | 010 | Konflikt-UI, deduplizierte Wiederholung, Event-Lücken, Snapshot-Replay, Rollenentzug; A04–A06 bestanden |
| AST-012 | P0 / M2 | Gemeinsames Online-Briefing | 006, 010 | Ein Präsentationsleiter, freiwilliges Folgen, unabhängige Ansicht; Reconnect verändert Plan nicht |
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

Nächster Auftrag: **AST-004**, Gebietspakete verwalten und freie Gebietsauswahl vorbereiten. AST-001-Geräteabnahme und Hosting-Nachweis bleiben offen. AST-003 enthält noch keine Zeichenwerkzeuge, Team-/Phasenoberfläche oder portable Paketimporte.
