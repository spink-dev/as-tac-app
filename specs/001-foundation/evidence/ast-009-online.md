# AST-009 — Online-Grundlage

Preview 0.4.0-alpha.1: SQL-Migration mit RLS, Owner/Admin/Viewer, serverseitiger Schema-/Referenzvalidierung, Objekt-/Strukturversionen und dauerhaftem idempotentem Operationsprotokoll. Supabase-Client sowie Anmeldung, Projektübersicht und Mitgliederverwaltung.

Nachweise: vier Tests führen die SQL-Migration unter PGlite/PostgreSQL aus (Rollen, direkte Schreibversuche, CAS, Sequenz, Replay, Tombstones, Idempotenz, Rollenentzug, alle Geometrien, atomare Validierungsfehler). Konfigurierter Browserablauf Login → Projekt → Viewer hinzufügen/entziehen → Logout mit kontrollierten HTTP-Antworten bestanden.

Offen: Supabase-Projekt/Hosting, echte Auth-/JWT-/PostgREST-Integration, parallele PostgreSQL-Sessions, Realtime-/Subscription-Abnahme. Docker-Daemon lokal nicht erreichbar. Keine Behauptung fertiger Live-Kollaboration. Karteneditor bleibt lokal; keine vorgezogene Zivilschutz-Spezialisierung. Siehe ADR-002 und `supabase/README.md`.

Abschluss: Typprüfung ohne Fehler/Warnungen, Produktionsbuild erfolgreich, 38 Tests bestanden; zusätzlich der konfigurierte Login-/Mitgliederfluss mit kontrollierten API-Antworten. Test-URL anschliessend aus dem lokalen Build entfernt.
