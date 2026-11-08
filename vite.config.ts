import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Large bundled OSM areas are installed into IndexedDB on demand instead of being precached.
const ON_DEMAND = ['maps/zurich.geojson', 'maps/benglen.geojson'];

export default defineConfig({
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
                globPatterns: ['**/*.{js,css,html,svg,png,pbf,txt,webmanifest}', 'maps/*.json', 'maps/mahlwinkel.geojson'],
                globIgnores: ON_DEMAND,
            },
            devOptions: { enabled: false },
        }),
    ],
});
