# Changelog

## 0.5.0-alpha.2 — 2026-10-01

- Eigenes AS-TAC-Branding mit geometrischem Zeichen, exportierbarer Vektor-Wortmarke und neuen App-Icons; graphitfarbene Panels, orangefarbener Akzent und einheitliche Navigationsicons.
- Tag-, Dunkel- und Rotlichtmodus direkt im Kartenarbeitsplatz. Lokale Speicherung, Systemeinstellung als Startvorgabe und frühe Initialisierung auch beim Offline-Neustart.
- Eigene Kartenpaletten und monochrome Rotlichtdarstellung einschliesslich Plan-/Teamfarben, GPS, Labels und Briefing-Markierungen. Projektfarben, Kartenausschnitt, Zeichnungen und offene Eingaben bleiben erhalten.
- Rotlicht vermeidet helle Aktionsflächen; Gerätehelligkeit und Systemdialoge bleiben Sache des Betriebssystems. Reale Nachtprüfung auf iPhone 16 Pro / Galaxy A24 steht aus.

## 0.5.0-alpha.1 — 2026-10-01

- Neuer Kartenarbeitsplatz für Orientierung, Planung, Briefing, Karten und Projekt: volle Kartenfläche, schliessbare Panels, mobile Tabs, Tastaturnavigation und Safe Areas.
- Gespeicherte Ebenen mit Zeichenebene, Reihenfolge, Deckkraft und Sperren; lokale Ansichtsoptionen für Betrachter und Auswahl überlagerter Objekte. Zeichnen über bestehenden Objekten bleibt möglich.
- Sechs Mahlwinkel-Eventvorlagen aus dem freigegebenen FieldMaps-Referenzstand, mit gemeinsamen Quell-IDs, unabhängigen Labels/Zonen und Offline-Installation als schreibgeschützte Kopie. Herkunft und Genauigkeitsgrenzen dokumentiert.
- Kartenstudio für Gelände-/Event-/Ausgabenmetadaten, lokale Datenproduktion und ausdrückliche Root-Veröffentlichung. Server prüft Root separat von Projektrollen; veröffentlichte Ausgaben sind unveränderlich.
- Rückwärtskompatibles Lesen von Projektschema 1, Schema 2 für Ebenen/Events, atomare Original-Sicherung bei Formatwechsel und vollständiger ZIP-Roundtrip. Letztes lokales Projekt wird beim Neustart wieder geöffnet.
- Unübernommene Objektattribute vor Navigation/Objektwechsel geschützt. Gemeinsamer Workspace nutzt dieselben Arbeitsbereiche. Online-Export von Serverstand 0 erzeugt ein importierbares Paket.
- Korrigierte serverseitige Briefing-Kameragrenzen. Reale Supabase-Bereitstellung, Domain-Deployment und Geräteabnahme bleiben getrennte Prüfungen.


## 0.4.0 — 2026-10-01 (main)

- Vom Nutzer freigegebene Integration des gesamten bisherigen Stands bis AST-012.
- Supabase-Konfiguration und reale Geräte-/Mehrverbindungsabnahme bleiben als offene Nachweise dokumentiert.

## 0.4.0-alpha.2 — 2026-10-01 (testing)

- AST-010: Gemeinsamer Karteneditor für Owner/Admin, schreibgeschützte Mitgliederansicht, bestätigte Snapshot-Aktualisierung und serverversioniertes Undo/Redo.
- AST-011: Dauerhafte Offline-Entwürfe, kontofreie Offline-Kopien, Konfliktvergleich, stabile Wiederholungs-IDs, Rollenentzug und Schutz laufender Eingaben.
- AST-012: Exklusive, ablaufende Briefing-Leitung und freiwilliges Folgen von Phase/Kamera, getrennt vom Plan.
- Vollständiger Paketexport und Credits auch im gemeinsamen Workspace; öffentliche Supabase-Build-Argumente für Docker.
- SQL-/Chromium-Integration lokal geprüft. Echter Supabase-/Mehrverbindungsnachweis und iPhone-/Galaxy-Feldabnahme bleiben offen. Keine neue Produktionsfreigabe.

## 0.4.0-alpha.1 — 2026-10-01 (testing)

- AST-009: Supabase/PostgreSQL-Grundlage mit Rollen, serverseitiger Validierung, Objektversionen, atomaren Sequenzen und idempotentem Operationsprotokoll.
- Anmeldung, leere Online-Projekte und Mitgliederverwaltung bei konfiguriertem Backend. Lokaler Editor bleibt unverändert offlinefähig.
- Supabase-Deployment, echte Auth-/Realtime-Integration und parallele Datenbank-Sessions noch offen.


## 0.3.0 — 2026-10-01

- AST-007/008 und Kartenkorrekturen aus der Preview integriert. Reale Geräteabnahme weiterhin offen.


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
