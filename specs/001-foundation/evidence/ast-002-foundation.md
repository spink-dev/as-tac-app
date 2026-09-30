# AST-002 — App-Grundstruktur

2026-10-01 · Implementierung abgeschlossen, Geräte-/Hosting-Abnahme separat.

## Ergebnis

Die App-Einstiegsseite enthält eine React-Insel ohne Prüfstand-Texte, Messwert-Panel oder Testanleitung. Der alte Prüfstand bleibt auf `feature/ast-001-mobile-proof` inklusive Offline-Fix erhalten. `main` enthält die funktionale Karte ohne den Test-Frame. Automatisierte Tests bleiben im Repository und werden nicht in `dist/` ausgeliefert.

Kartenrenderer, GPS-Lifecycle und Offline-Lifecycle sind getrennte Module. Die GPS-Logik importiert weder MapLibre noch Netzwerkcode. Manifest, statischer Build und vollständig lokale Ressourcen bleiben erhalten. `src/config/maps.json` vereinheitlicht Gebietsauswahl, Download-Vorgaben und Build-Prüfung. Deutsche App-Texte liegen in `src/i18n/de.ts`. Unbenutzte Astro-Starter-Komponenten und Assets entfernt.

Service-Worker-Listener werden beim Unmount aufgeräumt; eine bereits laufende Installation wird auch nach Registrierung beobachtet. Ein neues Update aktiviert sich weiterhin erst per Klick; ein kaputtes Update erhält den vorherigen Cache. Keine automatische GPS-Übertragung, kein Projektmodell, kein Editor und keine Online-Kollaboration hinzugefügt.

## Prüfungen

- `npm run check`: keine Fehler, Warnungen oder Hinweise.
- `npm run build`: erfolgreich; bekannter MapLibre-Chunk-Hinweis über 500 kB bleibt.
- `npm test`: **8 bestanden** (7.4 s, Desktop Chromium mit mobilem Viewport).
- Die sieben AST-001-Prüfungen bleiben erhalten, einschliesslich simuliertem Worker-Netzfehler und Offline-Prozessneustart.
- Neue gezielte Update-Prüfung: neue Version bleibt wartend, aktive Gebietsauswahl bleibt erhalten, erst expliziter Klick aktiviert und lädt neu. Eine weitere Version mit absichtlich falschem GeoJSON-Hash scheitert bei der Installation; danach startet die vorherige Version offline mit Benglen ohne Kartenfehler.

## Grenzen und nächste Schritte

Die echte iPhone-/Galaxy-Abnahme ist nicht nachgeholt. M0 wird dadurch nicht als bestanden markiert. Der Nutzer hat den nächsten Umsetzungsschritt trotz dieser offenen Geräteprüfung ausdrücklich beauftragt.

`testing` dient als Deploy-Quelle für `test.as-tac.dev`; `main` gehört zu `test-prod.as-tac.dev`. Hosting-Anbindung, TLS und tatsächliches Preview-Deployment sind ohne Providerzugriff nicht konfiguriert oder bestätigt. Die Test-URL teilt wegen ihres eigenen Origins keinen Offline-Speicher mit der Produktion.

Als Nächstes AST-003 gemäss `tasks.md`: Domäne, Commands, IndexedDB-Transaktionen, Autosave-Zustand, Undo/Redo und Migrationen. Freie Gebietsauswahl folgt AST-004.
