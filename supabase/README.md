# AS-TAC Online-Grundlage

AST-009–012: Auth, gemeinsamer Editor, Konflikte und Briefing. Alle Migrationen in Reihenfolge anwenden: `migrations/202610010001_online.sql`, danach `migrations/202610010002_briefing.sql` und `migrations/202610010003_workspace.sql`. Sie setzt Supabase Auth mit `auth.users`, `auth.uid()` und Rollen `anon`/`authenticated` voraus.

## Einrichtung eines separaten Testing-Projekts

1. Supabase-Projekt festlegen. Die Migrationen zuerst gegen ein leeres Testing-Projekt über den SQL-Editor oder Supabase-Migrationsworkflow anwenden. Nicht ungeprüft gegen eine bestehende Kundendatenbank ausführen.
2. Testkonten für Eigentümer, Admin und Mitglied über Supabase Auth einrichten. E-Mail/Passwort-Login aktivieren; echte Auth-/Passwortrichtlinien dort konfigurieren.
3. `.env.example` nach `.env` kopieren und öffentliche Projekt-URL sowie Publishable-Key setzen. Niemals `service_role`/`sb_secret` als PUBLIC-Konfiguration verwenden.
4. App neu bauen und auf Testing deployen. Unter „Online-Projekte & Mitglieder“ anmelden, ein leeres Online-Projekt erstellen und über die angezeigte Konto-ID weitere Konten hinzufügen.
5. Mit zweitem Browser Konto-/Rollenwechsel und direkten abgewiesenen REST/RPC-Schreibversuch prüfen. UI-Ausblendung allein ist kein Rollenbeweis. Snapshot/Operationsabruf nach Mitgliedschaftsentzug muss scheitern bzw. keine Daten liefern.

Die aktuelle Migration erstellt weder Storage-Bucket noch Realtime-Publikation. Diese Zugriffswege sind kein Teil dieses Checkpoints. Kein Service-Key im Client, keine automatischen Uploads lokaler Pläne.

## Prüfungen

`npm run check`, `npm run build`, `npm test`. `tests/online-database.spec.ts` führt die echte Migration unter PGlite/PostgreSQL aus. Nur Auth-Identität/Rollen werden für den Test vorbereitet. Rollen, CAS, Idempotenz, Rollback und Referenzen werden nicht gemockt. PGlite besitzt eine einzelne Verbindung: echte konkurrierende Sessions und Supabase HTTP-/JWT-/Realtime-Integration bleiben separate Gates.

Konfigurierte Oberfläche mit kontrollierten HTTP-Antworten prüfen:

```sh
PUBLIC_SUPABASE_URL=https://as-tac-test.invalid PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_only npm run build
AST_ONLINE_UI_TEST=1 npx playwright test tests/online-database.spec.ts tests/online-ui.spec.ts
npm run build
```

Der abschliessende normale Build entfernt die Testkonfiguration. Diese Fake-Konfiguration niemals deployen. Ohne Konfiguration entstehen keine Auth-/Online-Anfragen.

## Betrieb dieses Checkpoints

Gemeinsamen Editor über „Gemeinsam auf der Karte öffnen“ starten. Transport ist berechtigungsgeprüftes Snapshot-Polling, keine Realtime-Publikation. Reconnect publiziert Entwürfe ausschliesslich bewusst. Briefing-Leases laufen nach 20 Sekunden ohne Erneuerung aus; der Client aktualisiert etwa alle 1,5 Sekunden.

Astro bindet die beiden öffentlichen Variablen **beim Build** ein. Bei Docker die gleichnamigen `--build-arg PUBLIC_SUPABASE_URL=…` und `--build-arg PUBLIC_SUPABASE_PUBLISHABLE_KEY=…` setzen; reine Container-Laufzeitvariablen ändern die bereits gebaute App nicht. Nur öffentliche Schlüssel verwenden. Der Docker-Daemon war lokal nicht verfügbar; Containerbuild nicht nachgewiesen.

Konkrete Prüfgrenzen und Nutzerabläufe: `specs/001-foundation/evidence/ast-010-012-collaboration.md`. Vor produktiver Freigabe A03–A06/A08 mit echtem Supabase Auth, getrennten Datenbankverbindungen und Geräten durchführen. Hier wurden weder ein Cloud-Projekt angelegt noch Migrationen auf einen externen Server angewendet.


## Root-Kartenstudio / Katalog (0.5.0-alpha.1)

Die dritte Migration erweitert das validierte Projektschema um Ebenen und Event-Metadaten und ergänzt einen öffentlich lesbaren Katalog. Pakete liegen unveränderlich in `ast_private.catalog`, ohne direkte Client-Tabellenrechte. `ast_publish` prüft die aktuelle Root-Zuordnung separat von Projektmitgliedschaften. Owner/Admin sind dadurch **nicht** Root. Root darf vorbereitete, für öffentliche Verteilung bestimmte Kartendaten veröffentlichen; die Quellenverantwortung bleibt beim Herausgeber. Kartenpakete werden vor Upload und bei Installation vom Client vollständig auf Geometrie, Grenzen, Grösse und SHA-256 geprüft. Der Server begrenzt zusätzlich Dokument, Identität, Lizenz und Paketgrösse; er bestätigt keine fachliche Kartenqualität.

Root-Zuordnung ausschliesslich mit administrativem Datenbankzugriff nach Festlegen des Kontos, z. B. im Supabase-SQL-Editor:

```sql
-- Die tatsächlich vorgesehene Auth-Konto-ID einsetzen, keine E-Mail oder Projekt-ID.
insert into ast_private.roots(user_id) values ('ROOT-AUTH-USER-UUID');
-- Entzug:
-- delete from ast_private.roots where user_id = 'ROOT-AUTH-USER-UUID';
```

Kein Client-RPC zum Ernennen weiterer Roots. Keine Root-Konten automatisch angelegt. `ast_catalog` / `ast_catalog_package` liefern ausschliesslich bereits veröffentlichte Daten. Gleiche Gelände-/Event-/Ausgabe-Kombinationen lassen sich auch durch Root nicht überschreiben. Der aktuelle Client erfasst Metadaten und editiert Geometrie lokal; Publikation geschieht ausdrücklich über „Diese Ausgabe veröffentlichen“. Backend, Auth-Konto, Migrationen und Hosting sind in dieser Arbeitsumgebung nicht bereitgestellt worden.

## Darstellungsoptionen (0.6.0)

Vor neuen Online-Clients zusätzlich `202610010004_symbols.sql` anwenden. Die Migration erweitert nur das validierte Styleschema; Rollen/RLS bleiben unverändert. Alte Dokumente sind weiterhin gültig, ältere App-Versionen können Dokumente mit neuen Stilfeldern jedoch nicht lesen. Client-Versionen gemeinsam aktualisieren. GPS-Aufnahme und Abgleich erzeugen keine neuen Backend-Endpunkte.
