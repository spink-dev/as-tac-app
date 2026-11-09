// The site's own Vercel proxy (proxy.mjs in the directory the tests run in), loaded the way Vercel
// runs it: plain Node ESM, no bundler. A JSON import or a missing extension fails here as it would
// in production (MIDDLEWARE_INVOCATION_FAILED for every request).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = join(process.cwd(), 'proxy.mjs');

test('the site proxy loads as plain ESM and answers', { skip: !existsSync(entry) && 'no proxy.mjs here' }, async () => {
    const { default: proxy } = await import(pathToFileURL(entry).href);
    const refused = proxy(new Request('https://site.test/', { headers: { 'user-agent': 'GPTBot/1.2' } }));
    assert.equal(refused.status, 403);
    const person = proxy(new Request('https://site.test/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/141', 'accept-language': 'de' } }));
    assert.equal(person.headers.get('x-middleware-next'), '1');
});
