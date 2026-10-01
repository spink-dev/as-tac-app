# ADR-002 — Online-Grundlage für AS-TAC

Stand 2026-10-01: Supabase als Implementierungskandidat gewählt; Produktivfreigabe und echter Auth-/Realtime-Integrationstest noch offen.

## Entscheidung und Gründe

PostgreSQL übernimmt Mitgliedschaften, aktuelle Snapshots, Objektversionen und das dauerhaft geordnete Operationsprotokoll. Supabase liefert Auth und PostgREST/RPC für die statische Astro-App. Keine zweite Serverimplementierung und keine clientseitige Rollenautorität. PGlite führt die unveränderte SQL-Migration lokal aus, ersetzt aber keine parallelen Datenbankverbindungen, Supabase Auth, PostgREST oder Realtime.

Alle Tabellenschreibrechte für anon/authenticated sind entzogen. Leserechte benötigen RLS-Mitgliedschaft. Security-Definer-RPCs nutzen einen leeren search_path und leiten die Identität aus auth.uid() ab. Zugriffsänderungen und Planmutationen sperren dieselbe Projektzeile; Rollenprüfung erfolgt nach dem Lock. Owner kann Admin/Viewer zuweisen oder entfernen, sich selbst nicht entfernen.

`ast_apply` prüft pro Element die erwartete Version und bei Strukturänderungen zusätzlich die Projektversion. JSON-Schema, Koordinaten, Geometrie, IDs, Referenzen und Mengenlimits werden serverseitig geprüft. Snapshot, Sequenz und Operation committen gemeinsam. Wiederholung derselben opId/Identität/Payload liefert dasselbe Ergebnis; abweichende Verwendung wird abgelehnt. Tombstone-Versionen bleiben beim Entfernen erhalten. Rollenentzug sperrt auch die Wiederholung alter Operationen.

## Bewusst begrenzter Checkpoint

- Online-Projekte beginnen leer mit den mitgelieferten Karten Benglen/Mahlwinkel. Eigene Online-Karten und Storage-Uploads sind noch nicht eingerichtet.
- Keine Realtime-Publikation/Broadcast-Channels oder Storage-Buckets für diese App. Mitgliedschaft wird bei jedem Snapshot-/Replay-Abruf frisch geprüft. AST-010/011 verwenden berechtigte Snapshot-Abfragen alle 1,5 Sekunden, mit explizitem Konflikt-/Reconnect-Ablauf. Vollständige Snapshots ersetzen inkrementelles Event-Replay und überbrücken Log-Lücken; Bandbreiten-/Lastnachweis bleibt offen.
- Anmeldung über bereits eingerichtete Konten, nur in diesem Tab gespeichert. Kontoanlage/Einladung erfolgt bis zur entsprechenden Oberfläche in Supabase.
- Lokale Projekte, importierte Dateien und GPS werden nicht automatisch übertragen.

## Quellen

[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database Functions](https://supabase.com/docs/guides/database/functions), [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [PGlite](https://pglite.dev/docs/).

AST-012 speichert ablaufende Präsentationsleases separat; lesender RPC prüft auch die aktuelle Rolle des Leiters. Keine Direktrechte auf die Präsentationstabelle. AST-011 speichert bestätigte Kopien und eigene Entwürfe getrennt in einer eigenen IndexedDB; ohne Anmeldung sind nur lokale Vorgänge möglich. Kontofreie Kopien verleihen keine Serverrechte.
