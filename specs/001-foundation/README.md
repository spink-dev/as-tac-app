# 001 — Offline-Planung und gemeinsame Online-Karte

Status: AST-001-Prüfstand implementiert; reale mobile Validierung offen. Stand: 2026-10-01.

1. [Spec](spec.md): Nutzeranforderungen, MVP und messbare Abnahme.
2. [UX](ux.md): Kartenoberfläche und vollständige Abläufe inklusive Fehlerzuständen.
3. [Verträge](contracts.md): Koordinaten, Daten, Pakete, Rollen und Synchronisierung.
4. [Plan](plan.md): Architekturgrenzen, Reihenfolge und Prüfstrategie.
5. [Aufgaben](tasks.md): geordnete Arbeitspakete mit Fertigkriterien.

**Erster Auftrag: AST-001.** Einen kleinen OSM-Ausschnitt in einer Astro/React-Kartenansicht lokal laden, als PWA offline kalt starten und GPS auf iOS/Android prüfen. Ergebnis und Messwerte dokumentieren; danach erst Editor und Kollaboration aufbauen.

Verbindlich aus dem Nutzerauftrag: Privatprojekt, Astro, Offline-/Online-Karten, eigene GPS-Position, präzise Vorbereitung und Verteilung, Briefings, mehrere gleichzeitig schreibende Admins, schreibgeschützte Mitglieder sowie Credits für @rwolffgang.

Planungsdefaults: React + MapLibre, kleine OSM-Gebietspakete, WGS84, IndexedDB, serverseitige Objektversionen; Backend-Kandidat Supabase. Defaults dürfen nach begründetem technischem Nachweis angepasst werden, Produktanforderungen bleiben bestehen.

Dauerhafter Kontext und Referenzanalyse: Vault `projects/as-tac/`. AST-001 enthält nun Laufzeitcode und automatisierte Prüfungen. Siehe [Nachweisprotokoll](evidence/ast-001-mobile.md); kein abgeschlossener M0-Feldnachweis.
