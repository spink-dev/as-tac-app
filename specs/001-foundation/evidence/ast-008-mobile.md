# AST-008 — mobiler GPS-Lebenszyklus

Preview 0.3.0-alpha.2. GPS ist ausdrücklich Vordergrundbetrieb: `visibilitychange`/`pagehide` beenden den Watch; `pageshow`/Rückkehr fordern nur bei weiter aktivem Nutzerwunsch einen neuen Fix an. Kein persistierter GPS-Zustand, keine Übertragung, keine Hintergrundtracking-Zusage.

Automatisiert in Chromium: mehrfaches Resume erzeugt nur einen Watch; alte Callback-Ergebnisse ändern weder Fix noch Status; Stop und denied bleiben wirksam. Wiederanlauf zeigt die letzte Position als veraltet bis ein neuer gültiger Fix kommt. Rückläufige/Zukunfts-Zeitstempel werden verworfen. Warnung bei Genauigkeitsradius über 50 m. Bestehende Offline-/Follow-/GPS-Tests weiterhin bestanden.

## Prüfschritte für iPhone 16 Pro und Samsung Galaxy A24 — ausstehend

1. Preview über HTTPS laden, Versionsanzeige 0.3.0-alpha.2 prüfen, Zürich/Benglen wählen, „Offline bereit“ abwarten.
2. Projekt mit Element, Team und Phase erstellen; vollständige .astac.zip sichern und auf das zweite vorbereitete Telefon übertragen. Im Flugmodus importieren: schreibgeschützt, Karte/Labels/Briefing vorhanden. App schliessen/öffnen und erneut prüfen. Eine bearbeitbare Kopie erstellen; Original bleibt unverändert.
3. Draussen in Benglen GPS starten; Genauigkeit und Zeitpunkt notieren. App wechseln bzw. Bildschirm sperren, 40 Sekunden warten, zurückkehren. Letzter Fix muss bis zum nächsten Fix veraltet erscheinen.
4. GPS stoppen, erneut App wechseln: kein selbständiger Start. Standortfreigabe verweigern und ebenfalls prüfen.
5. Karte verschieben: Follow pausiert; „Position folgen“ aktiviert es wieder. Ausserhalb des Gebiets bleibt die Warnung sichtbar.
6. 30 Minuten im Flugmodus gehen; Ausfälle, ersten Fix, Akkustand und Kartenreaktion notieren. OS-/Browser-Version und Safari/Chrome/Standalone-Modus mit erfassen.

Keine der realen Geräteprüfungen wurde durch die Browserautomation ersetzt oder als bestanden markiert. AST-001/008/014-Geräteabnahme bleibt offen.

Abschlussprüfung: `npm run check` ohne Fehler/Warnungen, Produktionsbuild erfolgreich, vollständige Suite 31 Tests bestanden. Nach zusätzlicher Import-Rollback-Härtung erneut Build/Check und drei Pakettests bestanden. MapLibre-Chunkwarnung weiterhin bekannt.
