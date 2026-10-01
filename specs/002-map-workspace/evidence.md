# Prüfstand — Kartenarbeitsplatz 0.5.0-alpha.1

Stand 2026-10-01. Bisherige Funktionalität als v0.4.0 (`8d252fa`) nach main integriert und gepusht; Redesign auf separater Feature-Branch für testing.

## Nachgewiesen

- `npm run check`: 57 Dateien, keine Fehler/Warnungen/Hinweise.
- Normaler Produktionsbuild: erfolgreich, finaler Offline-Stand `13deec2c8f909861`, 18 Ressourcen, 4 010 646 Bytes; kein Test-Backend eingebaut.
- Vollständiger normaler Lauf: 50 bestanden, ein konfigurationsabhängiger Browserfall separat ausgeführt. Nach den letzten Schutzkorrekturen gezielter Lauf Editor/Projekte/Workspace: 18 bestanden, einschliesslich neuem atomarem Format-Backup-Test.
- Konfigurierter PostgreSQL-/UI-Lauf: 15 bestanden. Nach letzten UI-Schutzkorrekturen beide konfigurierten Browserfälle erneut bestanden. Supabase-HTTP/Auth im Browser kontrolliert; reale Projekt-/Rollen-/Publikationslogik in PGlite ausgeführt.
- Alle sechs FieldMaps-Eventvorlagen validiert; gemeinsame POI-Quell-IDs, voneinander unabhängige Eventlabels/Geometrien, korrekt remappte Layer-IDs nach Duplizieren.
- Browser: Event offline installieren, schreibgeschützt öffnen, bearbeitbare Kopie, eigene Ebene zeichnen, Sichtbarkeit/Sperren, Export und Import auf isolierter Offline-Browserinstanz. Neustart öffnet den zuletzt aktiven Plan.
- Browser: Objektattribute sperren Tabwechsel bis Übernahme/Verwerfen; Überlagerungsauswahl zeigt mehrere Treffer; aktive Zeichenwerkzeuge wählen nicht die darunterliegenden Objekte.
- SQL: Owner/Admin dürfen nicht Root publizieren oder sich selbst Root zuweisen. Administrativ zugewiesener Root darf eine neue Ausgabe veröffentlichen, keine vorhandene überschreiben. Öffentliche Katalogleser erhalten nur publizierte Ausgaben; direkter Tabellenzugriff bleibt gesperrt. Entzug wirkt auf den nächsten Publikationsaufruf.
- Mobile (393 × 852) und Desktop (1440 × 1000) visuell geprüft. Browserbilder unter `test-results/workspace-mobile.png` und `test-results/workspace-desktop.png`; Testartefakte nicht versioniert.

## Grenzen

Kein Deploymentbeweis für test.as-tac.dev. Kein externes Supabase-Projekt eingerichtet, keine Cloud-Migration angewendet, kein reales Root-Konto vergeben. Einrichtung: `supabase/README.md`. PGlite besitzt eine einzelne Verbindung; echte parallel laufende Datenbankverbindungen, Auth/JWT und Netzabbrüche zwischen Geräten separat prüfen.

Kein neuer Feldnachweis auf iPhone 16 Pro / Samsung Galaxy A24. FieldMaps-Referenzstand ist keine aktuelle Veranstalterfreigabe; manuell abgeleitete Grenzen nicht unabhängig vermessen. Keine Logos/Kartenbilder übernommen. Kartenquellen bleiben offline zugänglich.

Native Systemschrift; bestehende grosse Karten-/App-Bundles verursachen weiterhin den Vite-Hinweis auf Chunks > 500 kB. Kein zusätzlicher Cloud- oder Schrift-Request ohne konfigurierte Online-Nutzung.
