import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Prepared fields (public/maps/<country>/) are installed into IndexedDB on demand, checked against
// the SHA-256 in src/config/maps.json; only Mahlwinkel is precached. `maps/mahlwinkel.json` stays for
// apps up to 1.0.0-alpha.2, which read the manifest before the data.
const PRECACHED_MAPS = ['maps/mahlwinkel.json', 'maps/mahlwinkel.geojson'];

/**
 * Identity of this build: package version, commit and build time. `BUILD_COMMIT` comes from the
 * Docker build (no .git there); `BUILD_VERSION` only exists for the update test (two builds).
 */
function commit(): string {
    if (process.env.BUILD_COMMIT) {
        return process.env.BUILD_COMMIT.slice(0, 12);
    }
    try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return '';
    }
}
const BUILD = {
    version: process.env.BUILD_VERSION || (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version,
    commit: commit(),
    date: new Date().toISOString(),
};

/** `/version.json`: what the server has now. Never precached, so the app can compare against it. */
const versionFile: Plugin = {
    name: 'as-tac-version',
    configureServer(server) {
        server.middlewares.use('/version.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(BUILD));
        });
    },
    generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
};

/** Ship CREDITS.md and CHANGELOG.md with the app (offline dialogs link to them); served in dev too. */
const shipCredits: Plugin = {
    name: 'as-tac-credits',
    configureServer(server) {
        for (const file of ['CREDITS.md', 'CHANGELOG.md']) {
            server.middlewares.use(`/licenses/${file}`, (_req, res) => {
                res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
                res.end(readFileSync(file, 'utf8'));
            });
        }
    },
    generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'licenses/CREDITS.md', source: readFileSync('CREDITS.md', 'utf8') });
        this.emitFile({ type: 'asset', fileName: 'licenses/CHANGELOG.md', source: readFileSync('CHANGELOG.md', 'utf8') });
    },
};

export default defineConfig({
    define: { __BUILD__: JSON.stringify(BUILD) },
    server: { port: 9000, host: true },
    preview: { port: 4000, host: true },
    build: {
        chunkSizeWarningLimit: 1100,
        rolldownOptions: {
            output: {
                codeSplitting: {
                    minSize: 20000,
                    groups: [
                        { name: 'framework', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
                        { name: 'map-engine', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 35 },
                        { name: 'state-storage', test: /node_modules[\\/](dexie|zustand|immer)[\\/]/, priority: 30 },
                        { name: 'file-format', test: /node_modules[\\/](fflate|zod|uqr)[\\/]/, priority: 25 },
                        { name: 'online', test: /node_modules[\\/](@supabase)[\\/]/, priority: 24 },
                        { name: 'motion', test: /node_modules[\\/](gsap|lenis)[\\/]/, priority: 22 },
                        { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 20 },
                        { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
                    ],
                },
            },
        },
    },
    plugins: [
        react(),
        shipCredits,
        versionFile,
        VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'brand/*.svg', 'licenses/*.txt'],
            manifest: {
                id: '/',
                name: 'AS-TAC · Taktische Karte',
                short_name: 'AS-TAC',
                description: 'Offline-Karten, Planung, Feldnavigation und Live-Briefing für Airsoft.',
                lang: 'de-CH',
                theme_color: '#171a1e',
                background_color: '#171a1e',
                display: 'standalone',
                orientation: 'any',
                start_url: '/',
                scope: '/',
                categories: ['productivity', 'navigation', 'utilities'],
                icons: [
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
                ],
                file_handlers: [
                    {
                        action: '/',
                        accept: {
                            'application/x-astac': ['.astac'],
                            'application/x-tacmap': ['.tacmap'],
                            'application/zip': ['.zip'],
                            'application/json': ['.json'],
                        },
                    },
                ],
            },
            workbox: {
                cleanupOutdatedCaches: true,
                clientsClaim: true,
                skipWaiting: false,
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/maps\//, /^\/glyphs\//],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,html,svg,png,pbf,txt,webmanifest}', 'licenses/*.md', ...PRECACHED_MAPS],
            },
            devOptions: { enabled: false },
        }),
    ],
});
