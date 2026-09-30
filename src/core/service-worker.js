/* MANIFEST is injected by scripts/build-offline.mjs after the production build. */
/* global MANIFEST */
const CACHE = `as-tac-${MANIFEST.version}`;

async function verified(response, resource) {
    if (!response || !response.ok) {
        throw new Error(`Ressource fehlt: ${resource.url}`);
    }
    const bytes = await response.clone().arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
    if (bytes.byteLength !== resource.bytes || hash !== resource.sha256) {
        throw new Error(`Ressource unvollständig: ${resource.url}`);
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        try {
            for (const resource of MANIFEST.resources) {
                const response = await fetch(resource.url, { cache: 'reload' });
                await verified(response, resource);
                await cache.put(resource.url, response);
            }
        } catch (error) {
            await caches.delete(CACHE);
            throw error;
        }
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    // Retain previous caches: another tab may still run the previous build.
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'ACTIVATE') {
        event.waitUntil(self.skipWaiting());
    }
    if (event.data?.type === 'VERIFY' || event.data?.type === 'REPAIR') {
        event.waitUntil((async () => {
            try {
                const cache = await caches.open(CACHE);
                for (const resource of MANIFEST.resources) {
                    try {
                        await verified(await cache.match(resource.url), resource);
                    } catch (error) {
                        if (event.data.type !== 'REPAIR') {
                            throw error;
                        }
                        const response = await fetch(resource.url, { cache: 'reload' });
                        await verified(response, resource);
                        await cache.put(resource.url, response);
                    }
                }
                event.ports[0]?.postMessage({ ready: true, version: MANIFEST.version, bytes: MANIFEST.byteSize });
            } catch (error) {
                event.ports[0]?.postMessage({ ready: false, error: String(error) });
            }
        })());
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }
    const resource = MANIFEST.resources.find((r) => r.url === url.pathname);
    if (!resource) {
        return;
    }
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(resource.url);
        if (cached) {
            return cached;
        }
        const response = await fetch(event.request);
        await verified(response, resource);
        await cache.put(resource.url, response.clone());
        return response;
    })());
});
