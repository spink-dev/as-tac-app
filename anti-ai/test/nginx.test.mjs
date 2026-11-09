// The generated nginx configuration against a real nginx: every client on every path must get
// what classify.mjs decides (skipped when nginx is not installed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePolicy, decide } from '../lib/classify.mjs';
import * as render from '../lib/render.mjs';
import { loadLists } from '../bin/anti-ai.mjs';
import { CLIENTS, PATHS, site } from './fixtures.mjs';

const nginx = spawnSync('nginx', ['-v']).error ? null : 'nginx';
const lists = await loadLists();

function freePort() {
    return new Promise((resolve) => {
        const server = createServer().listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function get(port, path, headers) {
    return new Promise((resolve, reject) => {
        // node:http sends exactly these headers (fetch would add Accept-Language and others).
        const req = request({ host: '127.0.0.1', port, path, headers, setHost: true }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function startNginx(siteConfig) {
    const dir = mkdtempSync(join(tmpdir(), 'anti-ai-nginx-'));
    chmodSync(dir, 0o755);
    const www = join(dir, 'www');
    const files = {
        'index.html': 'APP',
        'about/index.html': 'INFO',
        'icon-512.png': 'ICON',
        'assets/app.js': 'JS',
        'maps/de/mahlwinkel.geojson': 'MAP',
        'robots.txt': 'ROBOTS',
        'ai.txt': 'AITXT',
        '.well-known/tdmrep.json': 'TDM',
    };
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(www, path, '..'), { recursive: true });
        writeFileSync(join(www, path), content);
    }
    const local = {
        ...siteConfig,
        nginx: { logFile: join(dir, 'anti-ai.log'), accessLog: join(dir, 'access.log'), headersInclude: join(dir, 'headers.conf') },
    };
    const policy = compilePolicy(local, lists);
    writeFileSync(join(dir, 'http.conf'), render.nginxHttp(policy, local));
    writeFileSync(join(dir, 'server.conf'), render.nginxServer(policy, local));
    writeFileSync(join(dir, 'headers.conf'), render.nginxHeaders());
    const port = await freePort();
    writeFileSync(join(dir, 'nginx.conf'), `
worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events {}
http {
    include /etc/nginx/mime.types;
    client_body_temp_path ${dir}/body;
    proxy_temp_path ${dir}/proxy;
    fastcgi_temp_path ${dir}/fastcgi;
    uwsgi_temp_path ${dir}/uwsgi;
    scgi_temp_path ${dir}/scgi;
    include ${dir}/http.conf;
    server {
        listen 127.0.0.1:${port};
        root ${www};
        include ${dir}/server.conf;
        location / {
            include ${dir}/headers.conf;
            try_files $uri $uri/ /index.html;
        }
    }
}
`);
    const check = spawnSync(nginx, ['-t', '-p', dir, '-c', join(dir, 'nginx.conf')], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    const proc = spawn(nginx, ['-p', dir, '-c', join(dir, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
        try {
            await get(port, '/robots.txt', {});
            break;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return { dir, port, proc, policy };
}

let server = null;

before(async () => {
    if (nginx) {
        server = await startNginx(site);
    }
});

after(() => {
    server?.proc.kill();
    if (server) {
        rmSync(server.dir, { recursive: true, force: true });
    }
});

test('nginx answers every client on every path like classify.mjs', { skip: !nginx && 'nginx not installed' }, async () => {
    const failures = [];
    const bodies = { allow: null, info: 'INFO', deny: server.policy.denyBody.trim(), trap: server.policy.denyBody.trim() };
    for (const [label, headers] of CLIENTS) {
        for (const [path] of PATHS) {
            const want = decide({ path, headers }, server.policy);
            const res = await get(server.port, path, headers);
            const status = want.action === 'deny' || want.action === 'trap' ? 403 : 200;
            const body = bodies[want.action];
            const robots = res.headers['x-robots-tag'];
            // nginx sends a directory without its slash to the slash (/about → /about/).
            const redirected = status === 200 && res.status === 301 && new URL(res.headers.location, 'http://x').pathname === `${path}/`;
            if (redirected) {
                continue;
            }
            if (res.status !== status || (body && res.body.trim() !== body) || !robots || res.headers['tdm-reservation'] !== '1') {
                failures.push(`${label} ${path}: ${res.status} "${res.body.trim().slice(0, 40)}" robots=${robots}; want ${status} ${want.action}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('the log feeds fail2ban: trap hits match the filter, allowed requests are not logged', { skip: !nginx && 'nginx not installed' }, async () => {
    await get(server.port, '/_/trap01/x', { 'user-agent': 'Mozilla/5.0 Chrome/141', 'accept-language': 'de' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const log = readFileSync(join(server.dir, 'anti-ai.log'), 'utf8').trim().split('\n');
    const filter = render.fail2banFilter('trap');
    const failregex = filter.match(/^failregex = (.*)$/m)[1].replace('<HOST>', '(?<host>\\S+)');
    const re = new RegExp(failregex);
    const traps = log.filter((line) => line.includes('action=trap'));
    assert.ok(traps.length > 0);
    for (const line of traps) {
        assert.equal(re.exec(line)?.groups.host, '127.0.0.1', line);
    }
    assert.ok(!log.some((line) => line.includes('action=allow')));
    assert.ok(log.some((line) => line.includes('action=deny kind=ai')));
});

test('documents are rate-limited per address, files are not', { skip: !nginx && 'nginx not installed' }, async () => {
    const limited = await startNginx({ ...site, rateLimit: { documentsPerSecond: 1, burst: 2 } });
    try {
        const browser = { 'user-agent': 'Mozilla/5.0 Chrome/141', 'accept-language': 'de' };
        const pages = [];
        const files = [];
        for (let i = 0; i < 6; i++) {
            pages.push((await get(limited.port, '/', browser)).status);
            files.push((await get(limited.port, '/assets/app.js', browser)).status);
        }
        assert.ok(pages.includes(429), pages.join(','));
        assert.ok(pages.slice(0, 3).every((status) => status === 200), pages.join(','));
        assert.ok(files.every((status) => status === 200), files.join(','));
    } finally {
        limited.proc.kill();
        rmSync(limited.dir, { recursive: true, force: true });
    }
});
