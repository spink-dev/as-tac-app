# AST-014 — offene Feldabnahme

Stand 2026-10-01: **nicht bestanden / noch nicht durchgeführt**. Diese Liste ist eine ausführbare Abnahmevorbereitung, kein Testergebnis. Geräte: iPhone 16 Pro und Samsung Galaxy A24. Erstes reales Gebiet: Zürich/Benglen; zusätzlich Mahlwinkel.

1. Auf Testing Version/Commit und Browser-/OS-Version notieren. Mit vorbereiteter App 20 gemischte Elemente, Teams und 3 Phasen anlegen, Paket exportieren und auf zweitem Gerät importieren. App beenden, Flugmodus, Kaltstart: Karte, Plan, Phasen und Quellen verfügbar; Zeit bis Bedienbarkeit messen (Ziel <3 s).
2. Unter freiem Himmel GPS starten, Zeit bis Fix, Genauigkeit/Alter und aktuelle Uhrzeit notieren. Hintergrund/Vordergrund, Stop, verweigerte Freigabe und ausserhalb Gebiet prüfen. Keine Position darf als fremder gemeinsamer Marker auftauchen.
3. Nach Einrichtung des Supabase-Testing-Projekts Owner, Admin und Viewer in getrennten Sitzungen anmelden. Verschiedene Objekte gleichzeitig ändern; Bestätigung bis Anzeige beim Viewer messen. Gleichen Ausgangsstand absichtlich gleichzeitig ändern: eigener Konflikt muss erhalten bleiben.
4. Verbindung während einer Sendung unterbrechen. Nach Wiederverbindung ausdrücklich erneut prüfen; Datenbanksequenz darf dieselbe Operation nicht doppelt enthalten. Offline-Kopie ohne Anmeldung öffnen, Entwurf ergänzen, neu starten und später nach Anmeldung ausdrücklich vergleichen/publizieren.
5. Admin-Rechte während des Entwurfs entziehen. Direkte RPC-Mutation muss scheitern, Entwurf bleibt lokal rettbar. Viewer dürfen weder Projekt-/Mitglieder-/Briefing-Schreibrechte über manipulierte Requests erhalten.
6. Zwei Admins versuchen gleichzeitig die Briefing-Leitung. Nur einer führt. Viewer folgen freiwillig, pausieren, erkunden und folgen wieder. Leitung verliert Netz: nach spätestens 20 Sekunden auslaufen; Kamera/Phasen-Folgen darf die Plansequenz nicht ändern.
7. Speicher-/Downloadabbruch, beschädigtes Paket und Update während Zeichnung prüfen (A07/A09/A10). Bestehende Daten müssen verfügbar bleiben. Exportdatei nach lokalem Browser-Speicherverlust auf anderem Gerät öffnen.

Pro Schritt: Ergebnis, Zeitstempel, Gerät, OS/Browser, App-Version/Commit, Netzwerk, Elementzahl und Abweichung dokumentieren. Automatisierte Chromium-/PGlite-Ergebnisse ergänzen die Prüfung, ersetzen sie nicht. Vor Ablösung von TacMap alle A01–A10 bewerten und offene Fehler ausdrücklich freigeben.
