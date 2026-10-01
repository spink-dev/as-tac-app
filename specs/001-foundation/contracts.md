# Daten-, Paket- und Synchronisierungsverträge

Vorgeschlagener Implementierungsvertrag · 2026-10-01. Noch kein veröffentlichtes Dateiformat.

## Domäne und Koordinaten

| Entität | Mindestfelder / Invarianten |
| --- | --- |
| Project | UUID, schemaVersion, name, mapPackageId, teams, phases; lokale ID und optional cloudProjectId getrennt |
| MapPackage | ID, version, bounds WGS84, dataTimestamp, source, attribution, resources, hashes, byteSize, status |
| Element | UUID, projectId, type, geometry, label, notes, teamId?, phaseIds, style, version, deletedAt? |
| Team | UUID, name, shortLabel, colour; ein geplanter Teammarker ist keine Personenposition |
| Phase | UUID, order, title, notes, camera, visibleElementIds |
| LocalDraft | ID, projectId, baseRevision, baseObjectVersions, changes, updatedAt; nie automatisch publizieren |
| Membership | projectId, userId, role = owner/admin/viewer; ausschliesslich serverseitige Autorität |
| Operation | opId, projectId, actorId, objectId, expectedVersion, kind, payload, serverSeq? |
| Snapshot | projectId, serverSeq, schemaVersion, contentHash, data; konsistenter bestätigter Stand |
| PositionFix | lon, lat, accuracyMeters, timestamp, heading?, speed?; nur gerätelokal im MVP |

Geometrie in WGS84 `[longitude, latitude]`, Längen in Metern, Zeitpunkte UTC. Gültigkeitsprüfung auf endliche Werte, Koordinatenbereiche, Vertex-/Textlängen und referenzierte IDs. Kreise als Zentrum plus Radius persistieren, Darstellung als abgeleitetes Polygon. Freihand als begrenzte, vereinfachte Koordinatenfolge.

Basiskartendaten unverändert von Plan-Layern halten. Auswahl, Zoom, Follow, lokale Layerfilter und Sensorwerte sind kein gemeinsamer Plan. Temporäre Briefing-Zeichnungen werden nur nach ausdrücklicher Übernahme zu Elementen.

## Lokale Persistenz

Aktionen erzeugen Commands mit invertierbarer Änderung für lokales Undo. Daten + lokaler Änderungsstatus in einer IndexedDB-Transaktion schreiben; „gespeichert“ erst nach Commit. Migration mit alter Kopie/Exportmöglichkeit; Fehler darf bestehende Daten nicht zerstören. Online-Undo ist eine neue autorisierte Operation gegen die aktuelle Objektversion, keine globale Rücksetzung fremder Arbeit.

## Portables Paket v1 — Vorschlag `.astac.zip`

- `manifest.json`: format `as-tac`, formatVersion, appVersion, createdAt, projectId, planRevision, optional originProjectId, resource list mit Pfad/Grösse/Hash/MIME und Quellen.
- `project.json`: validiertes Projekt samt Elementen, Teams und Phasen; keine Tokens, Accountdaten, Online-Schreibrechte oder GPS-Historie.
- `maps/`: Gebietsdaten und vollständige Styles, Glyphs/Fonts und Sprites.
- `assets/`: tatsächlich referenzierte Icons/Bilder; binäre Inhalte über SHA-256 adressieren.
- `credits/`: Attribution und zutreffende Lizenz-/Herkunftshinweise, offline verfügbar.

Ein vollständiges Paket darf keine unbemerkten externen Ressourcen erfordern. Ein schlanker Plan-Export kann später hinzukommen, muss dann fehlende Basiskarten ausdrücklich benennen.

Import: Formatversion und Pfade prüfen, absolute Pfade/Traversal/Duplikate ablehnen, Dateianzahl/komprimierte und entpackte Bytezahlen begrenzen, Hashes und Referenzen verifizieren, dann atomar als neues lokales Projekt übernehmen. Kein `unzip` ohne Grenze vor vollständiger Dekompression. MVP-Startlimits: 100 MiB Archiv, 250 MiB entpackt, 2'000 Einträge; für grosse Gebiete nach Geräteprüfung anpassen. Dekodierte Bildgrösse und Geometriekomplexität separat begrenzen.

Gleiche Projekt-ID beim erneuten Import: als neue Kopie öffnen oder ausdrücklich vorhandenen Snapshot ersetzen; alten Stand bis erfolgreichem Import behalten. Ein importiertes Projekt ist standardmässig eine schreibgeschützte verteilte Kopie. Online-Schreiben erfordert frische serverseitige Mitgliedschaft. Hashes erkennen Beschädigung, beweisen keine Absenderidentität.

## Online-Protokoll ohne stillen Datenverlust

1. Client authentifizieren und Projektmitgliedschaft serverseitig ermitteln; Snapshot + letzte Sequenz laden.
2. Admin sendet Operation mit stabiler opId und erwarteter Objektversion. Server leitet actorId aus Auth ab und validiert Projektzugehörigkeit, Rolle, Schema und Referenzen.
3. Innerhalb einer Transaktion Objektversion vergleichen, Operation anwenden, Version erhöhen, projektweite Sequenz vergeben und Operation dauerhaft speichern. `(projectId, opId)` eindeutig; Wiederholung liefert dasselbe Ergebnis.
4. Bei Versionskonflikt nichts ändern; aktuellen Objektstand zurückgeben. Eigene Änderung lokal bewahren. Änderungen verschiedener Objekte unabhängig akzeptieren; Löschungen behalten Tombstone/Versionsinformation.
5. Erst nach Commit an berechtigte Abonnenten verteilen. Vorläufige Drag-Vorschau nicht als bestätigten Plan speichern; persistierte Bewegung am Gestenende.
6. Client wendet bestätigte Events nach Sequenz genau einmal an. Lücke: ab lastSeq nachladen. Ist das Log bereits verdichtet, Snapshot und neuere Events atomar abgleichen.
7. Reconnect: Rolle erneut prüfen, Serverstand nachladen, unbestätigte Operations-IDs abgleichen; legitime unveränderte Wiederholungen deduplizieren. Offline-Entwürfe ausdrücklich vergleichen und mit aktuellen Objektversionen publizieren.

Owner verwaltet Rollen; Admin verwaltet Inhalte; Viewer darf keine Mutation über API, Storage, RPC oder Realtime erwirken. Rolle in einer Datei/Clientvariable ist nicht vertrauenswürdig. Snapshot-/Paketdownload und Subscription ebenfalls pro Projekt schützen. Ein Rollenwechsel muss aktive Schreibaktionen und Abonnements gemäss verbleibendem Lesezugriff beeinflussen.

Für projektweite Mutationen (Phasenreihenfolge, Paketwechsel, Teamlöschung) eine eigene Scope-Version prüfen oder atomare Mehr-Objekt-Transaktion verwenden. Löschen referenzierter Teams/Phasen entweder atomar bereinigen oder verständlich ablehnen; keine hängenden Referenzen.

Anwesenheit, Cursor und Präsentationskamera sind flüchtige Sitzungsevents mit Ablaufzeit. Präsentationsleiter wird exklusiv übernommen; Admin-Bearbeitung bleibt unabhängig gleichzeitig möglich. Empfangene Inhalte sind Daten: Text nicht als HTML ausführen.

## Zustandsmaschinen

- Paket: missing → downloading/importing → verifying → ready; Fehler → failed, altes ready-Paket bleibt.
- Verbindung: local/offline → connecting → syncing → live; Unterbrechung → reconnecting/offline; Authproblem → auth-required.
- Operation: local-pending → sent → acknowledged; alternativ rejected/conflict. „Sent“ ist nicht „gespeichert auf Server“.
- GPS: idle → requesting → acquiring → valid; denied/unavailable/stale als sichtbare Alternativen. Vorgeschlagene Stale-Schwelle 30 Sekunden, im Feldtest überprüfen.

## Implementierter Offline-Paketvertrag AST-007

`.astac.zip`, formatVersion 1, verwendet genau sechs Dateien: `manifest.json`, `project.json`, `maps/area.json`, `credits/ODbL-1.0.txt`, `credits/CREDITS.md`, `credits/renderer.json`. Die Karte enthält alle GeoJSON-Daten. Der Renderer-Vertrag `as-tac-vector` v1 benötigt keine externen Glyphen, Sprites oder Assets; die Empfänger-App muss vorher installiert/offline vorbereitet sein. ZIP ist kein eigenständig ausführbares App-Paket.

Für Mobilgeräte enger als der ursprüngliche Vorschlag: 100 MiB Archiv, 32 MiB pro Datei, 64 MiB insgesamt entpackt. Nur Store/Deflate, keine Verschlüsselung, ZIP64, Data-Descriptors oder ZIP-Kommentare. Zentralverzeichnis und lokale Header müssen übereinstimmen; feste Pfadliste verhindert Traversal/Extras/Duplikate. Streaming-Dekompression prüft tatsächliche Ausgabebytes vor Zusammenführung. Ressourcen werden mit SHA-256 geprüft, Projekt/Karte nach Schema.

Import remappt Projekt-/Objekt-/Team-/Phasen-IDs und Karten-ID. Karte und Projekt entstehen in einer gemeinsamen IndexedDB-Transaktion. Schreibschutz ist lokale Datensatz-Metadaten (`readOnly`), keine Online-Berechtigung; Öffnen und Briefing möglich, Bearbeitung nur als bewusst erstellte neue Kopie. Exporte enthalten keine dieser Rechte-Metadaten.
