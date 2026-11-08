# AS-TAC

Taktische Kartenplanung für Airsoft – auf echten OpenStreetMap-Karten, offline im Gelände, mit Bildkarten, Teams, Briefing und Live-Zusammenarbeit. Privates Projekt von Samuel Spink.

**Stand 1.0.0-alpha.1 (2026-11-08):** Neuentwicklung, die as-tac 0.6 (echte OSM-Karten) und TacMap 0.12 (Bildkarten, umfangreiche Werkzeuge) zu einer App zusammenführt. Alte Pläne, TacMap-Dateien und die gespeicherten Gebiete Mahlwinkel und Zürich/Benglen lassen sich übernehmen.

## Was die App kann

- **Echte Karten offline:** mitgelieferte Gebiete (Mahlwinkel, Benglen, Zürich bis Benglen) und eigene Ausschnitte bis 36 km² direkt aus OpenStreetMap (Overpass) herunterladen. Danach läuft alles ohne Netz.
- **Bildkarten wie in TacMap:** Eventkarten, Skizzen oder Luftbilder auf die echte Karte legen und mit Passpunkten ausrichten (ab 2 Paaren ähnlich, ab 4 gut verteilten Paaren mit Verzerrungsausgleich). Bekannte Mahlwinkel-Eventkarten werden am SHA-256 erkannt und sofort ausgerichtet. Objekte, Zeichnungen und Ausschnitte auf einer Bildkarte bewegen sich beim Neuausrichten mit.
- **Werkzeuge:** Marker (M→1–9), Routen (R→1–4), Zonen als Fläche oder Kreis (Z→1–8, Tab), Text, freies Zeichnen (D), Radierer, Peilung, Messen, Ebenen, Teams mit Auftragskarte, Verbände, Logos, Teamvorlagen, Protokoll, Rückgängig/Wiederholen, Befehlspalette (⌘K / Ctrl+K), frei belegbare Tastenkürzel.
- **Feldmodus:** Plan gesperrt, eigene Position mit Genauigkeit, MGRS, Kompass mit «Blickrichtung oben», Navigation zu angetippten Objekten, Pfadaufnahme (bleibt auf dem Gerät).
- **Briefing:** Phasen mit Kartenausschnitt, Zeit und Notizen; temporärer Stift; im Live-Betrieb führt ein Admin die Präsentation und alle anderen folgen.
- **Teilen:** `.astac`-Datei (Plan, Bildkarten, optional Grundkarte) über das Teilen-Menü des Geräts oder als Download; kleine Pläne als QR-Code/Link (der Plan steckt im Link nach dem `#`, kein Server).
- **Importieren:** `.astac`, TacMap `.tacmap`, as-tac 0.x `.astac.zip`/Plan-JSON, Kartenpakete `.astac-map.json`. Alte as-tac-Pläne im Browser werden beim Start angeboten.
- **Live-Zusammenarbeit:** mehrere Admins planen gleichzeitig, Zuschauer sehen alles nur lesend, Admin-Chat, Einladungscodes mit QR. Gleichzeitige Änderungen am selben Objekt werden angezeigt statt still überschrieben.
- **Datenschutz:** Die eigene GPS-Position wird nie übertragen und nur auf ausdrücklichen Wunsch als Pfad gespeichert. «Streamer Safe» blendet Navigation, eigene Position, Planungs- und Freundinformationen aus.
- **Darstellung:** Tag, Dunkel, Rotlicht; grosse Touch-Ziele; Telefon mit Bottom Sheet, Desktop mit Seitenpanel.

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

Die beiden Werte werden beim Build eingebunden; ohne sie läuft die App rein lokal. Nie einen `service_role`- oder `sb_secret`-Schlüssel verwenden.

## Was geprüft ist – und was nicht

- Geprüft: Typprüfung, Unit-Tests (Geometrie, MGRS, Speicher, Undo mit Partnern, Dateiformate, ZIP-Grenzen, TacMap-Umwandlung, Live-Migration und RLS unter PGlite, gleiche Regeln im lokalen Testmodus), Browser-Szenarien in Chromium (Werkzeuge, Panels, Bildkarten mit erzeugtem Bild und Ablehnung ungültiger Bilder, Feld mit simuliertem GPS/Kompass, Teilen/Import, Live im lokalen Testmodus mit drei Tabs), auch gegen die nginx-Konfiguration aus `docker/`.
- **Nicht** geprüft: echte Geräte (iPhone, Android) und echte Sensoren, Safari/WebKit, ein echtes Supabase-Projekt (Realtime, Storage, Auth), Offline-Betrieb auf einem installierten Telefon, der Docker-Build selbst, die Erkennung bekannter Eventkarten (braucht die eigene Bilddatei: `node tests/e2e/images.mjs <ordner> <eventkarte>`).

## Lizenzen

Kartendaten © OpenStreetMap-Mitwirkende, ODbL 1.0 (`public/licenses`). Eventkarten Dritter werden nicht mitgeliefert, nur erkannt, wenn Nutzer sie selbst importieren.
