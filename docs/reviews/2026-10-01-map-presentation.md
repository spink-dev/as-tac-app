# Kartenbild und Zürich-Testgebiet — 0.6.0-alpha.2

## Umfang

Die Darstellung ist zentral für alle sechs Mahlwinkel-Events, Benglen, Zürich und importierte Karten angepasst. HQ-/Safe-/Zivil-/Gefahrenzeichen, reduzierte Gebäudezeichen, abschaltbarer Text bei weiter sichtbarem Icon; keine zentrale Spielfeldbeschriftung. Explizite Stileinstellungen bestehender Projekte bleiben erhalten. Zoomabhängige Gebäude, Fuss-/Waldwege gestrichelt, Strassen durchgezogen; urbane Landnutzung hebt sich von Waldflächen ab. Orts-/POI-Namen weiterhin optional. Pro Basiskarten-Frame maximal 180 Labelkandidaten, geografisches Culling vor Projektion und SVG-Erzeugung, Aktualisierung via requestAnimationFrame. Kein externer Glyph- oder Sprite-Download.

## Zürich

Vorbereitetes Gebiet `zurich`, WGS84 `[8.503, 47.349, 8.654, 47.401]`. Zusammenhängender Testkorridor Zürich-West/Zentrum–Zürichberg–Benglen, kein Versprechen einer vollständigen administrativen Stadtgrenze. Startgebiet und beide möglichen ZHAW-Ziele über Schweizer Adresssuche auf Einschluss geprüft. Keine private Startadresse als persönlicher Marker veröffentlicht.

ZHAW-Ziele: [Lagerstrasse 41](https://www.zhaw.ch/de/linguistik/institute-zentren/ilc/weiterbildung/sprachkurse) und [Toni-Areal, Pfingstweidstrasse 96](https://www.zhaw.ch/de/sozialearbeit/ueber-uns/campus-toni-areal). Adressprüfung: api3.geo.admin.ch SearchServer. Der Nutzer hat den bevorzugten Campus noch nicht angegeben; beide sind enthalten.

OSM über Overpass, 84884 Objekte, 614106 Koordinaten, 24866859 Bytes (23,7 MiB). Die vollständige Antwort wurde lokal gesichert; ein späterer Wiederholungsabruf schlug mit HTTP 504 fehl. Das ausgelieferte Manifest kennzeichnet deshalb die belegbare Abrufzeit des gesicherten Datensatzes ausdrücklich, nicht einen nachträglich angenommenen OSM-Revisionszeitpunkt. SHA-256 `1ff0b10db042743e8506e16e1ed2cd479d3f9cc8bdd4c9d08bf84c5a2cdf9090`.

Geometrie und OSM-IDs beibehalten. Eigenschaften auf Darstellungstags reduziert; Kontakt- und Adressmetadaten sind nicht im neuen Basiskartenpaket enthalten. ODbL und OSM-Attribution bleiben erhalten. Keine Standard-OSM-Tiles heruntergeladen. Die Paketgrenzen steigen begrenzt auf 100000 Objekte / 750000 Koordinaten; 25 MiB Dateilimit bleibt bestehen. Grössere vorbereitete Pakete lassen sich exportieren/importieren; spontane Overpass-Downloads bleiben maximal 0,08° × 0,05°.

## Prüfung

- `npm run check`: 69 Dateien, keine Fehler/Warnungen/Hinweise.
- Build erfolgreich, Revision `5147a30a27afd315`, 22 Ressourcen, 28948783 Bytes. Bestehender Hinweis auf grosse Client-Bundles bleibt bestehen.
- Gesamte Chromium-Regression: 63 bestanden, 1 Live-Backend-Test mangels Konfiguration übersprungen.
- Fünf gezielte Feld-/Labeltests in WebKit bestanden; kein physischer iPhone-Nachweis.
- Zürich im Browser offline neu geöffnet; Gebietswahl ohne Projekt bleibt jetzt erhalten. Paket-Hash, WGS84-Grenzen, Datenlimits und unabhängiger Paketimport geprüft.
- Alle sechs Eventkarten gerendert und Screenshots erstellt, Dark Emergency / Mission 24 / Zürich visuell geprüft. Keine Karten-/JavaScript-Fehler im neuen Integrationstest.
- Servermigration 005 mit PGlite lokal geprüft; kein Live-Backend aktualisiert.

Physische iPhone-/Galaxy-Tests, Akku- und Langzeit-Speicherverhalten bleiben Feldabnahmen. Die Browsernachweise ersetzen diese nicht.
