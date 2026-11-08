# AS-TAC

Taktische Kartenplanung für Airsoft – auf echten OpenStreetMap-Karten, offline im Gelände, mit Bildkarten, Teams, Briefing und Live-Zusammenarbeit. Privates Projekt von Samuel Spink.

**Stand 1.0.0-alpha.1 (2026-11-08):** Neuentwicklung, die as-tac 0.6 (echte OSM-Karten) und TacMap 0.12 (Bildkarten, umfangreiche Werkzeuge) zu einer App zusammenführt. Alte Pläne, TacMap-Dateien und die gespeicherten Gebiete Mahlwinkel und Zürich/Benglen lassen sich übernehmen.

## Was die App kann

- **Echte Karten offline:** mitgelieferte Gebiete (Mahlwinkel, Benglen, Zürich bis Benglen) und eigene Ausschnitte bis 36 km² direkt aus OpenStreetMap (Overpass) herunterladen. Danach läuft alles ohne Netz. Grosse Ausschnitte kommen in Teilen von höchstens 4 km²; bricht die Verbindung ab, setzt «Fortsetzen» beim fehlenden Teil an (fertige Teile bleiben 30 Minuten erhalten, solange die App offen ist).
- **Bildkarten wie in TacMap:** Eventkarten, Skizzen oder Luftbilder auf die echte Karte legen und mit Passpunkten ausrichten (ab 2 Paaren ähnlich, ab 4 gut verteilten Paaren mit Verzerrungsausgleich). Bekannte Mahlwinkel-Eventkarten werden am SHA-256 erkannt und sofort ausgerichtet. Objekte, Zeichnungen und Ausschnitte auf einer Bildkarte bewegen sich beim Neuausrichten mit.
- **Werkzeuge:** Marker (M→1–9), Routen (R→1–4), Zonen als Fläche oder Kreis (Z→1–8, Tab), Text, freies Zeichnen (D), Radierer, Peilung, Messen, Ebenen, Teams mit Auftragskarte, Verbände, Logos, Teamvorlagen, Protokoll, Rückgängig/Wiederholen, Befehlspalette (⌘K / Ctrl+K), frei belegbare Tastenkürzel.
- **Feldmodus:** Plan gesperrt, eigene Position mit Genauigkeit, MGRS, Kompass mit «Blickrichtung oben», Navigation zu angetippten Objekten, Pfadaufnahme (bleibt auf dem Gerät).
- **Briefing:** Phasen mit Kartenausschnitt, Zeit und Notizen; temporärer Stift; im Live-Betrieb führt ein Admin die Präsentation und alle anderen folgen.
- **Teilen:** `.astac`-Datei (Plan, Bildkarten, optional Grundkarte) über das Teilen-Menü des Geräts oder als Download; kleine Pläne als QR-Code/Link (der Plan steckt im Link nach dem `#`, kein Server).
- **Importieren:** `.astac`, TacMap `.tacmap`, as-tac 0.x `.astac.zip`/Plan-JSON, Kartenpakete `.astac-map.json`. Alte as-tac-Pläne im Browser werden beim Start angeboten.
- **Live-Zusammenarbeit:** mehrere Admins planen gleichzeitig, Zuschauer sehen alles nur lesend, Admin-Chat, Einladungscodes mit QR. Gleichzeitige Änderungen am selben Objekt werden angezeigt statt still überschrieben.
- **Schwaches Mobilfunknetz:** Änderungen reisen in kleinen, sich anpassenden Paketen und gehen bei Funklöchern nicht verloren; ein Empfang setzt nach einem Funkloch dort fort, wo er abbrach. Ohne Echtzeit-Verbindung (blockierter Websocket) gleicht die App alle 20 s über normales HTTP ab. Bildkarten und Logos laufen im Hintergrund: Herunterladen in fortsetzbaren Stücken, Hochladen ab 6 MB fortsetzbar. Mit «Bildkarten von Partnern laden: Manuell» (Einstellungen) kommen sie erst auf Antippen; «Nur WLAN» erkennt WLAN nur auf Android und ChromeOS und gilt sonst wie «Manuell».
- **Datenschutz:** Die eigene GPS-Position wird nie übertragen und nur auf ausdrücklichen Wunsch als Pfad gespeichert. «Streamer Safe» blendet Navigation, eigene Position, Planungs- und Freundinformationen aus.
- **Darstellung:** Tag, Dunkel, Rotlicht; grosse Touch-Ziele; Telefon mit Bottom Sheet, Desktop mit Seitenpanel.
- **Sprache:** Deutsch ist die erste Sprache, unabhängig von der Browsersprache. Englisch lässt sich auf der Startseite (Schaltfläche oben rechts), in den Einstellungen und in der Befehlssuche wählen; die Wahl gilt für dieses Gerät.
- **Version und Updates:** Version und Build stehen auf der Startseite («Dieses Gerät») und in den Einstellungen. Die App fragt beim Start, stündlich und nach einem Funkloch den Server nach einer neuen Version (`/version.json`, wenige Bytes) und lädt sie im Hintergrund – im Datensparmodus erst auf Tippen («Update laden»). Eingespielt wird sie nur auf Tippen («Jetzt aktualisieren»), nie Minuten später von selbst: eine laufende Pfadaufnahme, ein offener Entwurf oder temporäre Zeichnungen blockieren; dann wird alles gespeichert, Änderungen werden gesperrt, und danach öffnet sich derselbe Plan im selben Modus und mit derselben Streamer-Safe-Ansicht. Andere offene Fenster laden nicht von selbst neu, sondern werden zum Neuladen aufgefordert. Eine ältere Version auf dem Server (Rücknahme) wird gemeldet, aber nie von selbst geladen. «Neuerungen» zeigt die Kurzfassung dieser Liste, mit Link auf das mitgelieferte CHANGELOG.

## Starten

Node.js ≥ 22.12.

```sh
npm ci
npm run dev          # http://localhost:9000, ohne Service Worker
npm run check        # Typprüfung + Unit-Tests + Build
npm run preview      # http://localhost:4000, Produktionsbuild mit Service Worker
```

Browser-Prüfungen gegen die laufende Vorschau (Chromium via Playwright):

```sh
npx playwright install chromium   # einmalig (Playwright ist Entwicklungsabhängigkeit)
npm run e2e                       # alle Szenarien, Screenshots unter tests/e2e/screenshots
```

Das Szenario `update` baut dafür selbst zwei Versionen und spielt ein echtes Update durch (eigener kleiner Server, unabhängig von der Vorschau).

## Kompatibilität und Migrationen

Jeder gespeicherte oder verschickte Datensatz trägt die Formatversion, in der er geschrieben wurde: Pläne (`formatVersion`), `.astac`-Container, Teamvorlagen, Gebietspakete, Geräteeinstellungen (`v`) und die IndexedDB (Dexie-Versionen). Ältere Daten werden beim Lesen Schritt für Schritt auf das aktuelle Format gebracht; im Gerät gespeicherte Pläne werden dabei einmal neu geschrieben, das Original bleibt 60 Tage als Sicherung (`backups`). Daten aus einer **neueren** App werden nie geraten oder überschrieben: Die App sagt «neuere Version – bitte aktualisieren» und lässt den Datensatz unverändert, damit nach dem Update nichts fehlt.

Im Live-Betrieb trägt jedes verschickte Objekt sein Format (`_fv`). Ältere Objekte von Partnern werden beim Empfang mit denselben Schritten migriert; Objekte aus einer neueren App werden nicht angewendet: Die App meldet «Update nötig», hält die eigenen Änderungen in der Warteschlange (sie gehen nach dem Update raus, mit Versionsprüfung) und holt die neueren Objekte nach dem Update erneut. Wer einem Live-Plan mit neueren Objekten beitreten will, wird zuerst zum Aktualisieren aufgefordert. Die Warteschlange übersteht Updates und wird dabei ebenfalls migriert.

Formatänderung: `FORMAT_VERSION` in `src/core/model/schema.ts` erhöhen, Schritt in `src/core/model/migrations.ts` ergänzen (pro Objekt, damit Live-Daten denselben Weg nehmen), neue Datenbankversion nur anhängen, nie eine alte ändern. Die eingefrorenen Beispieldateien in `tests/fixtures/formats` (mit Prüfsummen) müssen weiterhin öffnen.

## Live-Zusammenarbeit einrichten (optional)

Ohne Konfiguration bietet die App einen **lokalen Testmodus** zwischen Tabs desselben Browsers an (jeder Tab ist eine eigene Person). Für echte Geräte wird ein Supabase-Projekt gebraucht:

1. Migration `supabase/migrations/20261108000001_live.sql` auf ein **neues** Projekt anwenden (Inhalt im SQL-Editor des Projekts ausführen).
2. In Supabase Auth «Anonymous sign-ins» aktivieren (Geräte-Anmeldung) und optional E-Mail-Magic-Links. Weil anonyme Konten beliebig neu entstehen können, Captcha-Schutz (Auth → Attack Protection) und die Auth-Ratenlimits einschalten.
3. Realtime: private Kanäle verwenden (Realtime-Einstellungen: öffentlichen Zugriff deaktivieren); die Migration legt die Richtlinien für `realtime.messages` und den privaten Bucket `live-assets` an.
4. `.env.example` nach `.env` kopieren, **nur** Projekt-URL und Publishable Key eintragen, neu bauen.

Details und Sicherheitsmodell: [`supabase/README.md`](supabase/README.md).

## Aufbau

```
src/core/model      Zod-Schema, Grenzen, Fabriken, Geometrie
src/core/store      Projekt (Undo/Redo als Entitäts-Operationen), UI, Präferenzen, Routen
src/core/storage    Dexie/IndexedDB, Asset-Speicher (SHA-256), Autosave
src/core/areas      Offline-Gebiete: mitgeliefert, Overpass-Download, Dateien
src/core/files      .astac, sicheres ZIP-Lesen, Plan-Links
src/core/legacy     Import aus as-tac 0.x und TacMap 0.12
src/core/live       Live-Sync (Outbox mit Versionsprüfung), Supabase, lokaler Testmodus
src/map             MapLibre: Grundkarte, Planebenen, Symbole, Interaktion, Bildkarten
src/features        Oberfläche: Bibliothek, Arbeitsbereich, Panels, Feld, Briefing, Teilen, Live
supabase/migrations Live-Schema mit RLS
tests/unit          Vitest (inkl. Migration unter PGlite)
tests/e2e           Playwright-Szenarien gegen die Vorschau
```

Regeln für Beiträge stehen in [`AGENTS.md`](AGENTS.md), die Gestaltung in [`DESIGN.md`](DESIGN.md), Quellen und Lizenzen in [`CREDITS.md`](CREDITS.md).

## Docker

```sh
docker build -t as-tac \
  --build-arg VITE_SUPABASE_URL=https://<projekt>.supabase.co \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... .
docker run -p 8080:80 as-tac
```

Die beiden Werte werden beim Build eingebunden; ohne sie läuft die App rein lokal. Nie einen `service_role`- oder `sb_secret`-Schlüssel verwenden. Mit `--build-arg BUILD_COMMIT=$(git rev-parse --short HEAD)` zeigt die App den Build an (der Build-Kontext enthält kein `.git`).

**Neue Version ausliefern:** Version in `package.json` erhöhen, Eintrag in `CHANGELOG.md` und `src/core/releases.ts`, neu bauen und deployen. `index.html`, `sw.js` und `version.json` dürfen nicht lange zwischengespeichert werden (siehe `docker/nginx.conf`), sonst sehen Geräte das Update erst spät.

## Was geprüft ist – und was nicht

- Geprüft: Typprüfung, Unit-Tests (Geometrie, MGRS, Speicher, Undo mit Partnern, Dateiformate, ZIP-Grenzen, TacMap-Umwandlung, Live-Migration und RLS unter PGlite, gleiche Regeln im lokalen Testmodus), Browser-Szenarien in Chromium (Werkzeuge, Panels, Bildkarten mit erzeugtem Bild und Ablehnung ungültiger Bilder, Feld mit simuliertem GPS/Kompass, Teilen/Import, Live im lokalen Testmodus mit drei Tabs, Live über ein simuliertes schwaches Netz mit 64 kbit/s, 300 ms Latenz und 20 % verlorenen Anfragen samt Funkloch, Bildkarten über schwaches Netz mit Datensparmodus), auch gegen die nginx-Konfiguration aus `docker/`. Gebietsdownloads in Teilen und fortsetzbare Bildübertragungen sind gegen nachgebildete Server geprüft (Overpass ist aus der Testumgebung nicht erreichbar).
- **Nicht** geprüft: echte Geräte (iPhone, Android) und echte Sensoren, Safari/WebKit, ein echtes Supabase-Projekt (Realtime, Storage, Auth), Offline-Betrieb auf einem installierten Telefon, der Docker-Build selbst, die Erkennung bekannter Eventkarten (braucht die eigene Bilddatei: `node tests/e2e/images.mjs <ordner> <eventkarte>`).

## Lizenzen

Kartendaten © OpenStreetMap-Mitwirkende, ODbL 1.0 (`public/licenses`). Eventkarten Dritter werden nicht mitgeliefert, nur erkannt, wenn Nutzer sie selbst importieren.
