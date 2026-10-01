# Umsetzungsplan

2026-10-01 · Status: AST-004–006 als Preview implementiert; reale AST-001-Geräteabnahme weiterhin offen.

## Reihenfolge

M0 beweist die schwierigen Plattformannahmen. M1 liefert einen vollständigen lokalen Nutzerablauf. M2 ergänzt gemeinsame Bearbeitung. M3 ist der Feldtest vor Ablösung von TacMap. Keine Phase gilt allein durch erfolgreiches Kompilieren als abgeschlossen.

## Geplante Modulgrenzen

- `src/pages/`: Astro-Routen und offlinefähiger App-Einstieg.
- `src/features/map/`: Renderer-Adapter und Layer; keine Backend-Autorität.
- `src/features/editor/`: Werkzeuge, Auswahl, Commands, Objektinspektor.
- `src/features/briefing/`: Phasen und temporäre Präsentationszustände.
- `src/core/model/`, `src/core/geo/`: validierte Domäne, Koordinaten, Messungen.
- `src/core/storage/`, `src/core/packages/`: Transaktionen, Migration, Export/Import und Ressourceninventar.
- `src/core/location/`: Positions-/Kompass-Lifecycle ohne Karten- oder Netzabhängigkeit.
- `src/core/sync/`: Operationsvertrag, Reconnect und Backend-Adapter.
- `src/features/members/`, `src/features/credits/`: Rollenverwaltung und Herkunft.

AST-003 bündelt die zunächst kleinen Domänen-, Command- und Speichermodule in `src/core/projects/` sowie die Oberfläche in `src/features/projects/`. Weitere Ordner erst bei Bedarf anlegen. Keine vollständige Framework-/Store-Portierung aus TacMap. Domain-Funktionen gezielt übernehmen, Herkunft dokumentieren und pixelabhängige Annahmen isolieren.

## Technische Gates

**M0:** Astro/React-Integration, MapLibre mit lokalem Gebiet, vollständige lokale Fonts/Styles, Offline-Kaltstart und Positionsanzeige auf benannten Telefonen. GeoJSON zuerst; PMTiles nur falls Gebiets-/Performancemessung es nötig macht. Scheitert WebGL auf Zielgeräten, Leaflet mit geografischem CRS vergleichen, statt den ganzen Editor umzubauen. Ergebnis als ADR festhalten.

**M1:** Ein Autor erstellt Plan und Briefing, teilt Paket, Mitglied importiert und verwendet es offline. Noch kein Online-Feature nötig. Paketintegrität, Speicherfehler, App-Updates und GPS-Stale-State gehören zu diesem Gate.

**M2:** Backend-Kandidat anhand der Verträge prüfen und wählen. Membership + dauerhafte Transaktionen + Replay vor Realtime-Politur implementieren. Zwei Admins plus Viewer auf getrennten Clients testen; Reconnect und Konflikte sind Pflicht, nicht spätere Extras.

**M3:** Produktionsbuild über HTTPS installieren, offline kalt starten, 30-minütigen Spaziergang und eine Briefing-/Teilen-Runde durchführen. Geräte, Paketgrösse, GPS-Ausfälle, Speicher und Akkubeobachtung festhalten. Keine Background-GPS-Garantie aus Vordergrundtests ableiten.

## Prüfung passend zum Risiko

- Unit: Geo-Koordinaten und Kreise, Commands/Undo, Schema/Migration, Paketvalidierung, Sequenz-/Versionslogik.
- Integration: Transaktionen/Quota-Fehler, partielle Downloads, idempotentes Schreiben, Rechte/Revocation, Snapshot-Replay.
- Browser: Erstellen → Zeichnen → Briefing → Export → Import → Reload offline; Desktop und Touch.
- Reale Geräte: iOS Safari/Standalone und Android Chrome/Standalone, Sensorfreigabe, Flugmodus, App-Neustart, Speicherbereinigung, Update.
- Lastprofil: 500 Elemente und 3 Admins/20 Viewer als Pilotziel; Messergebnisse statt unbelegter Skalierungsversprechen.
- Credits: Übernahmeprotokoll, sichtbare Kartenattribution, offline verfügbare Hinweise und keine ungeklärten Referenzbilder.

## Entwicklungsstart

Lokales Git-Repository für AST-001 eingerichtet; Remote ist `spink-dev/as-tac-app`; `main` ist Produktion (`test-prod.as-tac.dev`), `testing` ist Preview (`test.as-tac.dev`). Die Hosting-Anbindung der Preview ist noch nicht verifiziert. Lockfile respektieren. `npm run check`, `npm run build` und `npm test` sind für AST-001 vorhanden. Vor Veröffentlichung keine Beispiel-Domain/CSP und unbeabsichtigten externen Font-/Style-Abhängigkeiten übernehmen.

Fortschritt ausschliesslich anhand der Fertigkriterien in `tasks.md` markieren. Offene Produktfragen stehen im Vault; die dortigen Defaults erlauben einen unmittelbaren Start mit AST-001.
