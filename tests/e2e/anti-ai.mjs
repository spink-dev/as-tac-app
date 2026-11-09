// anti-ai on the real build behind the real nginx configuration (docker/): AI crawlers,
// assistants, scripts and headless browsers are refused, search engines and link previews see only
// /about/, and the app still works for people — service worker, maps and all. Needs nginx and a
// build in dist/ (npm run build); skips without nginx.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require('/opt/npm-tools/node_modules/playwright');
}

const out = process.argv[2] ?? 'tests/e2e/screenshots';
const repo = resolve('.');
const errors = [];
const results = {};
const check = (name, ok, detail = '') => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name} ${detail}`);
    }
};

if (spawnSync('nginx', ['-v']).error) {
    console.log('skipped: nginx not installed');
    process.exit(0);
}

// docker/nginx.conf with local paths: same locations, same includes, same generated anti-ai files.
const dir = mkdtempSync(join(tmpdir(), 'as-tac-anti-ai-'));
chmodSync(dir, 0o755);
const port = await new Promise((done) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = server.address();
        server.close(() => done(free));
    });
});
const local = (text) => text
    .replaceAll('/etc/nginx/snippets/security-headers.conf', join(dir, 'security-headers.conf'))
    .replaceAll('/etc/nginx/snippets/anti-ai-server.conf', join(dir, 'anti-ai-server.conf'))
    .replaceAll('/etc/nginx/snippets/anti-ai-headers.conf', join(dir, 'anti-ai-headers.conf'))
    .replaceAll('/var/log/nginx/anti-ai/anti-ai.log', join(dir, 'anti-ai.log'))
    .replaceAll('/var/log/nginx/access.log', join(dir, 'access.log'));
writeFileSync(join(dir, 'security-headers.conf'), local(readFileSync('docker/security-headers.conf', 'utf8')));
writeFileSync(join(dir, 'anti-ai-server.conf'), local(readFileSync('docker/anti-ai/server.conf', 'utf8')));
writeFileSync(join(dir, 'anti-ai-headers.conf'), readFileSync('docker/anti-ai/headers.conf', 'utf8'));
writeFileSync(join(dir, 'anti-ai-http.conf'), readFileSync('docker/anti-ai/http.conf', 'utf8'));
const site = local(readFileSync('docker/nginx.conf', 'utf8'))
    .replace('listen 80;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root ${join(repo, 'dist')};`);
writeFileSync(join(dir, 'nginx.conf'), `
worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events {}
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    client_body_temp_path ${dir}/body;
    proxy_temp_path ${dir}/proxy;
    fastcgi_temp_path ${dir}/fastcgi;
    uwsgi_temp_path ${dir}/uwsgi;
    scgi_temp_path ${dir}/scgi;
    include ${dir}/anti-ai-http.conf;
    ${site}
}
`);
const test = spawnSync('nginx', ['-t', '-p', dir, '-c', join(dir, 'nginx.conf')], { encoding: 'utf8' });
check('nginx-config-valid', test.status === 0, test.stderr);
const nginx = spawn('nginx', ['-p', dir, '-c', join(dir, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;

const get = (path, headers) => new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            body += chunk;
        });
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
});
for (let i = 0; i < 50; i++) {
    if (await get('/robots.txt', {}).then(() => true, () => false)) {
        break;
    }
    await new Promise((done) => setTimeout(done, 100));
}

try {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const person = { 'user-agent': chrome, 'accept-language': 'de-CH,de;q=0.9', accept: 'text/html,*/*;q=0.8' };
    const script = readdirSync('dist/assets').find((name) => name.endsWith('.js'));
    const map = readdirSync('dist/maps/fr').find((name) => name.endsWith('.geojson'));

    // People.
    const shell = await get('/', person);
    check('person-gets-app', shell.status === 200 && shell.body.includes('id="root"'), String(shell.status));
    check('app-not-indexable', /noindex/.test(shell.headers['x-robots-tag'] ?? '') && shell.headers['tdm-reservation'] === '1', shell.headers['x-robots-tag']);
    check('app-keeps-own-headers', shell.headers['cache-control'] === 'no-cache' && shell.headers['x-frame-options'] === 'DENY');
    check('person-gets-script', (await get(`/assets/${script}`, person)).status === 200);
    check('person-gets-map', (await get(`/maps/fr/${map}`, person)).status === 200);
    check('person-without-language-refused', (await get('/', { 'user-agent': chrome })).status === 403);

    // AI crawlers, assistants and agents: nothing at all.
    for (const [name, ua] of [
        ['gptbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'],
        ['claude-user', 'Claude-User (claude-code/2.0; +https://support.anthropic.com/)'],
        ['perplexity', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
    ]) {
        const statuses = await Promise.all(['/', '/about/', `/assets/${script}`, `/maps/fr/${map}`, '/licenses/CHANGELOG.md'].map(async (path) => (await get(path, { 'user-agent': ua, 'accept-language': 'en' })).status));
        check(`${name}-refused-everywhere`, statuses.every((status) => status === 403), statuses.join(','));
    }
    const signed = await get('/', { ...person, 'signature-agent': '"https://chatgpt.com"', 'signature-input': 'sig1=();tag="web-bot-auth"' });
    check('signed-agent-refused', signed.status === 403 && /not permitted/.test(signed.body), String(signed.status));
    check('ai-may-read-robots', (await get('/robots.txt', { 'user-agent': 'GPTBot/1.2' })).status === 200);
    check('ai-may-read-tdmrep', (await get('/.well-known/tdmrep.json', { 'user-agent': 'GPTBot/1.2' })).body.includes('tdm-reservation'));

    // Scripts.
    for (const ua of ['curl/8.5.0', 'python-requests/2.32.3', 'node', 'Wget/1.21.4', '']) {
        check(`script-refused-${ua || 'empty'}`, (await get(`/assets/${script}`, { 'user-agent': ua })).status === 403);
    }

    // Search engines: the info page only, no rewrite (no cloaking).
    const googlebot = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };
    check('search-refused-on-app', (await get('/', googlebot)).status === 403);
    const info = await get('/about/', googlebot);
    check('search-reads-info', info.status === 200 && info.body.includes('Taktische Karten für Airsoft'), String(info.status));
    check('info-indexable', !/noindex/.test(info.headers['x-robots-tag'] ?? '') && /noai/.test(info.headers['x-robots-tag'] ?? ''), info.headers['x-robots-tag']);
    check('search-reads-icon', (await get('/icon-512.png', googlebot)).status === 200);

    // Link previews (WhatsApp invite links): the info page instead of the app.
    const preview = await get('/', { 'user-agent': 'WhatsApp/2.24.20.89 A' });
    check('preview-gets-info', preview.status === 200 && preview.body.includes('og:title'), String(preview.status));

    // The trap and its log line for fail2ban.
    check('trap-refused', (await get('/_/t9q4x2/', person)).status === 403);
    await new Promise((done) => setTimeout(done, 200));
    const log = readFileSync(join(dir, 'anti-ai.log'), 'utf8');
    check('trap-logged', /^127\.0\.0\.1 \[[^\]]+\] "GET \/_\/t9q4x2\/ HTTP\/1\.1" 403 action=trap /m.test(log));

    // The app in a browser that identifies as an ordinary Chrome works through all of this.
    // (Set for the whole browser: a context's userAgent does not reach the service worker's fetches.)
    const browser = await playwright.chromium.launch({ args: [`--user-agent=${chrome}`] });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', userAgent: chrome, serviceWorkers: 'allow' });
        const page = await context.newPage();
        const refused = [];
        page.on('response', (response) => {
            if (response.status() === 403 || response.status() === 429) {
                refused.push(`${response.status()} ${response.url()}`);
            }
        });
        page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
        await page.goto(base);
        await page.waitForFunction(() => navigator.serviceWorker.getRegistration().then((r) => Boolean(r?.active)), null, { timeout: 30000, polling: 500 });
        await page.reload();
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30000 });
        await page.getByTestId('new-plan').click();
        await page.getByTestId('create-plan').click();
        await page.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
        await page.waitForTimeout(2500);
        check('app-works-through-anti-ai', refused.length === 0, refused.join(' '));
        await page.screenshot({ path: `${out}/anti-ai-app.png` });
        await page.goto(`${base}/about/`);
        await page.screenshot({ path: `${out}/anti-ai-about.png`, fullPage: true });
    } finally {
        await browser.close();
    }
    // A headless browser that says so is refused.
    const headless = await playwright.chromium.launch();
    try {
        const plain = await headless.newPage();
        const response = await plain.goto(base);
        check('headless-browser-refused', response?.status() === 403, String(response?.status()));
    } finally {
        await headless.close();
    }
} finally {
    nginx.kill();
    rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
