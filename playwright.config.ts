import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 45_000,
    workers: 1, // The service-worker update test temporarily replaces dist/sw.js.
    use: { baseURL: 'http://localhost:4000', browserName: 'chromium', viewport: { width: 393, height: 852 } },
    webServer: { command: 'npm run preview -- --host 127.0.0.1 --ignore-lock', url: 'http://localhost:4000', reuseExistingServer: false },
});
