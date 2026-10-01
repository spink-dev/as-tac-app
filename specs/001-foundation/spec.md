# Produktspezifikation

Status: Umsetzungsentwurf · 2026-10-01. Anforderungen aus dem Auftrag sind bindend; konkrete Grenzwerte sind vorläufige Pilotziele.

## Kernabläufe

| ID | Anforderung | Abnahme |
| --- | --- | --- |
| F01 | Lokales Projekt ohne Konto erstellen, öffnen, duplizieren, löschen | Neustart erhält gespeicherte Daten; fehlgeschlagenes Speichern wird angezeigt |
| F02 | Begrenztes OSM-Gebiet offline vorbereiten | Karte einschliesslich Labels/Icons nach App-Kaltstart im Flugmodus vollständig im Paketgebiet nutzbar |
| F03 | Punkte, beschriftete Linien/Routen, Polygone, Kreise, Text und Freihand zeichnen | Anlegen, Auswahl, Verschieben, Vertexbearbeitung, Löschen, Undo/Redo und Layer-Sichtbarkeit funktionieren |
| F04 | Eigene Geländeergänzungen präzise vorbereiten | GPS-Koordinaten eingeben, Objektattribute/Notizen ändern, Distanz/Fläche messen; Ergänzungen bleiben separate Plan-Layer |
| F05 | Teams, Treffpunkte, Aufgaben und Phasen zuordnen | Element zeigt Kurzlabel, Team, Phase und Details; Filter verändern keine Daten |
| F06 | Vollständiges Karten-/Planpaket exportieren und importieren | Zweites Gerät öffnet das Paket offline mit Basiskarte, Plan, Phasen und Credits; Import verändert kein bestehendes Projekt stillschweigend |
| F07 | Eigene GPS-Position anzeigen | Genauigkeitskreis, Fix-Alter und Fehlerzustand; ohne Fix keine scheinbar aktuelle Position; Karte bleibt bedienbar |
| F08 | Briefing halten | Phasen vor/zurück, Kamera/Layer-Zustand je Phase, lesbare Details; temporäre Zeichnungen verändern den Plan nicht |
| F09 | Mehrere Admins gleichzeitig online bearbeiten lassen | Zwei getrennte Sitzungen bearbeiten unterschiedliche Elemente ohne Verlust; Konflikt desselben Elements wird aufgelöst statt überschrieben |
| F10 | Mitglieder live lesen lassen | Bestätigte Updates erscheinen; direkte manipulierte Schreibversuche werden serverseitig abgewiesen |
| F11 | Verbindung verlieren und wieder aufnehmen | Letzter vollständiger Stand bleibt sichtbar, Status zeigt offline; Änderungen werden lückenlos und ohne Duplikate nachgeladen |
| F12 | Credits und Quellen sichtbar machen | FieldMaps/@rwolffgang in README und offline verfügbarer Credits-Ansicht; tatsächliche Übernahmen nachvollziehbar |

OSM-Ergänzungen werden nicht automatisch zu OpenStreetMap hochgeladen. „Route“ bezeichnet eine eingezeichnete Linie; automatische Wegberechnung und Turn-by-turn-Navigation sind zunächst nicht enthalten.

## Rollenmatrix

| Aktion | Eigentümer | Admin | Mitglied | Lokaler Autor |
| --- | --- | --- | --- | --- |
| Gemeinsamen Plan lesen / eigene GPS-Position | Ja | Ja | Ja | Nur lokales Projekt |
| Gemeinsamen Plan online ändern | Ja | Ja | Nein | Nein |
| Mitglieder/Admins verwalten | Ja | Nein | Nein | Nein |
| Briefing ansehen / lokale Phasenwahl | Ja | Ja | Ja | Ja |
| Gemeinsames Briefing führen | Ja | Ja | Nein | Nur lokal |
| Paket erstellen | Ja | Ja | Lokale Kopie bereits erhaltener Daten | Eigenes Projekt |
| Offline-Entwurf des gemeinsamen Plans | Ja, getrennt | Ja, getrennt | Nein | Eigenes Projekt |

Ein exportiertes Paket ist eine Kopie; spätere Online-Rechteentzüge können bereits gespeicherte Dateien nicht zurückholen. Pakete verleihen keine Online-Mitgliedschaft oder Schreibrechte.

## Offline-Vertrag

- Erster App-Aufruf/Installation und Gebietsvorbereitung benötigen Verbindung oder eine bereits installierte App mit importierbarem Paket.
- Kein Konto und kein erfolgreicher Serveraufruf als Voraussetzung für das Öffnen vorhandener lokaler Daten.
- Mitglieder sehen die letzte vollständig gespeicherte Revision; keine automatische Vermischung mit Offline-Entwürfen.
- Ein Admin kann offline an einem getrennten Entwurf arbeiten; dieser behält seine Basisrevision und wird beim Reconnect ausdrücklich verglichen.
- GPS ohne Internet ist möglich, aber ein Fix nicht garantiert. Gesperrter Bildschirm und Hintergrundbetrieb gehören nicht zum MVP-Versprechen.
- Keine Offline-Livekommunikation zwischen Geräten. Dateiversand erfolgt über vorhandene Share-/Dateiwege ausserhalb der App oder Download-Link bei Verbindung.
- Keine automatische Standortübermittlung; geplante Teammarker sind keine Live-Positionen.

## Abnahmeszenarien

- A01: Admin erstellt 20 gemischte Elemente und 3 Phasen; Export auf ein zweites Gerät; dort App beenden, Flugmodus, neu öffnen: Plan, Basiskarte und Phasen sind vollständig.
- A02: Unter freiem Himmel Positionsfreigabe erteilen: eigener Punkt, Genauigkeit und Fix-Alter; Berechtigung entziehen/GPS aus: verständlicher Status ohne Datenverlust.
- A03: Admin A bewegt Punkt X, Admin B bearbeitet Polygon Y, Mitglied C beobachtet: alle bestätigten Änderungen konvergieren. Mitglieds-API-Schreibversuch scheitert.
- A04: A und B bearbeiten dasselbe Objekt ab gleicher Version: eine Änderung bestätigt, die andere explizit als Konflikt erhalten; kein stiller Verlust.
- A05: Verbindung nach Senden, aber vor Antwort trennen; dieselbe Operation erneut senden: genau eine dauerhafte Änderung. Event-Lücke erfordert Replay/Snapshot.
- A06: Offline-Entwurf, zwischenzeitliche Online-Änderung und Rollenentzug: Reconnect veröffentlicht weder alte noch unberechtigte Änderungen automatisch.
- A07: Download abbrechen oder Quota erschöpfen: bisheriges gültiges Paket bleibt verwendbar; neuer Stand wird nicht „bereit“ genannt.
- A08: Briefing verlassen: temporäre Zeichnungen weg, persistierter Plan unverändert; Mitverfolgung kann Mitglied lokal pausieren.
- A09: Beschädigtes/zu grosses/fremdes Archiv: verständliche Ablehnung, kein Teilimport und keine Überschreibung.
- A10: Service-Worker-Update während einer Zeichnung: kein ungefragter Reload; danach kontrolliertes Update mit erhaltenen Daten.

## Vorläufige Qualitätsziele

- 500 Elemente, 3 aktive Admins, 20 Mitglieder; lokale Testfläche zunächst etwa 5 × 5 km.
- Lokales gespeichertes Projekt auf benannten Testgeräten innerhalb von 3 Sekunden bedienbar (nach gestartetem Browser); Eingaben während GPS-/Sync-Updates bleiben flüssig.
- Sichtbarkeit bestätigter Online-Änderungen p95 unter 2 Sekunden im dokumentierten Testnetz.
- Speichern lokal innerhalb 1 Sekunde nach abgeschlossener Aktion; „gespeichert“ erst nach erfolgreicher Transaktion.
- Touch-Ziele mindestens 48 CSS-Pixel; Status nicht nur farblich; Tastatur, Fokus und lesbare Kontraste für Panels.
- Testgrenzen samt Gerät, Browser, Paketgrösse, Elementzahl und Netzwerk protokollieren. Dies sind Ziele, keine aktuellen Messwerte.

Nicht im MVP: Mesh, Teamtracking, Chat, PDR, 3D, ATAK-Protokolle, automatische Navigation, vollständige Altformat-Kompatibilität. TacMap erst nach erfolgreichem Feldtest ablösen.

## Erweiterter Nutzungskontext — Nutzerauftrag 2026-10-01

Der Karten-/Planungs-/Briefing-Kern soll auch für ein Projekt für Zivilschutz und Landwirtschaft wiederverwendbar sein, beispielsweise bei Tierkrankheitsausbrüchen, Unfällen oder Naturkatastrophen. Offline-Karten, geografische Elemente, Teams, Phasen und portable Projekte bleiben domänenneutral. Mögliche Fachvorlagen wie Sperrzonen, Zufahrten, Sammelstellen und Zuständigkeiten sind noch zu spezifizieren. Produktaufteilung (separate App, Vorlagen oder allgemeine AS-TAC-App) ist offen; daraus folgt noch keine Umbenennung oder automatische Übernahme fachlicher Entscheidungsregeln.

Präzisierung: Aktueller Fokus bleibt AS-TAC. Spezialisierte Werkzeuge für Zivilschutz/Landwirtschaft folgen später; jetzt keine Produktaufteilung oder Fachvorlagen vorziehen.
