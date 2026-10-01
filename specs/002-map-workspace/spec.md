# Kartenarbeitsplatz, Layer und Event-Katalog

Nutzerauftrag 2026-10-01. Aufbauend auf dem nach main integrierten Stand v0.4.0.

## Abläufe

- **Orientierung:** bildschirmfüllende Karte, Position, Elementsuche und Layer. Bearbeitung muss bewusst aktiviert werden.
- **Planung:** Zeichenwerkzeuge, ausgewähltes Objekt, Layer und Teams/Phasen. Karte bleibt beim Arbeiten sichtbar.
- **Briefing:** Phasen, Vor/Zurück, temporäre Zeichnungen und freiwilliges Online-Folgen. Verlassen verwirft nur temporäre Markierungen.
- **Karten:** vorbereitete Events, eigene Gebiete, Ausschnitt herunterladen, Daten/Pakete importieren, Offline-Status und Speicher.
- **Projekt:** eigene Pläne, vollständige Pakete, Zusammenarbeit und Quellen; keine permanent sichtbaren Verwaltungsformulare.
- **Studio:** Gelände-/Event-Kopie bearbeiten, Layer/Bezeichnungen ändern und Paket ausgeben. Veröffentlichung in den gemeinsamen Katalog ausschliesslich durch Root, das serverseitig zugewiesen wird.

## Gelände und Events

Ein Gelände besitzt eine stabile Standort-ID und ein Gebietspaket. Events sind getrennte versionierbare Pläne auf dieser Grundlage. Geografische Referenzobjekte besitzen stabile Quell-IDs; Gebäudenummer/Bezeichnung, Zonen und Grenzen dürfen zwischen Events wechseln. Ein Eventwechsel überschreibt keinen bestehenden Entwurf. Veröffentlichte Pakete sind unveränderliche Revisionen; Updates werden bewusst als neue Kopie installiert.

FieldMaps beschreibt genau diese Trennung: gemeinsame physische POIs, `poiNames` pro Szenario, Event-Zonen und Grenzen. Datenübernahme mit Quelle/Commit, WGS84-Umwandlung `[lat,lng]` → `[lng,lat]`, ohne Logos/Kartenbilder. Quellenstand ist keine Bestätigung eines aktuellen offiziellen Eventplans.

## Layer

Benannte, geordnete Planelement-Layer mit Deckkraft und Sperre; Objektfarben und transparente Füllungen bleiben erhalten. Sichtbarkeit und Deckkraft in der Orientierung verändern keine gemeinsamen Planinhalte; Planungsdeckkraft wird explizit im Projekt gespeichert. Ausgeblendete Elemente sind nicht auswählbar, gesperrte Layer lesbar, aber nicht versehentlich verschiebbar. Zeichnen auf aktivem Layer selektiert keine darunterliegenden Objekte. Bei überlappenden Treffern Auswahl aller Treffer anbieten. Basiskarte und GPS bleiben getrennt.

## Abnahme

Mobile Karte bleibt hinter dem geöffneten Sheet sichtbar; ein Tap schliesst Verwaltung. Desktop zeigt kompakte Navigation und ein begrenztes Seitenpanel. Keine verlorenen Entwürfe beim Tab-/Moduswechsel. Layer-/Event-Metadaten überleben Speichern, Duplizieren und ZIP-Roundtrip. Alte Projekte bleiben lesbar. Root-Veröffentlichung muss serverseitig für normale Owner/Admin/Viewer abgewiesen werden. Katalogdownload ist vor lokaler Übernahme vollständig validiert. Quellen bleiben offline zugänglich.

## Branding / Darstellung (0.5.0-alpha.2)

Eigenes AS-TAC-Zeichen und Vektor-Wortmarke, neue Panel-Palette, einheitliche Navigationsicons. Tag/Dunkel/Rotlicht rechts oben; gerätebezogen gespeichert und beim Offline-Kaltstart vor React gesetzt. Moduswechsel bewahrt Kartenausschnitt, Zeichnung und nicht übernommene Attribute. Rotlicht stellt auch Team-/Objektfarben monochrom dar, verändert jedoch keine Projektdaten. Gerätehelligkeit, Systemdialoge und echte Nacht-Lesbarkeit bleiben Geräteprüfungen. Designvertrag: [DESIGN.md](../../DESIGN.md).
