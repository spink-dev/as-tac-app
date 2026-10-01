# 001 — Offline-Planung und gemeinsame Online-Karte

Status: AST-004–006 in 0.2.0 integriert; AST-007 und AST-008 als Preview implementiert; AST-001-Geräteabnahme offen. Stand: 2026-10-01.

1. [Spec](spec.md): Nutzeranforderungen, MVP und messbare Abnahme.
2. [UX](ux.md): Kartenoberfläche und vollständige Abläufe inklusive Fehlerzuständen.
3. [Verträge](contracts.md): Koordinaten, Daten, Pakete, Rollen und Synchronisierung.
4. [Plan](plan.md): Architekturgrenzen, Reihenfolge und Prüfstrategie.
5. [Aufgaben](tasks.md): geordnete Arbeitspakete mit Fertigkriterien.

**Nächster Umsetzungsschritt: AST-009.** Backend-Entscheidung, Auth/Membership und dauerhafte Sync-Basis gemäss Verträgen. AST-007 liefert vollständige portable Projektpakete, AST-008 härtet den Vordergrund-GPS-Lebenszyklus. Beide liegen als 0.3.0-alpha.2 auf `testing`; reale Datei-/GPS-Prüfungen auf iPhone 16 Pro und Galaxy A24 bleiben offen. Details in `evidence/ast-007-portable.md` und `evidence/ast-008-mobile.md`.

Verbindlich aus dem Nutzerauftrag: Privatprojekt, Astro, Offline-/Online-Karten, eigene GPS-Position, präzise Vorbereitung und Verteilung, Briefings, mehrere gleichzeitig schreibende Admins, schreibgeschützte Mitglieder sowie Credits für @rwolffgang.

Planungsdefaults: React + MapLibre, kleine OSM-Gebietspakete, WGS84, IndexedDB, serverseitige Objektversionen; Backend-Kandidat Supabase. Defaults dürfen nach begründetem technischem Nachweis angepasst werden, Produktanforderungen bleiben bestehen.

Dauerhafter Kontext und Referenzanalyse: Vault `projects/as-tac/`. AST-001 enthält nun Laufzeitcode und automatisierte Prüfungen. Siehe [Nachweisprotokoll](evidence/ast-001-mobile.md); kein abgeschlossener M0-Feldnachweis.
