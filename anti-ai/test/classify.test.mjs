import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePolicy, decide, namesPattern, normalisePath } from '../lib/classify.mjs';
import { createProxy } from '../lib/vercel.mjs';
import { loadLists } from '../bin/anti-ai.mjs';
import { CLIENTS, PATHS, REAL_BROWSERS, expected, site } from './fixtures.mjs';

const lists = await loadLists();
const policy = compilePolicy(site, lists);

test('every client gets the expected answer on every path', () => {
    const failures = [];
    for (const [label, headers, kind] of CLIENTS) {
        for (const [path, pathKind] of PATHS) {
            const result = decide({ path, headers }, policy);
            const want = expected(kind, pathKind, Boolean(headers['accept-language']));
            if (result.kind !== kind || result.pathKind !== pathKind || result.action !== want) {
                failures.push(`${label} ${path}: got ${result.kind}/${result.pathKind}/${result.action}, want ${kind}/${pathKind}/${want}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('real browsers and in-app browsers are people', () => {
    const wrong = REAL_BROWSERS.map((ua) => [ua, decide({ path: '/', headers: { 'user-agent': ua, 'accept-language': 'de-CH' } }, policy)]).filter(([, d]) => d.kind !== 'browser' || d.action !== 'allow');
    assert.deepEqual(wrong.map(([ua, d]) => `${d.kind}: ${ua}`), []);
});

test('short or browser-like names in the lists never match', () => {
    const re = new RegExp(namesPattern(['K', 'wv', 'Mobile', 'Version', 'Dot', 'Spider']), 'i');
    assert.ok(!re.test('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141 Mobile Safari/537.36'));
    assert.ok(re.test('Spider/1.0'));
    assert.equal(namesPattern(['K', 'wv']), null);
});

test('link previews: fetchers get the info page, in-app browsers stay browsers', () => {
    const kind = (ua) => decide({ path: '/', headers: { 'user-agent': ua, 'accept-language': 'de' } }, policy).kind;
    assert.equal(kind('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'), 'preview');
    assert.equal(kind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) facebookexternalhit/1.1 Facebot Twitterbot/1.0'), 'preview');
    assert.equal(kind('WhatsApp/2.24.20.89 A'), 'preview');
    assert.equal(kind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.25.20.1'), 'browser');
    assert.equal(kind('meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'), 'ai');
});

test('names match whole names only, case-insensitively', () => {
    const re = new RegExp(namesPattern(['Code', 'GPTBot', 'Brightbot 1.0']), 'i');
    assert.ok(re.test('Mozilla/5.0 (compatible; gptbot/1.2)'));
    assert.ok(re.test('Code/1.95.0'));
    assert.ok(re.test('Brightbot 1.0'));
    assert.ok(!re.test('VSCode/1.95.0'));
    assert.ok(!re.test('Brightbot 1x0'));
    assert.equal(namesPattern([]), null);
});

test('paths are compared as nginx sees them', () => {
    assert.equal(normalisePath('/a//b/../c/'), '/a/c/');
    assert.equal(normalisePath('/%61bout'), '/about');
    assert.equal(normalisePath('/'), '/');
    assert.equal(normalisePath('/%E0%A4%A'), '/%E0%A4%A');
});

test('modes change the answers', () => {
    const strict = compilePolicy({ ...site, search: 'deny', previews: 'deny' }, lists);
    assert.equal(decide({ path: '/about/', headers: { 'user-agent': 'Googlebot/2.1' } }, strict).action, 'deny');
    assert.equal(decide({ path: '/', headers: { 'user-agent': 'WhatsApp/2.24' } }, strict).action, 'deny');
    const aiInfo = compilePolicy({ ...site, ai: 'info' }, lists);
    assert.equal(decide({ path: '/about/', headers: { 'user-agent': 'GPTBot/1.2' } }, aiInfo).action, 'allow');
    assert.equal(decide({ path: '/', headers: { 'user-agent': 'GPTBot/1.2' } }, aiInfo).action, 'deny');
    const lenient = compilePolicy({ ...site, requireAcceptLanguage: false }, lists);
    assert.equal(decide({ path: '/', headers: { 'user-agent': 'Mozilla/5.0 Chrome/141' } }, lenient).action, 'allow');
});

test('site configuration is validated', () => {
    assert.throws(() => compilePolicy({ ...site, trapPath: '/' }, lists), /trapPath/);
    assert.throws(() => compilePolicy({ ...site, trapPath: '/a b/' }, lists), /trapPath/);
    assert.throws(() => compilePolicy({ ...site, ai: 'maybe' }, lists), /ai/);
});

test('an allow-listed monitor gets through, a signed agent never does', () => {
    const withMonitor = compilePolicy({ ...site, allowUserAgents: ['UptimeRobot'] }, lists);
    assert.equal(decide({ path: '/', headers: { 'user-agent': 'Mozilla/5.0+(compatible; UptimeRobot/2.0)' } }, withMonitor).action, 'allow');
    assert.equal(decide({ path: '/', headers: { 'user-agent': 'UptimeRobot/2.0', 'signature-agent': '"x"' } }, withMonitor).action, 'deny');
});

test('the Vercel proxy answers like the decision', () => {
    const proxy = createProxy(policy);
    const request = (path, headers) => new Request(`https://example.test${path}`, { headers });
    const browser = proxy(request('/', { 'user-agent': 'Mozilla/5.0 Chrome/141', 'accept-language': 'de' }));
    assert.equal(browser.headers.get('x-middleware-next'), '1');
    assert.match(browser.headers.get('x-robots-tag'), /noindex/);
    assert.equal(browser.headers.get('tdm-reservation'), '1');

    const bot = proxy(request('/assets/app.js', { 'user-agent': 'GPTBot/1.2' }));
    assert.equal(bot.status, 403);
    assert.equal(bot.headers.get('cache-control'), 'no-store');

    const preview = proxy(request('/', { 'user-agent': 'WhatsApp/2.24' }));
    assert.equal(new URL(preview.headers.get('x-middleware-rewrite')).pathname, '/about/');

    const search = proxy(request('/about/', { 'user-agent': 'Googlebot/2.1' }));
    assert.equal(search.headers.get('x-middleware-next'), '1');
    assert.equal(search.headers.get('x-robots-tag'), policy.robotsTag.info);

    const trap = proxy(request('/_/trap01/', { 'user-agent': 'Mozilla/5.0 Chrome/141', 'accept-language': 'de' }));
    assert.equal(trap.status, 403);
});
