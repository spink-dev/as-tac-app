# AST-010–012 — gemeinsamer Editor, Entwürfe und Briefing

2026-10-01 · Preview `0.4.0-alpha.2`. Implementiert und lokal geprüft; kein Nachweis eines eingerichteten Supabase-Projekts oder bestandener Geräteabnahme.

## Verhalten

- Online-Projekt ausdrücklich auf der Karte öffnen. Owner/Admin bearbeiten mit den vorhandenen sechs Werkzeugen, Teams und Phasen. Viewer lesen bestätigte Änderungen. Lokale Projekte bleiben separat.
- Rollenprüfung und vollständiger, atomarer Snapshot alle 1,5 Sekunden nach Abschluss der vorherigen Abfrage. Sequenzen dürfen nicht zurücklaufen. Vollständige Snapshots überbrücken ausgelassene Events und Log-Verdichtung; kein ungesichertes Broadcast-/Realtime-Abonnement. Die REST/RPC-Abfragen bleiben durch RLS bzw. aktuelle Mitgliedschaften geschützt.
- Ein zusammengehöriger Schreibversuch wird vor dem Senden in IndexedDB gespeichert. Operations-ID und Payload bleiben bei unklarer Antwort erhalten. SDK-Wiederholungen sind abgeschaltet, Anfragen auf zehn Sekunden begrenzt. Bestätigung erst nach Serverantwort und passendem Snapshot.
- Ohne Verbindung entsteht ein getrennter Entwurf; weitere noch nicht gesendete Aktionen werden zu einem atomaren Batch zusammengefasst. Während eines unklaren Sendestatus bleibt weiteres Ändern gesperrt. Wiederverbindung gleicht nur bestätigte Operations-IDs ab und sendet nichts automatisch.
- Konfliktansicht zeigt eigene und aktuelle Werte pro Objekt. Eigene Werte müssen ausdrücklich ausgewählt/publiziert werden. Ein inzwischen erneut geänderter Vergleichsstand sperrt Publikation bis zum neuen Vergleich; der Server führt abschliessend CAS durch. Ungültige Referenzen bleiben abgewiesen.
- Formulare und Ziehbewegungen behalten ihren Ausgangsstand. Updates anderer Admins ersetzen keine laufende Eingabe. Explizites Verwerfen lädt den aktuellen Stand. Online-Undo/Redo sind neue Operationen und stoppen vor inzwischen veränderter fremder Arbeit.
- Bestätigte Snapshots und Entwürfe bleiben auf diesem Gerät gespeichert. Unter „Gesicherte Online-Projekte ohne Anmeldung öffnen“ ist die lokale Offline-Kopie zugänglich; dort werden keine Servermutationen ausgeführt. Ein vormals berechtigter Admin kann einen getrennten Entwurf weiter bearbeiten. Nach Anmeldung entscheidet ausschliesslich die frische Serverrolle über Publikation. Bereits gespeicherte Kopien sind durch Rollenentzug nicht rückholbar.
- Vollständiger `.astac.zip`-Export auch aus der Online-/Offline-Kopie; unbestätigte Entwürfe werden ausdrücklich so bezeichnet. JSON bleibt zusätzliche Notfallsicherung. Web Locks verhindern konkurrierendes Bearbeiten derselben Konten-/Projektkombination in mehreren Tabs.
- Exklusive Briefing-Leitung pro Sitzung mit 20-Sekunden-Lease. RPCs sperren dieselbe Projektzeile wie Mitgliedschaftsänderungen und prüfen Rollen, Phase und Kamera. Viewer können keine Leitung übernehmen. Präsentationszustand schreibt weder Plan noch Operationssequenz.
- Folgen ist standardmässig aus. Phasen/Kamera werden nur nach bewusstem Einschalten übernommen; Aussteigen erlaubt unabhängige Phasenwahl. Bei Verbindungsfehler/abgelaufener Leitung wird Folgen ausgeschaltet. Temporäre Zeichnungen bleiben lokal; Übernahme in den Plan ist weiterhin eine bewusste autorisierte Aktion.
- GPS bleibt ausschliesslich lokal. Übernommene Referenzen unverändert; keine neue FieldMaps-/TacMap-Codekopie.

## Prüfungen

`npm run check`: 49 Dateien, 0 Fehler/Warnungen/Hinweise. Normaler Produktionsbuild und komplette Playwright-Suite: 45 bestanden in 38,7 Sekunden; der konfigurierte Online-Browserfall wird im normalen Build bewusst ausgelassen und separat ausgeführt. Konfigurierter SQL-/Browserlauf zunächst 12 bestanden; abschliessend auf 0.4.0-alpha.2 die beiden konfigurierten Browserabläufe erneut bestanden (10,5 Sekunden). Kausales Undo/Redo ist im vollständigen Lauf enthalten. Normaler Build danach ohne Testkonfiguration wiederhergestellt: Manifest `75bd07c4e525a348`, 18 Ressourcen, 3 964 461 Bytes. Der konfigurierte Browserdurchlauf wird zusätzlich mit folgenden Befehlen geprüft:

```sh
PUBLIC_SUPABASE_URL=https://as-tac-test.invalid PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_only npm run build
AST_ONLINE_UI_TEST=1 npx playwright test tests/online-database.spec.ts tests/online-ui.spec.ts
npm run build
```

`online-database.spec.ts` führt beide unveränderten SQL-Migrationen unter PGlite aus. Zwei Admin-Controller, ein Viewer, Konflikt, Neustart, verlorene Antwort, Rollenentzug, Speicherfehler, Offline-Batch, laufendes Formular und kausales Undo/Redo werden gegen diese SQL-Funktionen geprüft. Der konfigurierte Chromium-Test verwendet getrennte Browserprofile, echten Editor und echte IndexedDB. HTTP wird an dieselbe SQL-Implementierung vermittelt; der Auth-Token ist eine Testantwort. Phasen-Folgen/-Pausieren und kontofreies Wiederöffnen eines Offline-Plans werden ebenfalls durchgespielt.

## Grenzen und nächste Abnahme

- PGlite hat eine einzelne Verbindung. Noch kein Nachweis echter gleichzeitiger PostgreSQL-Verbindungen, Supabase JWT/PostgREST-Konfiguration, produktiver Last oder p95 unter zwei Sekunden bei 3 Admins/20 Mitgliedern. Der Snapshot-Transport ist einfach und zuverlässig prüfbar; Bandbreite/Last vor produktiver Freigabe messen.
- Online-Karten vorerst Benglen/Mahlwinkel. Eigene Gebiete bleiben lokal/portabel; kein ungeprüfter gemeinsamer Storage-Upload. Konten werden in Supabase eingerichtet. Login ist tablokal, keine dauerhaften Tokens im Offline-Cache.
- Browser-Speicher kann vom Betriebssystem gelöscht werden. Nicht abgeschlossene Texteingaben sind kein gespeicherter Entwurf; vor Beenden übernehmen. Export/Backup für wichtige Pläne nutzen. Keine Behauptung einer bestandenen Safari-/Android-Hardwareprüfung.
- Noch offen: Supabase-Testing-Projekt konfigurieren, Migrationen anwenden, öffentliche Build-Konfiguration setzen, echte Mehrgeräte-/Rollen-/Reconnect-Abnahme durchführen. `testing` gehört zu `test.as-tac.dev`, `main` zu `test-prod.as-tac.dev`; Push allein beweist keinen Deploy.
- AST-014 und AST-001/007/008-Gerätegates bleiben offen. P1 AST-015/016 sowie Zivilschutz-Spezialisierungen sind kein vorgezogener Teil dieses Stacks.
