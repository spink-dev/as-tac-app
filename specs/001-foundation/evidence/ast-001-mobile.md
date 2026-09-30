# AST-001 — Nachweisprotokoll

Stand 2026-10-01. Implementierung vorhanden; M0 noch nicht abgenommen, reale Telefone fehlen.

## Automatisiert

Kommandos: `npm run check`, `npm run build`, `npm test`.

Die Playwright-Tests verwenden den echten statischen Produktionsbuild und Chromium mit 393 × 852 CSS-Pixeln. Sensorwerte sind simuliert, dies ist keine iPhone-/Android-Emulation der Sensorhardware.

Geprüfte Szenarien und Resultate werden nach dem finalen Lauf unten ergänzt. Testbilder: `test-results/offline-mobile.png` (neu erzeugbar, nicht eingecheckt).

## Karten

| Gebiet | OSM-Datenstand UTC | GeoJSON Bytes | Objekte |
| --- | --- | ---: | ---: |
| Mahlwinkel | 2026-09-30 23:07:04 | 270784 | 370 |
| Zürich/Benglen | 2026-09-30 23:19:20 | 1584568 | 4086 |

Manifest und Hash je Gebiet unter `public/maps/*.json`. Die Bytezahl des gesamten Offline-Builds erscheint nach `npm run build` sowie in der App; sie umfasst beide Karten, JS/Worker, CSS, Manifest, Icons und Lizenzen.

## Reale Gerätematrix — noch nicht durchgeführt

| Gerät | Modus | OS / Browser-Version | Flugmodus-Kaltstart | GPS/Genauigkeit/Alter | Startzeit / erster Fix |
| --- | --- | --- | --- | --- | --- |
| iPhone 16 Pro | Safari | ausstehend | ausstehend | ausstehend | ausstehend |
| iPhone 16 Pro | Zum Home-Bildschirm | ausstehend | ausstehend | ausstehend | ausstehend |
| Samsung Galaxy A24 | Chrome | ausstehend | ausstehend | ausstehend | ausstehend |
| Samsung Galaxy A24 | Installierte PWA | ausstehend | ausstehend | ausstehend | ausstehend |

## Ablauf auf jedem Telefon

1. Den Inhalt von `dist/` unter einem vertrauenswürdigen HTTPS-Ursprung öffnen. HTTP über LAN-IP genügt für GPS/Service Worker nicht. HTTPS-Hosting ist noch nicht eingerichtet.
2. Online beide Gebiete ansehen, Credits/Labels prüfen, „Offline bereit“ abwarten. „Speicher sichern“ drücken und tatsächliche Antwort notieren. OS/Browser, Build-ID und Paketgrösse festhalten.
3. PWA installieren bzw. unter Safari zum Home-Bildschirm hinzufügen. App und Browser vollständig schliessen. Flugmodus einschalten, WLAN ausdrücklich aus. App erneut starten.
4. Mahlwinkel und Zürich/Benglen auswählen, zoomen/verschieben, Labels und Attribution prüfen. Kartenstartzeit unter „Prüfdaten & Credits“ notieren.
5. Draussen „Meine Position“ drücken, Freigabe erteilen. Zeit bis erster Fix, Genauigkeit, Fix-Alter notieren. In Zürich ist der Benglen-Ausschnitt zu verwenden; ausserhalb davon muss die Gebietswarnung sichtbar sein.
6. Karte von Hand verschieben: Folgen pausiert. „Position folgen“ stellt Follow wieder her. Bei Position ausserhalb des Gebiets bleibt die Karte sichtbar.
7. Standortfreigabe entziehen bzw. GPS deaktivieren: Fehlerzustand/alter Fix, keine scheinbar aktuelle Position. Über 30 Sekunden ohne Fix: VERALTET. GPS stoppen, erneut starten.
8. Wieder online: neue Build-Version bereitstellen; kein ungefragter Reload. Update bewusst installieren, Offline-Kaltstart wiederholen.
9. Website-Daten löschen: App darf ohne erneute Vorbereitung keinen funktionierenden Offline-Kaltstart versprechen. Nach Vorbereitung wieder testen.

Kein Hintergrund-GPS-, Akku-/30-Minuten-Feldtest oder Mehrgeräte-Sync-Nachweis aus diesem Protokoll ableiten. Abnahme M0 erst nach ausgefüllter Gerätematrix und Bewertung eventueller Fehler.

## Ergebnis des finalen automatisierten Laufs

- `npm run check`: 0 Fehler, 0 Warnungen, 0 Hinweise.
- `npm run build`: erfolgreich. MapLibre erzeugt erwartbar einen JS-Chunk über 500 kB; keine Behauptung kleiner initialer Downloads.
- `npm test`: **6 bestanden**, 4.9 Sekunden Gesamtlaufzeit auf diesem macOS-Rechner mit Desktop Chromium.
- WGS84/Bounds und Genauigkeitskreis; Offline-Seitenneustart mit beiden Gebieten/Labels; keine externen Laufzeitrequests; simuliertes Offline-GPS mit Genauigkeit, Follow-Pause, ausserhalb Gebiet und Stale-State; denied/timeout; fehlende Cache-Datei erkannt und online repariert; kompletter Chromium-Prozessneustart mit erhaltenem Profil und gesperrtem Netz.
- Gemessener Kartenstart beim vollständigen Offline-Prozessneustart: **262 ms**, einzelner Desktop-Messwert, keine Telefonmessung/p95-Aussage.
- Offline-Build `9538361e59dbc1c1`: **19 Ressourcen, 3750631 Bytes** (3.75 MB dezimal). Der Service-Worker selbst liegt zusätzlich im Browser-Registrierungsspeicher.
- Screenshot des mobilen Layouts visuell geprüft. Labels werden bei Platzmangel ausgeblendet; Gebiet und OSM-Attribution bleiben erkennbar.
- Bei der Installation gemeldete Abhängigkeitsprobleme durch Entfernen ungenutzter Starter-Adapter und aktualisierten `@xmldom/xmldom`-Override behoben; abschliessender npm-Install-Audit meldete 0 bekannte Schwachstellen.

Noch nicht verifiziert: reale Sensoren/Flugmodus auf Telefonen, installierter Standalone-Modus, tatsächlicher Speicherdruck/Eviction, Update-Wechsel zwischen zwei ausgelieferten Versionen, Docker und HTTPS-Deployment. Die Cache-Verlustprüfung ist eine gezielte Simulation, kein Speicherdrucknachweis.

## Gebietswechsel auf Nutzerwunsch

Zürich/Uetliberg wurde durch Benglen ersetzt: Bounds `[8.62, 47.349, 8.652, 47.373]`, etwa 2.4 × 2.7 km um Benglen mit Umgebung. Die oben protokollierten ursprünglichen Build-Messwerte bleiben historisch; der aktualisierte Build wird separat geprüft.

Benglen-Build `eac0df3579dfa101`: 19 Ressourcen, 3797684 Bytes. Check ohne Diagnosen, Build erfolgreich, vorhandene 6 Tests bestanden (5.2 s). Offline-Prozessneustart: 282 ms auf Desktop Chromium; weiterhin keine reale Telefonmessung.
