# AST-007 — portable Projekte

Implementierung 0.3.0-alpha.1. Export/Import vollständiger `.astac.zip`-Dateien mit Karte, Plan, Teams, Phasen und Lizenz-/Rendererhinweisen. Importierte Projekte standardmässig lokal schreibgeschützt; eigene Kopie bearbeitbar.

Automatisierte Nachweise: Export und erneuter Import in isoliertes zweites Chromium-Profil ohne Netzwerk, Offline-Neustart, Referenzintegrität, Briefing und ausdrückliche bearbeitbare Kopie. Abgeschnittenes Archiv, Traversal, doppelte Pfade, falsche Ausgabelängen, Hashfehler und abgebrochene IndexedDB-Transaktion werden geprüft.

Grenzen: zweites Browserprofil ist kein reales zweites Telefon. iOS-Dateiauswahl, Safari-Dekompression, AirDrop/Dateien-App und Gerätespeicher unter Last noch offen. Keine automatische Cloud-Verteilung.
