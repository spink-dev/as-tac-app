# UX — Karte zuerst

Entwurf, 2026-10-01. Sachliche, gut lesbare Oberfläche; keine dekorative Kommandozentrale. Unterscheiden: Plan bearbeiten, im Gelände lesen, Briefing präsentieren.

## Ansichten

| Ansicht | Inhalt und primäre Aktion |
| --- | --- |
| Projekte | Name, letzter Stand, Offline-Bereitschaft, Rolle; Öffnen, Neues Projekt, Import |
| Planung / Desktop | Karte zentral; links Werkzeuge/Layer; rechts Details des ausgewählten Objekts; oben Projekt/Sync/Teilen |
| Feld / Telefon | Karte füllt Fläche; eigene Position zentrieren, Suche/Elementliste, Layer, Briefing; Details als Bottom Sheet |
| Briefing | Karte und Phasentitel, Vor/Zurück, Details, optional Präsentation folgen; Werkzeuge reduziert |
| Offline-Pakete | Gebiet, Datenstand, Grösse, Vollständigkeit, Download/Import/Entfernen und Speicherstatus |
| Mitglieder | Rolle, Einladung, Rechteverwaltung durch Eigentümer; keine versteckten Bearbeitungsrechte |
| Über / Credits | Quellen, FieldMaps/@rwolffgang, Datenlizenzen, App-Build, offline lesbar |

## Layout und Interaktion

Desktop zeigt Werkzeugleiste und ein Details-Panel. Tablet nutzt ein umschaltbares Panel. Auf Telefonen standardmässig Feldansicht; Admins wechseln bewusst in Planung. Mitglieder erhalten keinen Edit-Schalter.

Auswahl bestehender Objekte hat Vorrang vor Neuanlage. Verschieben der Karte erzeugt nie versehentlich ein Objekt. Nach abgeschlossener Zeichnung zurück zu Auswahl; Escape/Abbrechen verwirft nur den laufenden Entwurf. Rückgängig bleibt erreichbar. Präzise Punkt-/Vertex-Eingabe zusätzlich zu Drag auf der Karte anbieten.

Layer: Basiskarte, Geländeergänzungen, Plan/Teams, GPS und Briefing-Zeichnungen. Sichtbarkeit ist standardmässig gerätelokal; Änderungen an „mein Layer ist verborgen“ dürfen den gemeinsamen Plan nicht verändern. Objektlöschung mit Undo; Projekt-/Paketlöschung mit eindeutiger Bestätigung.

Touch: 48-px-Ziele, Safe Areas, Hoch-/Querformat, keine zwingenden Hover-Gesten. Beschriftung und Symbol plus Farbe; lesbare Konturen bei Sonne und dunkler Darstellung. Kartenattribution bleibt sichtbar. Suchbare Elementliste als zugängliche Alternative zum kleinen Kartentreffer.

## Ablauf: vorbereiten und verteilen

1. Neues Projekt → Name → Gebiet auswählen/Referenzpaket importieren.
2. Gebiet mit erwarteter Grösse anzeigen → „Offline speichern“ → Fortschritt → Integritätsprüfung → „Offline bereit“.
3. Elemente zeichnen, Attribute/Notizen/Teams setzen und Phasen anlegen.
4. „Briefing prüfen“ → Phasen durchgehen → „Paket teilen“.
5. Exportübersicht nennt enthaltenes Gebiet, Planrevision, Phasen und Assets. Betriebssystem-Share-Sheet, sonst Datei-Download; auf iOS ZIP-kompatible Datei.
6. Mitglied importiert per App-Dateiauswahl → Zusammenfassung → lokal speichern → schreibgeschützte Feldansicht. QR/Link kann einen Download öffnen, enthält aber nicht selbst die ganze Offline-Karte.

## Ablauf: GPS im Gelände

„Meine Position“ erklärt den lokalen Zweck und löst die Gerätefreigabe aus. Beim ersten Fix zentrieren, danach Follow-Modus anzeigen. Manuelles Kartenverschieben pausiert Follow; ein Tap stellt es wieder her.

Punkt mit Genauigkeitskreis, Fix-Alter und bei Bedarf Richtung. Ohne Nordreferenz keinen verlässlichen Kompass behaupten. Position ausserhalb des geladenen Gebietes ausdrücklich anzeigen; Karte nicht durch fehlende Daten ersetzen. Letzten Fix bei Ausfall als alt kennzeichnen.

## Ablauf: gemeinsam bearbeiten

Projekt verbinden → anmelden → serverseitige Rolle laden → vollständigen Stand synchronisieren → „Live“. Admins sehen andere aktive Admins; Cursor optional. Objektänderung zeigt „Wird synchronisiert“, erst nach Bestätigung „Synchronisiert“.

Bei Konflikt bleibt der eigene Entwurf erhalten: „Dieses Objekt wurde inzwischen geändert.“ Serverstand und eigene Änderung anzeigen; Serverstand übernehmen oder bewusst neu anwenden, sofern Rolle und aktuelle Version es erlauben. Kein unsichtbares Überschreiben.

Verbindungsverlust: „Offline · Stand von …“; schreibgeschützte gemeinsame Karte bleibt lesbar. Admin kann „Lokalen Entwurf erstellen“. Beim Reconnect zuerst Berechtigung und Serverstand laden, danach Entwurf vergleichen; keine automatische Veröffentlichung.

## Ablauf: Briefing

Phasen bestehen aus Titel, Kurznotiz, Kameraausschnitt und sichtbaren Planelementen. Vor/Zurück und Tastatursteuerung. Freihand im Briefing ist temporär; „In Plan übernehmen“ ist eine ausdrückliche Admin-Aktion mit Undo.

Online kann ein Admin „Präsentation führen“ aktivieren. Nur ein aktiver Präsentationsleiter; Wechsel ausdrücklich übernehmen. Mitglieder wählen „Folgen“ oder betrachten unabhängig weiter. Präsentationskamera und Phasenwahl sind Sitzungszustand, keine Geometrieänderungen. Offline sind dieselben gespeicherten Phasen lokal verwendbar.

## Zustände und Rückmeldungen

| Situation | Sichtbare Rückmeldung / nächste Aktion |
| --- | --- |
| Kein Projekt | Neues Projekt / Paket importieren |
| Paket fehlt/ist unvollständig | „Karte noch nicht offline verfügbar“; fehlende Teile laden/importieren |
| GPS wartet/verweigert/Timeout | Konkreter Zustand; Erneut versuchen / Berechtigung erklären; Karte bleibt lesbar |
| Daten gespeichert | „Lokal gespeichert“ getrennt von „Online synchronisiert“ |
| Speicher voll | „Nicht gespeichert“; Speicher verwalten / Export; keine falsche Erfolgsmeldung |
| Verbindung instabil | Letzter bestätigter Stand und Anzahl ausstehender Änderungen |
| Anmeldung abgelaufen | Lokal weiterlesen; erneut anmelden für Online-Aktionen |
| Rechte entzogen | Gemeinsames Bearbeiten stoppen, lokale Daten/Entwurf getrennt erhalten |
| Neue App-Version | Update bereit; nach sicherem Speichern bewusst neu starten |
| Neues Kartenpaket | Version/Grösse prüfen und installieren; bestehendes Paket bis Erfolg behalten |
