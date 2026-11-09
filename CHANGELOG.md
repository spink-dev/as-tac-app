# Changelog

## 1.0.0-alpha.5 — 2026-11-09

- **Riedikon entfernt:** Das «Ausbildungszentrum Riedikon» ist nicht mehr im Katalog (Eintrag und Datei `public/maps/ch/riedikon.926d41a7.geojson`); die Schweiz hat noch den Steinbruch Dielsdorf. 35 Felder in 13 Ländern. Wer das Feld schon gespeichert hat, behält es als eigenes Gebiet; Pläne darauf öffnen weiter. Apps bis alpha.4 können Riedikon danach nicht mehr neu laden (Ausnahme von der Regel, alte Felddateien liegen zu lassen).
- **Land des Nutzers zuerst:** Feldkatalog, «Neuer Plan» und der erste Vorschlag der leeren Startseite öffnen auf dem Land, in dem das Gerät steht, sofern es dort Felder gibt, sonst auf Deutschland. Massgeblich ist die Zeitzone des Geräts (Europe/Zurich → Schweiz; America/New_York → keine Felder, also Deutschland). Wo sie keinen Ort nennt (UTC), zählt die erste Region der Browsersprachen mit Feldern (de-CH → Schweiz). Browser melden `CET`/`MET` als Europe/Brussels und `EET` als Europe/Athens; dort zählt zuerst eine Browsersprache eines Landes mit derselben Uhrzeit (ein deutsches Gerät auf `CET` öffnet auf Deutschland), sonst Belgien bzw. Deutschland. Keine Standortabfrage, keine IP-Abfrage, nichts verlässt das Gerät. Ein neuer Plan startet auf einem Feld des Landes, das schon auf dem Gerät liegt, in Deutschland auf Mahlwinkel, sonst auf dem ersten Feld des Landes; «Feld wählen» und der Länderwechsel im Dialog ebenso. Ohne Netz und ohne ein Feld des Landes auf dem Gerät startet er auf Mahlwinkel (vorab gespeichert), auch wenn zuvor ein anderes Feld gewählt war; scheitert ein gewähltes Feld am Netz, bietet der Dialog «Mahlwinkel wählen» an. Die Startseite folgt dem Online-Status (gemeinsamer Hook `useOnline`). Browser-Szenarien legen ihre Zeitzone fest; `fields` prüft Schweiz, Frankreich und ein Telefon in New York, die Schweiz auch offline.

## 1.0.0-alpha.4 — 2026-11-09

- **KI-Schutz (anti-ai):** wiederverwendbarer Baustein in `anti-ai/` für nginx und Vercel, für as-tac.dev in `anti-ai.site.json` eingestellt. KI-Crawler, KI-Assistenten und signierte KI-Agenten (Web Bot Auth), Skripte, HTTP-Bibliotheken, Headless-Browser und unbekannte Bots erhalten 403 auf allem; Suchmaschinen nur die neue Infoseite `/about/` (Deutsch/Englisch), Link-Vorschauen die Infoseite statt der App; Seitenaufrufe ohne `Accept-Language` werden abgelehnt; In-App-Browser von Messengern gelten als Menschen. `robots.txt`, `ai.txt`, `/.well-known/tdmrep.json`, `X-Robots-Tag` (`noindex`, `noai`), `tdm-reservation` und `Vary` überall; unsichtbarer Fallen-Link mit fail2ban-Filter und -Jail (15 Minuten, nie private Adressen) und logrotate; Ratenbegrenzung für Seitenaufrufe je Adresse (nginx), nicht für Dateien. Der Docker-Container wird nur lokal hinter dem TLS-Proxy veröffentlicht. Vercel: `proxy.js` (Routing Middleware) mit derselben Entscheidung, `vercel.json` stellt das Projekt auf Vite. KI-Namensliste von ai.robots.txt (MIT), Stand 2026-11-09.

## 1.0.0-alpha.3 — 2026-11-09

- **Felder nach Land:** 36 mitgelieferte Airsoft-Felder in 13 Ländern (Deutschland 8, Frankreich 8, Schweiz 2, Österreich 2, Slowakei 3, Vereinigtes Königreich 3, Belgien 2, Bulgarien 2, Italien 2, Niederlande, Polen, Spanien, Ungarn je 1), unter anderem der Bärenkopf (Fort de la Tête de l’Ours, Col des Croix), das Ausbildungszentrum Riedikon, der Steinbruch Dielsdorf in Steinmaur, Airsoft Park Tirol, Actionbase Rauchenwarth, Blackfield, RSA Harnekop und Area-M. Katalog in `src/config/maps.json` (Land, Ort, Website, OSM-Objekt, Datei, Grösse, Objektzahl, SHA-256, Datenstand); Dateien unter `public/maps/<land>/<name>.<sha256:8>.geojson`, damit eine spätere Aktualisierung nie eine Datei ersetzt, die eine ältere Version noch lädt. Startseite: «Auf diesem Gerät» und «Felder nach Land» mit Länderwahl; «Neuer Plan», «Karten» und die Platzierung beim Import gruppieren ebenso. Ländernamen kommen vom Browser (`Intl.DisplayNames`).
- **Zürich entfernt:** Die Testgebiete Benglen und «Zürich Stadt bis Benglen» (25 MB) sind nicht mehr dabei. Bereits gespeicherte Kopien bleiben als eigene Gebiete erhalten; Pläne darauf öffnen weiter. Apps bis alpha.2 können die beiden Gebiete nach diesem Update des Servers nicht mehr neu laden (sie müssen aktualisieren).
- **Grundkarten:** Felder werden gegen die SHA-256 aus dem Katalog dieses Builds geprüft (kein Manifest-Abruf mehr; `maps/mahlwinkel.json` bleibt für ältere Versionen). Nur Mahlwinkel wird vorab gespeichert und lässt sich nun auch ohne Netz als Grundkarte wählen (bisher verweigerte die App den Download offline, bevor der Service Worker antworten konnte); alle anderen Felder werden beim ersten Gebrauch geladen. Ein Gebiet, das früher als mitgeliefertes Feld installiert wurde, wird beim Import nicht dupliziert. Fehlt die Grundkarte eines Plans und ist sie kein mitgeliefertes Feld, meldet die App das und zeigt keine fremde Grundkarte mehr darunter; «Karten» zeigt sie als «nicht auf diesem Gerät». Wechselt das Gebiet eines offenen Plans, springt die Karte dorthin. Dritter Ausweichserver für Gebietsdownloads: `overpass.openstreetmap.fr`.
- **Werkzeug:** `npm run map:build` (`scripts/build-maps.mjs`, ersetzt `map:fetch`) lädt die Felder aus Overpass oder wandelt gespeicherte Overpass-Antworten (`--from`) mit derselben Umwandlung wie die App um und schreibt Grösse und Prüfsumme in den Katalog.

## 1.0.0-alpha.2 — 2026-11-08

- **Sprache:** Deutsch ist die erste Sprache, auch in englischsprachigen Browsern. Englisch wählbar auf der Startseite, in den Einstellungen und in der Befehlssuche. Gespeicherte Einstellungen tragen jetzt eine Version (`as-tac.prefs`, `v: 2`); beim Wechsel von alpha.1 wird ein automatisch übernommenes Englisch (englischer Browser) auf Deutsch gesetzt, ein von Hand gewähltes Englisch bleibt. Restliche fest verdrahtete Beschriftungen übersetzt.
- **Version und Updates:** Version, Commit und Build-Zeit in der App; `version.json` auf dem Server; Update-Suche beim Start, stündlich, nach Funklöchern und von Hand; Herunterladen im Hintergrund (Datensparmodus: erst auf Tippen); Herunterladen auf Tippen und Einspielen auf einen zweiten Tipp (nie ein Neuladen Minuten später); blockiert während einer Pfadaufnahme, eines Entwurfs oder temporärer Zeichnungen; nach Speichern von Plan und Live-Warteschlange werden Änderungen gesperrt; danach derselbe Plan im selben Modus und mit derselben Streamer-Safe-Ansicht; andere Fenster laden nicht von selbst neu, sondern werden zum Neuladen aufgefordert; eine ältere Version auf dem Server wird gemeldet und von der App nicht von selbst geladen (der Browser kann sie beim nächsten Start aktivieren, dann folgt ein Hinweis); Hinweis «Aktualisiert auf Version …» mit «Neuerungen». Dateien einer veralteten Seite, die nach einem Update fehlen, führen zu einem gespeicherten Neuladen statt einer leeren Seite.
- **Live über App-Versionen:** jedes verschickte Objekt trägt sein Planformat (`_fv`, ohne Server-Änderung); ältere Objekte werden beim Empfang migriert, Objekte einer neueren App nicht angewendet («Update nötig», eigene Änderungen warten in der Warteschlange und gehen nach dem Update mit Versionsprüfung raus, die neueren Objekte werden danach erneut geholt); Beitreten zu einem Plan mit neueren Objekten verlangt zuerst ein Update; die Warteschlange wird beim Update migriert. Neues Browser-Szenario `live-versions`.
- **Prüfung:** 147 Unit-Tests und 12 Browser-Szenarien in Chromium (neu: `update` mit zwei Builds, `live-versions`, `live-order`). Nicht geprüft: Updates auf echten Telefonen und eine echte Formatänderung (Format 2 existiert noch nicht; die Migrationswege sind mit einem erfundenen Format geprüft).
- **Migrationen:** ein gemeinsamer Ablauf für alle Formate (`src/core/model/migrations.ts`), Planschritte pro Objekt (auch für Live-Daten nutzbar). Im Gerät gespeicherte Pläne werden beim Öffnen migriert (Original 60 Tage in der neuen Tabelle `backups`, IndexedDB-Version 4); Pläne, Dateien, Links, Teamvorlagen und Gebiete aus einer neueren App werden mit «bitte aktualisieren» abgelehnt und nie überschrieben, in der Planliste als «Neuere Version» markiert. Teamvorlagen tragen jetzt die Planformatversion. Eingefrorene Beispieldateien aller heutigen Formate mit Prüfsummen; Tests für die Datenbank von alpha.1 und für eine Datenbank, die eine neuere App erweitert hat.

## 1.0.0-alpha.1 — 2026-11-08 (Branch `redesign/as-tac-2`)

Neuentwicklung: as-tac 0.6 (echte OSM-Karten) und TacMap 0.12 (Bildkarten, Werkzeuge) in einer App.

- **Technik:** Astro abgelöst durch Vite 8 + React 19 (reine Client-App), MapLibre GL 6, Zustand/Immer, Dexie, Zod 4. Neue IndexedDB `as-tac-v2`; die alte Datenbank `as-tac-projects` bleibt unangetastet und wird beim Start zur Übernahme angeboten.
- **Karten:** mitgelieferte Gebiete Mahlwinkel, Benglen, Zürich bis Benglen; eigene Ausschnitte bis 36 km² per Overpass mit Ortssuche; lokale Schriften und Symbole, Tag/Dunkel/Rotlicht, MGRS-Gitter.
- **Bildkarten:** auf die echte Karte legen, mit Passpunkten ausrichten (ähnlich ab 2, affin ab 4 gut verteilten Paaren), bekannte Mahlwinkel-Eventkarten per SHA-256 erkennen; gebundene Objekte, Zeichnungen und Ausschnitte bewegen sich mit.
- **Planen:** Marker, Routen, Zonen, Text, Zeichnen, Radierer, Peilung, Messen, Ebenen, Teams mit Auftragskarte/Verbänden/Logos/Vorlagen, Protokoll, Undo/Redo als Entitäts-Operationen, Befehlspalette, frei belegbare Tastenkürzel, Inspector, Grenzen aus dem Schema an jeder Eingabe.
- **Feld:** gesperrter Plan, eigene Position, Kompass mit Blickrichtung oben, Navigation, Pfadaufnahme (nur lokal, Export nur auf Wunsch).
- **Briefing:** Phasen mit Ausschnitt, Zeit und Notizen, temporärer Stift, Präsentation leiten/folgen im Live-Betrieb.
- **Teilen & Import:** `.astac` (ZIP mit SHA-256 für jede Datei, optional mit Grundkarte), QR/Link für kleine Pläne, Import von `.tacmap`, as-tac 0.x und `.astac-map.json`, Installations-Dateihandler.
- **Live:** Supabase-Migration mit RLS und geprüften RPCs, Versionsprüfung statt stillem Überschreiben, dauerhafte Warteschlange pro Objekt (übersteht Neuladen und Funklöcher), Rollen Besitzer/Admin/Zuschauer, Einladungscodes per Link-Fragment oder QR, Sperren entfernter Mitglieder, Admin-Chat, Anwesenheit; lokaler Testmodus zwischen Tabs.
- **Schwaches Netz:** Live-Abgleich in sich anpassenden, fortsetzbaren Seiten mit Abbruch bei Stillstand oder sehr langsamer Leitung; Senden in Paketen von 8 KB bis 1,5 MB je nach Leitung; Betrieb ohne Echtzeit über HTTP («Eingeschränkt»); keine Rücksendung eigener Änderungen; Bildkarten im Hintergrund (Herunterladen in fortsetzbaren Stücken, Hochladen ab 6 MB fortsetzbar), mit Datensparmodus; Gebietsdownloads in Teilen mit Wiederholung, Fortsetzen und ehrlichen Fehlermeldungen.
- **Datenschutz:** GPS wird nie übertragen; Streamer Safe blendet Position, Navigation, Pläne, Codes und QR aus.
- **Prüfung:** 93 Unit-Tests (inkl. Migration und Rechte unter PGlite, lokaler Testmodus mit denselben Regeln) und 9 Browser-Szenarien in Chromium bestanden (zwei davon über ein simuliertes schwaches Netz), auch ausgeliefert über die nginx-Konfiguration aus `docker/`. Nicht geprüft: echte Geräte und Sensoren, Safari, ein echtes Supabase-Projekt, der Docker-Build selbst, die Erkennung bekannter Eventkarten (braucht die eigene Bilddatei).

## 0.6.0 — 2026-10-01 (main)

- Freigegebene Integration aller Änderungen aus 0.5.1-alpha.1 bis 0.6.0-alpha.2: Mahlwinkel-Datenkorrekturen, einheitliche Kartensymbole und Schraffuren, lokale GPS-Pfadaufnahme, Standortabgleich, Desktop-Zeichentasten und Zürich–Benglen als Offline-Testgebiet.
- Grundlage: 63 bestandene Chromium-Regressionstests, 1 mangels Live-Backend übersprungener Test und 5 bestandene WebKit-Tests. Versionswechsel ändert keine Anwendungslogik.
- Online-Betrieb benötigt Migrationen 202610010004_symbols.sql und 202610010005_zurich.sql. Live-Migration und physische Geräteabnahme bleiben separat offen.

## 0.6.0-alpha.2 — 2026-10-01

- Zusammenhängendes Offline-Testgebiet Zürich-West/Zentrum bis Benglen, einschliesslich ZHAW Lagerstrasse und Toni-Areal.
- Kartenübergreifende HQ-, Safe-/Zivilzonen- und Gefahrensymbole; Beschriftung ausblendbar, ohne das gewählte Symbol zu verlieren.
- Zoomabhängige Gebäude und Wege, gestrichelte Fusswege, kompakte Eventzeichen und begrenzte, sichtbereichsabhängige Basiskartenlabels.
- Vorbereitete/portable Pakete bis 0,2° × 0,1°, 100000 Objekte und 750000 Koordinaten bei weiterhin 25 MiB; interaktive Downloads bleiben auf kleine Ausschnitte beschränkt.
- Online-Karte Zürich benötigt Migration 202610010005_zurich.sql.

## 0.6.0-alpha.1 — 2026-10-01

- Offline-Symbole, diagonale/Kreuz-/Punktmuster, Umrissmodus und eigene Label-Einstellungen; HQs priorisiert, keine automatische Beschriftung mitten in der Spielfeldgrenze.
- Freiwillige GPS-Pfadaufnahme mit Pausen/Lücken, GeoJSON-Export und Übernahme als lokale Planlinien. GPS-Geschwindigkeit und freiwillige Gerätebewegungserkennung.
- Geführter Standortabgleich mit ein bis drei Punkten; zeitlich/räumlich begrenzter lokaler Versatz ohne erfundene Genauigkeit oder inertiale Navigation.
- Desktop-Zeichentasten ausserhalb von Formularen; Enter/Escape/Rücktaste für Zeichnungen.
- Online-Styles benötigen Migration 202610010004_symbols.sql; keine automatische Übertragung von Aufnahmen.

## 0.5.1-alpha.1 — 2026-10-01

- Mahlwinkel: vollständigerer OSM-Ausschnitt für alle sechs Eventvorlagen.
- Dark Emergency: Aussengrenze nach Originalkarte korrigiert, Miliz-Safe-Zone ergänzt und alle fünf Safe Zones als eigene Polygone über dem Gelände.
- Nachvollziehbare Referenzgeometrie, Kalibrierung und Katalogrevision r2; bestehende Projekte bleiben erhalten.
- Performance-Review und Datenabgleich dokumentiert; Optimierungsbefunde noch offen.
- Update-Test wartet auf den tatsächlichen Dokument-Neustart, bevor er Tabs bedient.

## 0.5.0 — 2026-10-01 (main)

- Freigegebene Integration des Kartenarbeitsplatzes, Event-Katalogs, Root-Studios und AS-TAC-Brandings samt Tag-/Dunkel-/Rotlichtmodus.
- Anschliessender Performance- und FieldMaps-Datenabgleich wird separat dokumentiert.

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
