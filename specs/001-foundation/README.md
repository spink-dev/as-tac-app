# 001 — Offline-Planung und gemeinsame Online-Karte

Status: Offline-Stack bis AST-008 in 0.3.0 integriert; AST-009–012 in 0.4.0 auf main; AST-001-Geräteabnahme offen. Stand: 2026-10-01.

1. [Spec](spec.md): Nutzeranforderungen, MVP und messbare Abnahme.
2. [UX](ux.md): Kartenoberfläche und vollständige Abläufe inklusive Fehlerzuständen.
3. [Verträge](contracts.md): Koordinaten, Daten, Pakete, Rollen und Synchronisierung.
4. [Plan](plan.md): Architekturgrenzen, Reihenfolge und Prüfstrategie.
5. [Aufgaben](tasks.md): geordnete Arbeitspakete mit Fertigkriterien.

**Aktuell: AST-009–012 in v0.4.0 auf main integriert.** Gemeinsamer Editor, dauerhafte Offline-Entwürfe, expliziter Konfliktabgleich und exklusive Briefing-Leitung sind implementiert. SQL-/Browsernachweis: [AST-010–012](evidence/ast-010-012-collaboration.md). Echte Supabase-Konfiguration/Mehrverbindungsprüfung und [AST-014-Feldabnahme](evidence/ast-014-field-acceptance.md) stehen aus. AS-TAC bleibt Produktfokus; Zivilschutz-Spezialisierung folgt später.

AST-007/008 und Kartenkorrekturen sind in 0.3.0 auf main integriert. Reale Datei-/GPS-Prüfungen auf iPhone 16 Pro und Galaxy A24 bleiben offen.

Verbindlich aus dem Nutzerauftrag: Privatprojekt, Astro, Offline-/Online-Karten, eigene GPS-Position, präzise Vorbereitung und Verteilung, Briefings, mehrere gleichzeitig schreibende Admins, schreibgeschützte Mitglieder sowie Credits für @rwolffgang.

Planungsdefaults: React + MapLibre, kleine OSM-Gebietspakete, WGS84, IndexedDB, serverseitige Objektversionen; Backend-Kandidat Supabase. Defaults dürfen nach begründetem technischem Nachweis angepasst werden, Produktanforderungen bleiben bestehen.

Dauerhafter Kontext und Referenzanalyse: Vault `projects/as-tac/`. AST-001 enthält nun Laufzeitcode und automatisierte Prüfungen. Siehe [Nachweisprotokoll](evidence/ast-001-mobile.md); kein abgeschlossener M0-Feldnachweis.

Das anschliessende Redesign ist unter [002 Kartenarbeitsplatz](../002-map-workspace/spec.md) spezifiziert und wird getrennt auf testing geprüft.
