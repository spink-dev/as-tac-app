# ADR 001 — Offline-Prüfstand mit React, MapLibre und GeoJSON

2026-10-01 · Entscheidung für AST-001 umgesetzt; Freigabe für Folgephasen erst nach realer Geräteabnahme.

Astro baut eine statische Einstiegseite mit einer React-Insel. MapLibre GL JS 6 rendert geografische OSM-Daten. Sein separater Worker wird ausdrücklich über Vite gebündelt; ein erfolgreicher Build allein hatte dessen fehlende Auslieferung nicht erkannt. Der Produktions-Browsertest deckt dies ab.

Zwei vorbereitete Gebiete: Mahlwinkel mit den FieldMaps-Gebietsgrenzen und Zürich/Benglen. GeoJSON genügt vorerst (zusammen ca. 1.86 MB); PMTiles und Leaflet sind derzeit nicht erforderlich. Leaflet bleibt bei WebGL-Problemen auf den Zieltelefonen eine Alternative. OSM-Wege und Multipolygone werden mit osmtogeojson konvertiert, nicht als Bildpixel interpretiert. Ausgewählte OSM-Objekte können über die Abfragegrenze hinausreichen; Vollständigkeit wird nur für die ausgewählten Objektklassen innerhalb der Bounds beansprucht. Kein vollständiger topografischer Kartensatz.

Beschriftungen für benannte Punkte und Wege sowie ein ausdrücklich benannter Testgebietsmarker sind DOM-Marker mit lokaler Systemschrift. Keine externen Glyphs, Sprites, Tile-Server oder GPS-Endpunkte. Eine einfache Kollisionsprüfung blendet überlappende Labels aus; dies ersetzt noch keine vollständige Kartenbeschriftungs-Engine.

Ein nach dem Build erzeugter Service Worker installiert alle Ressourcen in einem versionsabhängigen Cache und prüft Bytezahl/SHA-256 vor Speicherung. Fehlgeschlagene Installation aktiviert keinen Teilstand. Die UI prüft den aktiven Cache nochmals vor „Offline bereit“ sowie nach Rückkehr in die App. Fehlende/beschädigte Ressourcen können online ausdrücklich repariert werden; auch dabei wird vor dem Ersetzen geprüft. Neue Versionen warten auf den expliziten Update-Knopf. Vorherige Caches werden wegen noch offener alter Tabs nicht automatisch gelöscht; sichere Bereinigung folgt in AST-004. Website-Datenlöschung/Browsereviction erfordert erneute Vorbereitung. `persist()` ist eine Anfrage, keine Garantie.

GPS startet nur durch Nutzeraktion und läuft im Vordergrund. Genauigkeitskreis ist geodätisch in Metern, Fixzeit kommt vom Gerät. Über 30 Sekunden ohne neuen Fix, bei Fehler und nach Stop wird der letzte Fix sichtbar als alt markiert. Manuelles Verschieben pausiert Follow. Ausserhalb der Bounds bleibt das verfügbare Gebiet sichtbar; keine Fahrt in eine leere Karte. Keine Speicherung/Übertragung der Position.

Freie Gebietsauswahl ist als Nutzerwunsch für AST-004 erfasst. Der Build-Downloader unterstützt bereits kleine eigene WGS84-Bounds; im Prüfstand stehen zwei vorkonfigurierte Gebiete zur Auswahl. Dynamischer Download, Fortschritt, Quota, Abbruch und atomarer Paketwechsel sind bewusst keine implizit fertigen Funktionen.

Quellen: [Astro React-Inseln](https://docs.astro.build/en/guides/framework-components/), [MapLibre API](https://maplibre.org/maplibre-gl-js/docs/API/), lokale FieldMaps-Referenz gemäss CREDITS.md.
