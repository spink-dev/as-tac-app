# AST-006 — Teams, Phasen und Offline-Briefing

2026-10-01 · Preview 0.2.0-alpha.3, Implementierung vorhanden. Teams mit Namen/Kürzel/Farbe, Elementzuordnung, Phasen mit Reihenfolge/Titel/Notizen/Kamera/Elementsichtbarkeit. Zuordnungen zwischen Elementen und Phasen werden in gemeinsamen Command-Batches gepflegt. Löschen bereinigt Verweise atomar; Undo stellt Inhalt und Zuordnungen wieder her.

Lokales Briefing stellt Phasenkamera und sichtbare Plan-Layer dar; Vor/Zurück und Pfeiltasten wechseln Phasen. Auswahl/Phasenanzeige schreiben keine Projektdaten. Freihandmarkierungen sind getrennte Sitzungsdaten im eigenen Renderer-Layer. Verlassen und Phasenwechsel leeren sie. Nur „In Plan übernehmen“ schreibt neue Elemente plus Phasenzuordnung in einem rückgängig machbaren Command-Batch. Keine Online-Rechte/Präsentationsführung oder GPS-Übertragung hinzugefügt.

Tests: reine Command-Prüfungen für Team-/Phasenlöschung, inverse Referenzwiederherstellung, Phasenreihenfolge und Zuordnung. Browser-Roundtrip erstellt Element/Team/zwei Phasen, weist zu, ändert Sichtbarkeit/Notizen, startet Briefing, wechselt Phasen per Button/Tastatur und zeichnet temporär. Gespeicherter Datensatz samt Revision bleibt nach Verlassen exakt unverändert. Offline-Reload erhält Teams/Phasen/Kamera; explizite Übernahme speichert und Undo entfernt die Markierung samt Phasenreferenz. Keine Browserfehler im Ablauf. Screenshot `test-results/briefing-mobile.png` visuell geprüft.

Grenzen: Chromium-Automation ersetzt keine reale Telefonprüfung, Kamera-Nutzerergonomie oder Live-Feldabnahme. Temporäre Zeichnungen sind auf 50 Striche mit je 2 000 Punkten begrenzt und werden nicht wiederhergestellt. Neue Phasen enthalten zunächst alle aktuellen Elemente; später erzeugte Elemente werden bewusst zugeordnet. AST-007-Archivpakete und M2-Online-Funktionen sind nicht Teil dieses Schritts.

Finale Prüfung: `npm run check` ohne Fehler/Warnungen/Hinweise, Produktionsbuild `37c35bc1b00eb931` (18 Ressourcen, 3'901'112 Bytes), `npm test` 27/27 bestanden in 28,7 s. Bekannte MapLibre-Chunkgrössenwarnung bleibt.
