# as-tac — Projektkontext

Privates Projekt von Samuel Spink, kein Neovo-Kundenprojekt. Vor der Arbeit lesen:

1. Vault `projects/as-tac/README.md` über `~/.vault` oder den aktiven Vault-Checkout.
2. Falls dort noch nicht vorhanden: `/Users/samuelspink/.codex/worktrees/2f36/vault/projects/as-tac/README.md` (Vorbereitungsstand; nach Integration durch den dauerhaften Vault-Pfad ersetzen).
3. `specs/001-foundation/README.md` und das zur Aufgabe gehörende Spec-Dokument.
4. `CREDITS.md` vor Wiederverwendung von Referenzcode.

Astro ist vorgegeben. React/MapLibre/Backend sind dokumentierte Vorschläge bis zur technischen Validierung. Offline-GPS, Offline-Kartenpakete und Online-Kollaboration getrennt behandeln. Mitglieder dürfen keine gemeinsamen Live-Daten schreiben. Keine automatische Übertragung der eigenen GPS-Position.

Referenzen liegen in `../reference-projects/`; unverändert lassen. FieldMaps von @rwolffgang bei Übernahme mit Quelle, Commit und Zieldatei nennen. Keine fremden Event-Assets pauschal kopieren. Neue Geometrie speichert WGS84 `[longitude, latitude]`, nicht TacMaps Bildpixel.

Bei Brace-Sprachen stets geschweifte Klammern und Körper auf Folgezeilen verwenden. Lokale Specs sind Umsetzungsquelle, Vault besitzt dauerhaften Kontext. Kein Root-PLAN.md im Vault für Produktarbeit verwenden. Keine bestandenen Offline-/Sensor-/Mehrgeräteprüfungen behaupten, die nicht durchgeführt wurden.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
