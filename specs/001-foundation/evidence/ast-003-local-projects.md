# AST-003 — lokale Projekte und persistente Commands

2026-10-01 · auf Implementierungsebene abgeschlossen. Quelle: Vault `projects/as-tac/`, lokale Spec F01 sowie Domänen-/Persistenzvertrag. Die separate AST-001-Geräteabnahme bleibt offen.

## Umsetzung

- Projekt ohne Konto erstellen, öffnen, umbenennen, duplizieren und bestätigt löschen. Name und gewähltes Gebiet speichern automatisch nach 250 ms Ruhe; beim Verbergen der Seite wird zusätzlich ein Speicherversuch ausgelöst.
- Schema 1: WGS84 `[longitude, latitude]`, Punkte/Linien/Polygone/Kreise/Text/Freihand, Teams, Phasen und Referenzen. Kreise behalten Zentrum und Meter-Radius. Endliche Zahlen, Bereiche, eindeutige IDs, Text-/Vertex-Limits und Referenzen werden vor dem Schreiben geprüft. Unbekannte Felder, insbesondere versehentlich angehängte GPS-Daten, werden abgelehnt.
- Atomare Command-Batches mit inversen Änderungen. 50 Undo-Schritte pro geöffneter Sitzung; aufeinanderfolgende Namenseingaben werden zusammengefasst. Duplikate erhalten neue IDs inklusive aller internen Verweise. Team-/Phasen-/Zeichenoberflächen bleiben AST-005/006.
- Native IndexedDB mit zwei Stores (`projects`, `backups`). Für diesen kleinen Transaktionsumfang ist keine zusätzliche Dexie-Abhängigkeit nötig. Daten, lokale Änderungsmarkierung und Revision werden gemeinsam geschrieben. „Gespeichert“ folgt ausschliesslich auf `transaction.oncomplete`.
- Vergleich der erwarteten Revision verhindert verlorene Änderungen durch parallele Tabs oder das Wiederbeleben zwischenzeitlich gelöschter Projekte. Änderungen während eines laufenden Schreibens werden anschliessend mit neuer Revision gespeichert; der ältere Commit bestätigt nicht den neueren Entwurf.
- Speicherfehler bewahren den aktuellen Entwurf im Arbeitsspeicher. Wiederholen, neue Projektkopie und JSON-Notfallsicherung sind möglich. Wechsel/Löschen/Update-Neustart sind bei ungespeicherten Daten gesperrt. Der Service-Worker prüft auch unmittelbar vor einem Reload erneut, ob dieser zulässig ist.
- Erstes veröffentlichtes lokales Schema; AST-001/002 speicherten keine Projekte. Es gibt bewusst keine erfundene Legacy-Konvertierung. Die explizite Migrationstransaktion wird mit einer Fixture-Transformation geprüft: Originalkopie und validierter neuer Stand committen gemeinsam oder gar nicht. Unbekannte Versionen werden beim normalen Laden nicht verändert; Original-JSON bleibt abrufbar.
- Keine zusätzliche Bibliothek, kein übernommener Referenzcode und keine GPS-/Netzspeicherung hinzugefügt.

## Nachweis

Produktionsbuild, Chromium auf diesem Rechner; kein Telefon-/Safari-Nachweis.

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | 0 Fehler, 0 Warnungen, 0 Hinweise |
| `npm run build` | bestanden; Offline-Build `a5a8e4e6be41d392`, 17 Ressourcen, 3'815'063 Bytes |
| `npm test` | 16/16 bestanden, letzter Lauf 14,4 s |
| Modell und Commands | WGS84-/Schema-/Referenzfehler abgelehnt, atomare Änderungen invertiert, Reihenfolge und Duplikatverweise erhalten |
| Browser-IndexedDB | Commit inkl. Metadaten; absichtlicher Transaktionsabbruch erhält alten Stand; veraltete Revision und Löschkonflikt erkannt |
| Migration | ungültige Ausgabe/ID/Versionswechsel und Exception verändern keine Daten; Abbruch rollt Originalbackup und Ersatz zurück; erfolgreicher Testlauf sichert Original |
| Projektablauf | Erstellen, Umbenennen, Undo/Redo, offline neu öffnen, Duplizieren, Löschen/Abbrechen und Wiederöffnen bestanden |
| Kaltstart | gespeichertes Projekt über vollständigen Chromium-Prozessneustart mit persistentem Profil offline erhalten |
| Quota-Fehler | durch injizierte QuotaExceededError simuliert; Entwurf bleibt sichtbar, Navigation gesperrt, JSON-Download und erneutes Speichern funktionieren |
| Zwei Tabs | zweiter Entwurf überschreibt ersten Commit nicht; Rettung als neues Projekt erhält beide |
| Laufender Commit | Transaktion im Browser absichtlich offen gehalten; spätere Eingabe erst nach eigenem Commit als gespeichert bestätigt |
| App-Updates | bei Speicherfehler kein Update-Klick möglich; nach erfolgreichem Speichern bleiben Name/Gebiet über Neustart erhalten |
| Offline-/GPS-Regression | beide Gebiete, Labels, Worker-Fetch-Regressionsfall, Cache-Reparatur, Update-Rollback und simulierte GPS-Zustände bestanden |

Mobilformat 393 × 852: Screenshot `test-results/projects-mobile.png` geprüft, Offline-Karte Benglen mit Labels und Projektpanel sichtbar. Testartefakte sind ignoriert und werden beim Testlauf neu erzeugt. Die bekannte Build-Warnung zum grossen MapLibre-Chunk bleibt.

## Grenzen und Fortsetzung

- Tatsächliche IndexedDB-Quota-Erschöpfung, Safari/iOS-PWA, Samsung-Galaxy-A24-/iPhone-16-Pro-Speicherverhalten sowie GPS-Feldlauf noch nicht geprüft. Browser-/OS-Abbruch kann ungespeicherte Daten verlieren; `beforeunload` ist keine mobile Haltbarkeitsgarantie.
- Undo-Historie ist sitzungsbezogen, kein Online-Operationslog. Keine Serverrevision oder Cloud-Synchronisierung aus `localChanges` ableiten.
- Notfall-JSON ist kein portables Paket und wird noch nicht über eine Benutzeroberfläche importiert. Originalbackups für explizite spätere Migrationen bleiben im separaten Store erhalten.
- App-Start öffnet das alphabetisch erste lesbare Projekt; letzte Auswahl und Undo-Historie werden nicht persistiert.
- Next: AST-004 — Gebietspakete, freie Gebietsauswahl, Hash/Quota/Abbruch und atomarer Paketwechsel. Danach AST-005-Karteneditor.
- Integration zunächst auf `testing` für `test.as-tac.dev`; `main` / `test-prod.as-tac.dev` bleibt bestehende Produktion. Hosting-Auslieferung nicht durch diese lokalen Tests belegt.
