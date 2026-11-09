/**
 * Short release notes shown in the app («Neuerungen»), newest first: [Deutsch, English] per item.
 * The full history is CHANGELOG.md. Add an entry with every version bump in package.json.
 */
export interface Release {
    version: string;
    date: string;
    items: readonly (readonly [string, string])[];
}

export const RELEASES: readonly Release[] = [
    {
        version: '1.0.0-alpha.3',
        date: '2026-11-09',
        items: [
            [
                'Neu mitgeliefert: 36 Airsoft-Felder in 13 Ländern mit OpenStreetMap-Grundkarte, darunter der Bärenkopf (Fort de la Tête de l’Ours), Riedikon und Steinmaur, Airsoft Park Tirol und Blackfield. Die Felder sind nach Land geordnet und werden erst beim ersten Gebrauch auf dem Gerät gespeichert.',
                'Now included: 36 airsoft fields in 13 countries with an OpenStreetMap basemap, among them the Bärenkopf (Fort de la Tête de l’Ours), Riedikon and Steinmaur, Airsoft Park Tirol and Blackfield. Fields are sorted by country and saved to the device only when first used.',
            ],
            [
                'Die Zürcher Testgebiete (Benglen, Zürich bis Benglen) sind nicht mehr dabei. Wer sie schon gespeichert hat, behält sie unter «Auf diesem Gerät».',
                'The Zürich test areas (Benglen, Zürich to Benglen) are gone. If you saved them before, they stay under "On this device".',
            ],
            [
                'Fehlt einem Plan die Grundkarte auf diesem Gerät, sagt die App das jetzt, statt still eine leere Karte zu zeigen. Gebietsdownloads haben einen dritten Ausweichserver.',
                'When a plan’s basemap is missing on this device, the app now says so instead of quietly showing an empty map. Area downloads have a third fallback server.',
            ],
        ],
    },
    {
        version: '1.0.0-alpha.2',
        date: '2026-11-08',
        items: [
            [
                'Deutsch ist die erste Sprache. Englisch lässt sich auf der Startseite, in den Einstellungen und in der Befehlssuche wählen.',
                'German is the first language. English can be chosen on the start screen, in the settings and in the command search.',
            ],
            [
                'Pläne, Dateien und Einstellungen aus älteren Versionen werden beim Öffnen automatisch übernommen; Daten aus einer neueren Version bleiben unangetastet, bis die App aktualisiert ist.',
                'Plans, files and settings from older versions are brought up to date when opened; data from a newer version stays untouched until the app is updated.',
            ],
            [
                'Live-Pläne funktionieren über App-Versionen hinweg. Arbeitet ein Partner mit einer neueren Version, zeigt die App «Update nötig» und hält die eigenen Änderungen zurück, bis aktualisiert ist – nichts geht verloren.',
                'Live plans work across app versions. When a partner uses a newer version, the app shows "Update needed" and holds back your changes until you update – nothing is lost.',
            ],
            [
                'Versionsanzeige und «Nach Updates suchen». Ein Update wird erst auf Tippen eingespielt; vorher wird alles gespeichert, danach öffnet sich derselbe Plan im selben Modus.',
                'Version display and "Check for updates". An update is only applied when you tap it; everything is saved first, then the same plan reopens in the same mode.',
            ],
        ],
    },
    {
        version: '1.0.0-alpha.1',
        date: '2026-11-08',
        items: [
            [
                'Neue App: echte OSM-Karten offline, Bildkarten-Werkzeuge aus TacMap, Feld- und Briefingmodus, Teilen per Datei und QR, Live-Zusammenarbeit.',
                'New app: real OSM maps offline, image-map tools from TacMap, field and briefing modes, sharing by file and QR, live collaboration.',
            ],
            [
                'Schwaches Mobilfunknetz: Live-Abgleich in fortsetzbaren Seiten, Bildkarten im Hintergrund mit Datensparmodus, Gebietsdownloads in Teilen.',
                'Weak mobile networks: live sync in resumable pages, image maps in the background with data saver, area downloads in parts.',
            ],
        ],
    },
];
