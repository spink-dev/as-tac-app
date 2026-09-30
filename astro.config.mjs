import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
    output: 'static',
    integrations: [react()],
    server: ({ command }) => ({
        port: command === 'dev' ? 9000 : 4000,
        host: true,
    }),
});
