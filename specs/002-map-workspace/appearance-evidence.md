# Prüfstand — Branding und Darstellung 0.5.0-alpha.2

2026-10-01. Eigene Vektoridentität, App-Icons, Panel-Palette, Tag/Dunkel/Rotlicht. Kein neues Projektformat, kein Backend-Schemawechsel.

## Verifiziert

- `npm run check`: 62 Dateien, keine Fehler/Warnungen/Hinweise.
- `npm run build`: erfolgreich, Offline-Inventar enthält auch die Markenassets; bestehende Warnung zur Grösse des MapLibre-Bundles bleibt.
- Gesamter Chromium-Lauf: 52 bestanden, 1 konfigurationsabhängiger Backend-Test übersprungen, 1 Update-Test zunächst mit Timeout. Isolierter Update-Test danach bestanden; anschliessender vollständiger Offline-/Workspace-/Darstellungslauf: 13 bestanden.
- Nach der abschliessenden Anpassung für gut erkennbare dunkle Planfarben: Chromium-Darstellung/Editor/Briefing, 9 bestanden.
- WebKit: beide Darstellungsprüfungen bestanden. Laufende Zeichnung, offene Attribute und gespeicherte Objektfarbe bleiben beim Umschalten erhalten; Rotlicht wird nach Neustart wiederhergestellt. Mit nicht erreichbarem Testserver wird das gespeicherte Projekt samt Karte aus dem Cache geöffnet.
- Vor-React-Initialisierung mit blockiertem React-Bundle geprüft; gesperrter Local Storage verhindert den Moduswechsel nicht.
- Screenshots für mobile Tag-/Dunkel-/Rotlicht-Bedienung und Desktop-Panels visuell geprüft. Systemnahe Konturicons, Rotlicht auch auf Kartensteuerung, Labels, Plan-/Briefing-Markierungen und Formularen.
- UI-Textkontraste gegen die Panel-Fläche (normal / sekundär / Akzent): Tag 13.76 / 5.42 / 5.65, Dunkel 13.66 / 7.40 / 7.15, Rotlicht 6.48 / 5.44 / 6.97.

## Testgrenzen

Playwright 1.63 WebKit bricht Service-Worker-Navigation bei `context.setOffline(true)` vor der Cache-Antwort ab: [Upstream #42775](https://github.com/microsoft/playwright/issues/42775). Der WebKit-Nachweis schaltet deshalb einen isolierten lokalen HTTP-Origin tatsächlich ab und prüft dessen Nichterreichbarkeit. Chromium verwendet weiterhin die Offline-Emulation. Die simulierte Netzwerkstatusanzeige ist nicht Teil dieses WebKit-Nachweises.

Keine echte Geräte-/Nachtprüfung: iPhone 16 Pro und Galaxy A24 bleiben offen. Der Rotmodus stellt Teamfarben einfarbig dar und verändert keine Projektfarben. Hardwarehelligkeit, Tastatur, Browser-/Systemdialoge sowie PWA-Startbildschirm kann die App nicht vollständig steuern. Manifest-Startfarbe ist dauerhaft dunkel. Keine Unsichtbarkeitsgarantie.

Push/Deployment sind getrennt: der Git-Stand auf `testing` ist der Preview-Kandidat für `test.as-tac.dev`; eine laufende Domain-Bereitstellung wird dadurch nicht belegt.
