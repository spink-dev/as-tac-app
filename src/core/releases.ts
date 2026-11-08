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
