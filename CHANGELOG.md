# Changelog

## 0.3.0-alpha.3 — 2026-10-01 (testing)

- Strassennamen folgen offline dem Strassenverlauf, ohne Punktmarker oder Textkästchen. Zu kurze/enge Abschnitte und überlappende Namen werden ausgeblendet.
- Orts-/POI-Namen standardmässig aus; Strassen- und Punktnamen separat schaltbar. Doppelter Gebietsmarker entfernt.
- Aktive Zeichenwerkzeuge zeichnen über bestehenden Objekten; Trefferprüfung nur bei Auswahl/Feldansicht.


## 0.3.0-alpha.2 — 2026-10-01 (testing)

- AST-008: GPS pausiert im Hintergrund und fordert nach Rückkehr einen neuen Fix an.
- Alte Watch-Callbacks, rückwärts laufende Zeitstempel und unrealistische Zukunftszeitstempel werden verworfen; ungenaue Positionen klar gekennzeichnet.
- Projektimport rollt auch synchrone Fehler beim Einreihen von Schreiboperationen zurück.
- Expliziter GPS-Stopp und verweigerte Freigabe bleiben auch nach App-Wechsel wirksam.


## 0.3.0-alpha.1 — 2026-10-01 (testing)

- AST-007: vollständige Projektpakete mit Karte und Credits, begrenzter ZIP-Import und atomare Installation.
- Verteilte Kopien schreibgeschützt, ausdrückliche bearbeitbare Kopie.


## 0.2.0 — 2026-10-01

- AST-004–006: Gebietspakete, geografischer Editor, Teams, Phasen und lokales Briefing.
- Preview-Stand zur Integration freigegeben; reale Geräteabnahme bleibt offen.

## 0.2.0-alpha.3 — 2026-10-01 (testing)

- AST-006: Teams mit Kürzel/Farbe, Elementzuordnung, Phasen mit Notizen/Kamera/Elementsichtbarkeit und Reihenfolge.
- Lokales Offline-Briefing mit Vor/Zurück und Pfeiltasten. Temporäre Zeichnungen verändern den Plan erst bei expliziter Übernahme; Verlassen/Phasenwechsel verwirft sie.
- Zuordnungsänderungen, Löschungen und Übernahme der Briefing-Zeichnungen sind atomar und rückgängig machbar.

## 0.2.0-alpha.2 — 2026-10-01 (testing)

- AST-005: bewusster Planungsmodus, Punkte/Linien/Flächen/Kreise/Text/Freihand, Auswahl/Elementsuche und lokale Layer-Sichtbarkeit.
- Attribute, präzise WGS84-Eckpunkte, Radius, geodätische Distanz/Fläche, Objekt-/Vertexverschieben und undo-fähige Löschung.
- Desktop- und Chromium-Touchgesten geprüft, inklusive nativer Touch-Freihandbewegung; reale Geräteabnahme bleibt offen.

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
