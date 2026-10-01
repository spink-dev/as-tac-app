# AST — Kartensymbole und lokale Geländeaufnahme

Nutzerauftrag 2026-10-01; Preview 0.6.0-alpha.1. Darstellung zuerst, danach freiwillige Aufnahme und Standortabgleich. AS-TAC bleibt Fokus.

## Darstellung

- Offline erzeugte diagonale Schraffur von links unten nach rechts oben, Kreuzschraffur, Punkte, transparente Fläche oder nur Umriss. Kein externer Sprite-/Glyph-Download.
- Lokale Vektorsymbole: Standort, HQ/Flagge, Safe Zone, Gefahr, Gebäude und Erste Hilfe. Quelle/Geometrie liefern rückwärtskompatible Standardwerte, die der Editor überschreiben kann.
- Symbole und Muster vermitteln Bedeutung auch im Rotlichtmodus; gespeicherte Farben bleiben unverändert. Schraffuren werden beim Wechsel Tag/Dunkel/Rot aktualisiert.
- Die Spielfeldgrenze erhält automatisch kein zentrales Label. Quell-ID und Bezeichnung bleiben für Suche/Editor erhalten. Immer/Ausblenden/Nach Zoom pro Objekt speicherbar.
- HQ/Safe-Zone/Gefahrenlabels erhalten vor Gebäude-POIs Platz. Gebäude-POIs zeigen Symbole ab Zoom 15 und Text ab Zoom 16. Auswahl erhält Vorrang. Kollidierende Labels werden ausgeblendet, Elemente bleiben über Karte und Liste auffindbar. Polygonlabel an einem Innenintervall statt pauschal im Mittelpunkt der Bounding-Box; Löcher werden berücksichtigt.
- Optionale `style.symbol`, `style.pattern`, `style.labelMode` werden lokal und serverseitig als geschlossene Enumerationen validiert. Migration `202610010004_symbols.sql` vor neuen Online-Clients anwenden. Ältere Clients unterstützen diese Felder nicht; gemischte Versionen sind nicht freigegeben. Alte Dokumente bleiben in neuen Clients lesbar.

## Geländeaufnahme

Geschwindigkeit verwendet `GeolocationCoordinates.speed` (m/s → km/h), sofern frisch und verfügbar. Keine erfundene Geschwindigkeit bei `null`. Bewegungssensoren erst nach bewusstem Knopfdruck und gegebenenfalls Gerätefreigabe; unbrauchbare/null Achsen bedeuten keine Messung. Gerätebeschleunigung dient als Bewegungsindikator beim Kontrollpunkt, nicht als Personengeschwindigkeit oder autonome Positionsquelle.

Pfadaufnahme beginnt ausschliesslich durch Start. Frische Fixes bis ±25 m, begrenzte Punktdichte, maximal 5000 Messpunkte. Fehler, Sprünge, Pausen und längere Lücken erzeugen getrennte Abschnitte; keine erfundenen Verbindungslinien. App-Wechsel und `pagehide` pausieren die Aufnahme, Weiteraufnahme ist bewusst. Keine Hintergrundaufzeichnung zugesagt. Ungespeicherte Aufnahme blockiert Projekt-/Gebietswechsel und den bewussten App-Update-Neustart; Browser-Neuladen zeigt soweit unterstützt den üblichen Verlusthinweis.

Messungen liegen nur im Arbeitsspeicher. Expliziter GeoJSON-Export enthält Pfadlinien und gröbste gemeldete Genauigkeit, keine Messzeitreihe. Alternativ können im **lokalen bearbeitbaren Projekt** Linien bewusst übernommen werden; danach gelten dessen normale Speicher-/Fehler-/Undo-Regeln. Im gemeinsamen Online-Plan wird keine Spur automatisch oder über einen Aufnahme-Speichern-Knopf publiziert. Rohes GPS und Bewegungssensoren bleiben ausserhalb des Projekts. Individuell übernommene Planlinien können später ausdrücklich exportiert/geteilt werden.

## Standortabgleich

1. GPS aktivieren, bekannten Standort auf der Karte antippen. MapLibre wandelt den Klick in WGS84 um; Bildschirm-Pixel sind keine neue Kartenreferenz.
2. Ruhig stehen und mindestens fünf aktuelle Messungen über vier Sekunden sammeln. Grobe/alte Daten oder erkannte Gerätebewegung unterbrechen die Sammlung.
3. Einen bis drei Kontrollpunkte übernehmen. Zusätzliche Punkte mindestens 20 m voneinander entfernt. Gewichteter lokaler Versatz, keine Skalierung/Scherung/Rotation einer bereits geografisch referenzierten Karte. Über 100 m Punktabweichung, über 15 m Streuung der Sammlung oder widersprüchliche Kontrollpunkte werden abgewiesen.
4. Versatz ausdrücklich aktivieren. Gilt nur in dieser Sitzung und diesem Kartenpaket, maximal zehn Minuten und 500 m vom ersten Messort. GPS-Original zusätzlich sichtbar. Rohspur und Kartendaten bleiben unverändert; gemeldete Genauigkeit wird niemals verkleinert.

Ein Kontrollpunkt ist kein Genauigkeitsnachweis. Zwei oder drei Punkte testen die Konsistenz eines Versatzes, nicht eine absolute Vermessung. Keine inertiale Fortschreibung ohne GPS: eine solche Sensorfusion ist mit diesen Browsermessungen und ohne Gerätekalibrierung/Feldvalidierung nicht als präzise Position freigegeben. Das ist eine bewusste Grenze dieser Umsetzung, keine Aussage über native GNSS/IMU-Systeme.

Quellen: [W3C Geolocation](https://www.w3.org/TR/geolocation/), [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/), [MapLibre Polygon Patterns](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-pattern-to-a-polygon/). W3C definiert Geschwindigkeit und Beschleunigung als unterschiedliche Messgrössen; die Genauigkeitsgrenzen der Fusion sind eine technische Designentscheidung dieser App.

## Desktop

Nur im aktiven Editor ausserhalb Eingabefeldern: V Auswahl, P Punkt, L Linie, A Fläche, C Kreis, T Text, F Freihand. Enter abschliessen, Rücktaste letzter Eckpunkt, Escape abbrechen. Keine Änderung bei schreibgeschützten Projekten, unübernommenen Formularen, IME oder gehaltenen Modifier-Tasten. Laufende Zeichnungen werden nicht durch eine andere Werkzeugtaste verworfen.

## Abnahme

Automatisiert: optionales Styleschema/RPC-Ablehnung, Polygonlöcher/Labelpositionen, lokale Aufnahme mit Lücken, Bewegungsfreigabe, Hintergrundpause, Kontrollpunktablauf und Korrekturablauf, Tastaturbedienung, Speichern/Neuladen, bestehende Offline-/Editor-/Online-Regressionen. Echte Sensorqualität, Gehgeschwindigkeit, Akku und Korrekturwirksamkeit auf iPhone 16 Pro/Galaxy A24 bleiben Feldabnahmen; synthetische Browserdaten ersetzen diese nicht.

### Prüfstand 2026-10-01

- `npm run check`: 68 Dateien, keine Fehler, Warnungen oder Hinweise.
- `npm run build`: erfolgreich; Offline-Revision `abd4c8e37949bf49`, 20 Ressourcen, 4 077 751 Bytes. Bestehender Hinweis auf grosses Client-Bundle bleibt offen.
- Gesamte Chromium-Regression: 59 bestanden, 1 Live-Backend-Test mangels Konfiguration übersprungen. Neue SQL-Migration und Rechte-/Schemaschutz lokal mit PGlite geprüft; kein Backend-Migrationslauf ausgeführt.
- Vier gezielte Gelände-/Darstellungstests anschliessend in Chromium und WebKit bestanden, einschliesslich expliziter Planlinien-Übernahme und erneutem Öffnen. GPS/Motion dabei synthetisch.
- Zusätzlich angeforderter Firefox-Teststart nicht möglich: Playwright-Firefox ist auf diesem Rechner nicht installiert. Keine Firefox-Abnahme.
- Mobile Kartenansicht visuell geprüft: HQ-Symbole, diagonale Safe-Zone-Flächen, priorisierte Beschriftung, kein zentrales Spielfeldlabel. Geräte-Feldabnahmen bleiben offen.
