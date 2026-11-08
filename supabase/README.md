# AS-TAC Live (Supabase)

Optionaler Server für die Live-Zusammenarbeit. Ohne ihn funktioniert AS-TAC vollständig lokal; der lokale Testmodus zeigt dasselbe Verhalten zwischen Browser-Tabs.

## Sicherheitsmodell

- Clients schreiben **nie** direkt in Tabellen. Jede Änderung ist eine `security definer`-Funktion mit festem `search_path`, die zuerst die Rolle prüft (`live_require`).
- Lesen über RLS: nur Mitglieder eines Plans sehen Plan, Mitglieder und Objekte. Der Admin-Chat ist für Zuschauer unsichtbar. Einladungen sind ohne Funktion gar nicht lesbar.
- Rollen: `owner` (genau einer, nicht entfernbar), `admin` (planen, Zuschauer einladen, chatten), `viewer` (nur lesen). Admin-Einladungen erstellt nur der Besitzer. Ein Code nimmt nur neue Mitglieder auf und ändert nie die Rolle eines bestehenden Mitglieds (auch nicht nach oben) und vergibt nie `owner`; er gilt nur, solange seine Erstellerin die Rolle dafür noch hat. Rollen ändert allein der Besitzer (`live_set_role`); wer zum Zuschauer wird, verliert seine offenen Einladungen. Entfernte Mitglieder werden gesperrt und kommen mit keinem Code zurück, bis der Besitzer die Sperre aufhebt (`live_unban`); einzelne Codes widerruft `live_revoke_invite`.
- Gleichzeitigkeit: Jede Operation trägt die Version, auf der sie beruht (`base`). `live_push` wendet sie nur an, wenn diese Version noch aktuell ist, sonst kommt der aktuelle Serverwert als Konflikt zurück. Ein Objekt reist unter seiner eigenen ID (`data.id` = `entityId`, ausser `meta`/`order`). Löschungen bleiben als Grabstein (`data = null`) mit Sequenznummer sichtbar.
- Client: Jede noch nicht bestätigte Änderung liegt pro Objekt in IndexedDB (`liveOutbox`) und übersteht Neuladen und Funklöcher. Ein Konflikt wird nur gemeldet, wenn beide Seiten wirklich Verschiedenes wollen; eine verlorene Bestätigung oder eine unveränderte Gegenseite wird still aufgelöst.
- Schwaches Netz: Abgleich in Seiten (Grösse passt sich an, bis hinunter zu einem Objekt), jede Seite wird angewendet und gemerkt, bevor die nächste kommt. Anfragen werden abgebrochen, wenn 30 s lang nichts mehr ankommt (vor dem ersten Byte: 60 s plus Sendezeit, `stallFetch`) oder wenn sie insgesamt langsamer als etwa 0,5 KB/s für ihre geschätzte Grösse sind; dann folgen kleinere Seiten mit längerer Frist. Eigene Änderungen werden weder über Realtime zurückgeschickt noch erneut heruntergeladen. Koordinaten reisen mit 7 Nachkommastellen (≈ 1 cm).
- Realtime-Filter: `postgres_changes` filtert auf `client_id=neq.<eigenes Gerät>` (nur ein Filter möglich), Zeilen anderer Pläne verwirft der Client. Nachteil: Realtime prüft damit jede Änderung der Tabelle gegen jeden Abonnenten (Last wächst mit allen Nutzenden, nicht pro Plan), und Änderungen in anderen eigenen Plänen gehen über die Leitung. Für einen Server mit vielen gleichzeitigen Plänen später auf Broadcast aus der Datenbank umstellen. Zeilen ohne `client_id` erreicht dieser Filter nicht (SQL-NULL); `live_push` setzt sie immer, und der Abgleich alle 60 s holt sie sonst.
- Bilder: Hochladen im Hintergrund, eines nach dem anderen, ab 6 MB fortsetzbar über den TUS-Endpunkt `/storage/v1/upload/resumable`; Herunterladen in 512-KB-Stücken über eine signierte URL (abgelaufene URLs werden erneuert, empfangene Stücke behalten).
- Grenzen: 500 Operationen pro Aufruf, 1 MB pro Objekt, 60 000 Objekte pro Plan (inkl. Grabsteine), IDs 1–80 Zeichen, 50 Pläne pro Konto, 20 offene Einladungen pro Plan, Codes 24 Stunden gültig, Chat 30 Nachrichten pro Minute und Person, die letzten 1000 pro Plan bleiben.
- Realtime: private Kanäle `plan:<id>`. Mitglieder empfangen und senden Anwesenheit (Schlüssel = Konto-ID; die angezeigte Rolle kommt aus `live_members`, nicht aus der Anwesenheit); nur Admins dürfen Broadcasts senden. Wer eine Präsentation leitet, ergibt sich allein aus diesen Broadcasts (mit Herzschlag alle 5 s), nie aus der Anwesenheit, deren Inhalt Clients selbst bestimmen.
- Einladungslinks tragen nur den Code und nur im Fragment (`…/#join=CODE`), er erreicht also keinen Server und wird nach dem Öffnen aus der Adresszeile entfernt. Der Browserverlauf kann den geöffneten Link trotzdem enthalten; Codes laufen nach 24 Stunden ab und lassen sich widerrufen.
- Speicher: privater Bucket `live-assets`, Pfad `<plan-id>/<sha256>`, nur Bildtypen, 40 MB. Clients prüfen den SHA-256 jedes heruntergeladenen Bilds. Übertragen werden Bildkarten und Teamlogos; Dateianhänge an Objekten bleiben auf dem Gerät, auf dem sie angehängt wurden (Weitergabe per `.astac`).
- Keine Spalte und keine Nachricht enthält GPS-Positionen oder eigene Pfade.

## Einrichten

1. Neues Supabase-Projekt (nicht eine bestehende Datenbank) und Migration `migrations/20261108000001_live.sql` anwenden.
2. Auth: «Anonymous sign-ins» aktivieren (Geräte-Anmeldung). Optional E-Mail mit Magic Link; als Redirect-URL die Adresse der App eintragen. Captcha-Schutz und Auth-Ratenlimits einschalten: anonyme Konten entstehen beliebig neu, die Grenzen pro Konto (z. B. 50 Pläne) liessen sich sonst vervielfachen.
3. Realtime: in den Realtime-Einstellungen nur private Kanäle zulassen.
4. Im App-Ordner `.env` anlegen:
   ```
   VITE_SUPABASE_URL=https://<projekt>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   Nur den Publishable Key verwenden, nie `service_role`/`sb_secret`. Die Werte werden beim Build eingebunden (`npm run build`, Docker: `--build-arg`).

## Prüfen

`tests/unit/live-db.test.ts` führt die echte Migration unter PGlite aus (mit nachgebildetem `auth.uid()`): Lesen nur für Mitglieder, keine Schreibrechte für Zuschauer und Fremde, Konflikt statt Überschreiben, Grabsteine, Chat nur für Admins, Rollenregeln, Einladungen und Sperren, ungültige Eingaben (falsche oder zu lange IDs). `tests/unit/loopback.test.ts` prüft, dass der lokale Testmodus dieselben Regeln durchsetzt.

Nicht geprüft wurde ein echtes Supabase-Projekt: Realtime (`postgres_changes`, private Kanäle, Anwesenheit), Storage-Richtlinien und Auth laufen hier nur gegen die Supabase-Clientbibliothek, nicht gegen einen Server. Vor dem Einsatz mit zwei Geräten prüfen: Beitritt per Code, Zuschauer kann nichts ändern (auch nicht per direktem REST/RPC-Aufruf), gleichzeitige Änderung zeigt den Konflikt, Bildkarte erscheint beim Partner.
