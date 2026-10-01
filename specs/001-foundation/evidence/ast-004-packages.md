# AST-004 — Gebietspakete, Preview 0.2.0-alpha.1

2026-10-01. Freie kleine Bounds oder sichtbarer Kartenausschnitt; expliziter Overpass-Download, Streaming-Limit 25 MiB, Timeout und Abbruch. WGS84-/Geometrie-/Metadatenprüfung, SHA-256 und Bytezahl, Speicher-Schätzung und atomare IndexedDB-Installation. Neues Gebiet wird erst nach Commit gewählt; ungültige/abgebrochene Pakete ersetzen nichts. Referenzierte Gebiete können nicht gelöscht werden; Projekt-Speichern und Paket-Löschen benutzen dieselben Stores/Transaktionsgrenzen.

`.astac-map.json` enthält Gebietsdaten, Bounds, Datenstand, Quelle, Lizenz und Hash. Import führt keine URLs aus und erzeugt eine unabhängige lokale ID. Die App enthält Renderer und lokale Lizenzen; ein Kartenpaket ist noch kein selbständiges vollständiges Projektpaket aus AST-007. Beim Offline-Laden werden zusätzliche Gebiete erneut geprüft. Ein fehlendes Gebiet lässt die vorherige Karte mit explizitem Hinweis sichtbar.

Prüfung: Astro check/build und Playwright. Neue Szenarien: Grenzen/Geometrie, Import/Export/offline erneut öffnen, referenzierte Löschung abweisen, Hashfehler, simulierte Quota, Download-Abbruch, gemockter Overpass-Roundtrip und unbenutztes Paket entfernen. Zusätzlich DB-v1-Upgrade-Test mit unverändertem Projekt. Vorhandene Offline-/GPS-/Projektregressionen bleiben erhalten.

Die Vorschau verwendet den öffentlichen Overpass-Pilotendpunkt mit einem Aufruf pro bewusster Aktion, ohne Retry-Schleifen und mit 60-s-Sitzungsabstand. Gebietsgrenzen werden an diesen Anbieter gesendet; GPS bleibt separat. Keine Live-Verfügbarkeit, keine real erschöpfte Gerätequota und keine iPhone-/Galaxy-Abnahme behauptet. Öffentliche Nutzungsgrenzen gelten projektweit; vor breitem Betrieb eigenen/vertraglichen Anbieter festlegen. Quelle: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances.

AST-005 folgt auf dieser Basis. Keine Übernahme nach main ohne Freigabe; testing ist der Prüfstand für diese Produktvorschau, ohne die alte AST-001-Testoberfläche.

Ergebnis: `npm run check` ohne Fehler/Warnungen/Hinweise; Produktionsbuild erfolgreich; 21/21 Playwright-Tests in 17,7 s bestanden.
