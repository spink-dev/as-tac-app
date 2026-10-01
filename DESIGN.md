# AS-TAC Kartenarbeitsplatz

Produktkontext: [PRODUCT.md](PRODUCT.md). Funktionale Karte für Gelände, Planung und Briefing. Desktop mit Navigationsleiste und Seitenpanel; Mobilgerät mit fünf unteren Tabs und schliessbarem Sheet. Karte, Massstab und OSM-Quelle bleiben der Bezugspunkt.

## Visuelle Regeln

Eigenes geometrisches AS-TAC-Zeichen aus zwei gerichteten A-Segmenten; Wortmarke als exportierbare Vektoren unter `public/brand/`, App-Icon in SVG/192/512 px. Einheitliche 24-px-Konturicons, Systemschrift und keine externen Fonts. Graphit, sachliche Flächen und Signalorange; kompakte 4-px-Radien statt dekorativer Karten. Abstände in 4-/8-px-Schritten, Bedienelemente mindestens 48 px hoch. Tastaturfokus und Safe Areas bleiben sichtbar.

### Darstellung

| Modus | Fläche | Text | Akzent |
| --- | --- | --- | --- |
| Tag | `#f4f5f6` | `#23272c` | `#ac3c0e` |
| Dunkel | `#171a1e` | `#e0e4e8` | `#ef8c62` |
| Rotlicht | `#100505` | `#df7366` | `#e47a6a` |

Der Schalter steht immer rechts oben, unabhängig von offenem Panel, Zeichenmodus oder lokalem/Online-Projekt. Die ausdrückliche Wahl wird als `as-tac.appearance` lokal gespeichert. Ohne Wahl gilt beim Start die Systemeinstellung hell/dunkel. Inline-Initialisierung vor React verhindert einen hellen App-Start bei gespeichertem Nachtmodus; bei gesperrtem Local Storage funktioniert die Wahl für die aktuelle Sitzung.

Eigene Basiskartenpaletten werden ohne Neuerzeugung der Karte gewechselt: Ausschnitt, laufende Zeichnung und Objektattribute bleiben erhalten. Rotlicht transformiert auch nachträglich geladene Plan-/Teamfarben, GPS, Briefing-Markierungen, Labels und MapLibre-Bedienelemente in Rot. Die gespeicherten Farben bleiben unverändert. Farben allein dürfen daher im Rotmodus keine Teams unterscheiden: Teamkürzel/Objektbeschriftungen bleiben verfügbar. Keine Farbüberblendung beim Wechsel.

Rotlicht steuert die App-Farben, **nicht die physische Displayhelligkeit**. Gerätehelligkeit zusätzlich senken. Systemdialoge, Tastatur, Browseroberfläche und der statische PWA-Startbildschirm liegen ausserhalb der App-Farbsteuerung; der Manifest-Startbildschirm ist deshalb dauerhaft dunkel. Keine Unsichtbarkeits- oder Nachtsichtgarantie. OLED/LCD, reale Helligkeit und Lesbarkeit müssen auf iPhone 16 Pro / Galaxy A24 im Feld geprüft werden.

## Zustände und Ebenen

Basiskarte → Flächen → Linien/Punkte → Kartenbeschriftungen → Werkzeuge → Aufgabenpanel → Navigation. Flächen nutzen 18 % der Objekt-/Ebenendeckkraft, damit Gelände lesbar bleibt. Innerhalb des Geometrietyps folgt die Darstellung der gespeicherten Ebenenreihenfolge. Gebäudepunkte bleiben vor Flächen sichtbar. Event-Beschriftungen werden bei Kollision ausgedünnt; ausgewähltes Objekt hat Vorrang.

Orientierung schreibt keine Planinhalte. Planung aktiviert bewusst den Editor. Zeichnen schliesst das Aufgabenpanel; Auswahl bzw. fertiges Objekt öffnet die Details. Unübernommene Objektattribute sperren Tabwechsel, bis sie übernommen oder verworfen werden. Briefing sperrt konkurrierende Zeichen-/Projektwechsel bis zum Beenden. Sichtbarkeit und Deckkraft in der Orientierung sind lokale Ansichtsoptionen; Planungsdeckkraft wird gespeichert.

## Datenproduktion

Kartenstudio unter Projekt: eigene Eventkopien vorbereiten; Gelände-ID, Event-ID, Ausgabe und Quellen erfassen. Veröffentlichungen erfordern serverseitige Root-Freigabe, keine umschaltbare Browserrolle. Bestehende Ausgaben sind unveränderlich. Download immer als neue schreibgeschützte Kopie, Bearbeitung als explizite weitere Kopie.

## Kartenzeichen und grosse Gebiete

HQ-Flaggen, Safe-/Zivilzonen-Schilde und Gefahrendreiecke werden über alle Eventvorlagen gleich dargestellt. Ausgeblendeter Text lässt ein gewähltes Icon sichtbar. Gebäudezeichen ab Zoom 15, Text ab Zoom 16; Basiskarten-POIs bleiben optional. Wege gestrichelt und zoomabhängig, Gebäude erst ab Zoom 13. Basiskartenlabels entstehen nur im sichtbaren Ausschnitt (maximal 180 Kandidaten), Strassentext folgt der Strassenlinie. Die Gebietswahl ohne Projekt ist eine lokale Ansichtseinstellung und bleibt beim Neustart erhalten.
