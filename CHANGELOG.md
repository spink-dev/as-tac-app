# Changelog

## 0.2.0-alpha.1 — 2026-10-01 (testing)

- AST-004: freie kleine Gebietsauswahl, begrenzte Overpass-Downloads, Kartenpaket-Import/Export, Hash-/Quota-Prüfung und atomare Speicherung.
- Zusätzliche Karten überleben Offline-Neustarts; referenzierte Gebiete sind gegen Löschen geschützt. DB-Version 2 erhält Projekte aus v1 unverändert.
- 21 automatisierte Tests bestanden. Live-Anbieter und reale Telefone noch nicht abgenommen.

## 0.1.0 — 2026-10-01

Erste versionierte Integration von AST-002 und AST-003 auf `main`.

### Neu

- AST-002: getrennte Karten-, GPS- und Offline-Module, gemeinsame Gebietskonfiguration und deutsche Sprachdatei. App-Updates werden bewusst aktiviert; ein fehlerhaftes Offline-Paket ersetzt keine gültige Version.
- AST-003: lokale Projekte erstellen, öffnen, umbenennen, duplizieren und löschen. Transaktionales Autosave, sitzungsbezogenes Undo/Redo, validiertes WGS84-Modell und Schutz gegen konkurrierende Tab-Änderungen.
- Speicherfehler erhalten den Entwurf; Wiederholung, neue Projektkopie und JSON-Notfallsicherung sind möglich. Update-Neustarts sind bei ungesicherten Änderungen gesperrt.
- App-Version in „Über & Quellen“ und im Offline-Manifest, synchron mit Paket und Lockfile.

### Kompatibilität und Grenzen

- Erstes lokales Projektformat: Schema 1. AST-001/002 haben keine Projekte persistiert; keine Bestandsmigration erforderlich.
- Offline-Karten und GPS-Funktionalität bleiben enthalten. Die separate mobile Prüfstand-Oberfläche wird nicht in Produktion übernommen.
- Reale iPhone-16-Pro-/Galaxy-A24-Abnahme bleibt offen. Karteneditor, freie Gebietsauswahl und portabler Paketimport folgen in weiteren Arbeitspaketen.
- 16 automatisierte Tests decken lokale Projekte, Transaktionen, Migration, Offline-Kaltstart und Update-/GPS-Regressionen ab; sie ersetzen keine Geräteabnahme.

## 0.0.1 — Ausgangsstand

AST-001: Offline-Karten für Mahlwinkel und Zürich/Benglen, lokale GPS-Anzeige und Offline-Prüfungen. Kein nachträglich erfundener Release-Tag.
