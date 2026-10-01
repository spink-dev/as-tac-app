# AS-TAC Online-Grundlage

Nur AST-009; noch kein Live-Karteneditor. Migration: `migrations/202610010001_online.sql`. Sie setzt Supabase Auth mit `auth.users`, `auth.uid()` und Rollen `anon`/`authenticated` voraus.

## Einrichtung eines separaten Testing-Projekts

1. Supabase-Projekt festlegen. Die Migration zuerst gegen ein leeres Testing-Projekt über den SQL-Editor oder Supabase-Migrationsworkflow anwenden. Nicht ungeprüft gegen eine bestehende Kundendatenbank ausführen.
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
AST_ONLINE_UI_TEST=1 npx playwright test tests/online-ui.spec.ts
npm run build
```

Der abschliessende normale Build entfernt die Testkonfiguration. Diese Fake-Konfiguration niemals deployen. Ohne Konfiguration entstehen keine Auth-/Online-Anfragen.
