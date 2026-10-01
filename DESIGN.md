# AS-TAC Kartenarbeitsplatz

Produktkontext: [PRODUCT.md](PRODUCT.md). Funktionale Karte für Gelände, Planung und Briefing. Desktop mit Navigationsleiste und Seitenpanel; Mobilgerät mit fünf unteren Tabs und schliessbarem Sheet. Karte, Massstab und OSM-Quelle bleiben der Bezugspunkt.

## Visuelle Regeln

Systemschrift, keine extern geladenen Fonts. Hintergrund weiss bzw. `#f0f4f2`, Text `#1e302a`, zweitrangiger Text `#53665e`, einzige UI-Akzentfarbe `#215b45`. Team-/Objektfarben gehören zu Kartendaten, nicht zur Navigation. Abstände in 4-/8-px-Schritten. Bedienelemente mindestens 48 px hoch. Sichtbarer Tastaturfokus, Safe-Area-Berücksichtigung, keine verpflichtende Animation.

## Zustände und Ebenen

Basiskarte → Flächen → Linien/Punkte → Kartenbeschriftungen → Werkzeuge → Aufgabenpanel → Navigation. Flächen nutzen 25 % der Objekt-/Ebenendeckkraft, damit Gelände lesbar bleibt. Innerhalb des Geometrietyps folgt die Darstellung der gespeicherten Ebenenreihenfolge. Gebäudepunkte bleiben vor Flächen sichtbar. Event-Beschriftungen werden bei Kollision ausgedünnt; ausgewähltes Objekt hat Vorrang.

Orientierung schreibt keine Planinhalte. Planung aktiviert bewusst den Editor. Zeichnen schliesst das Aufgabenpanel; Auswahl bzw. fertiges Objekt öffnet die Details. Unübernommene Objektattribute sperren Tabwechsel, bis sie übernommen oder verworfen werden. Briefing sperrt konkurrierende Zeichen-/Projektwechsel bis zum Beenden. Sichtbarkeit und Deckkraft in der Orientierung sind lokale Ansichtsoptionen; Planungsdeckkraft wird gespeichert.

## Datenproduktion

Kartenstudio unter Projekt: eigene Eventkopien vorbereiten; Gelände-ID, Event-ID, Ausgabe und Quellen erfassen. Veröffentlichungen erfordern serverseitige Root-Freigabe, keine umschaltbare Browserrolle. Bestehende Ausgaben sind unveränderlich. Download immer als neue schreibgeschützte Kopie, Bearbeitung als explizite weitere Kopie.
