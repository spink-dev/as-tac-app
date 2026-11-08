# AS-TAC Kartenarbeitsplatz (1.0)

Produktkontext: [PRODUCT.md](PRODUCT.md). Register: Produkt. Die Karte ist immer die Bühne; Bedienung schwebt in kompakten HUD-Gruppen darüber und verschwindet, wo sie nicht gebraucht wird.

## Szene

Eine Gruppenführerin steht im Kiefernwald von Mahlwinkel, Telefon in der behandschuhten Hand, und schaut zwischen zwei Sprüngen auf die Karte – mal in praller Sonne, mal in der Dämmerung, nachts nur mit Rotlicht. Am Vorabend hat ein Organisator am Laptop im hellen Raum dieselbe Karte geplant und per Beamer gebrieft. Daraus folgen: drei Darstellungen, grosse Ziele, kurze Wege, keine Dekoration.

## Identität

AS-TAC-Zeichen (zwei gerichtete A-Segmente) und Signalorange bleiben. Graphit-Flächen, kompakte Radien (4 px Bedienelemente, 6 px HUD, 10 px Dialoge), Systemschrift für die Oberfläche, `ui-monospace` nur für Koordinaten. Icons: lucide mit 1,75 px Strich. Farb-Tokens in OKLCH: `src/ui/styles/tokens.css`.

| Modus | Fläche | Text | Akzent | Zweck |
| --- | --- | --- | --- | --- |
| Tag | `oklch(0.955 0.004 250)` | `oklch(0.255 0.012 250)` | `oklch(0.53 0.155 40)` | Sonne, Planung |
| Dunkel | `oklch(0.205 0.008 250)` | `oklch(0.915 0.006 250)` | `oklch(0.74 0.13 48)` | Dämmerung |
| Rotlicht | `oklch(0.13 0.025 25)` | `oklch(0.67 0.15 28)` | `oklch(0.7 0.16 30)` | Nacht, Dunkeladaption |

Rotlicht färbt Oberfläche und – abschaltbar – die Karte über einen SVG-Farbfilter. Zustände bleiben im Rotlicht zusätzlich textlich unterscheidbar (Teamkürzel, Status in Labels). Der Wechsel erfolgt ohne Neuaufbau der Karte; Ausschnitt, Entwurf und Auswahl bleiben erhalten.

## Layout

- **Desktop:** Topbar (links Zurück + Planname + Speicherstatus, Mitte Modi Planen/Feld/Briefing, rechts Live, Undo/Redo, Suche ⌘K, Darstellung), Werkzeugschiene links, Kartenkontrollen rechts, Kontextleiste unten Mitte, Panel rechts (Details, Ebenen, Teams, Phasen, Karten, Teilen, Live, Einstellungen, Protokoll).
- **Telefon:** Modi als volle Zeile unter dem Titel, Werkzeug-Dock unten (fünf Werkzeuge + Mehr + Panels), Panels als ziehbares Bottom-Sheet mit drei Rastpunkten. Querformat kompakt (nur Icons).
- **Feld:** Werkzeuge verschwinden, grosse GPS-, Kompass- und Navigationsanzeige, Zielstatus mit einem Tipp.
- **Briefing:** Phasenleiste unten mit Vor/Zurück, temporärer Stift, Präsentation leiten/folgen.

## Bewegung

150–250 ms, ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`), Drawer `cubic-bezier(0.32, 0.72, 0, 1)`. Bewegung zeigt Zustand: Sheet-Rasten (GSAP), Toasts, Menüs, Zählwerte beim Download (CountUp). Lenis nur für Rad/Trackpad auf langen Listen, nie auf Touch. `prefers-reduced-motion` schaltet alles auf sofort.

## Kartenebenen

Grundkarte → Bildkarten → MGRS-Gitter → Zonen (18 % Füllung, Schraffur für Safe/Gefahr, Kreuzschraffur für Sperrzonen) → Pfade → Routen (mit Pfeilen, Abschnittspeilung) → Zeichnungen → Markierungen → Beschriftungen → GPS → Entwurf → Bearbeitungsgriffe. Symbole werden zur Laufzeit auf Canvas gezeichnet (NATO-ähnliche Rahmen: Rechteck eigene, Raute Feind). Beschriftungen nutzen lokal ausgelieferte Noto-Sans-Glyphen – offline, ohne Fontserver.

## Zugänglichkeit

Touch-Ziele 48 px (grobe Zeiger), 36 px mit Maus. Sichtbarer Fokus in Akzentfarbe, Dialoge mit Namen, Live-Regionen für Speicher- und Hinweiszeilen, Sprache des Dokuments folgt der App-Sprache. Kontraste ≥ 4,5:1 für Text in allen drei Modi.
