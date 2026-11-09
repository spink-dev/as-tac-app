#!/usr/bin/env node
// anti-ai: keeps AI crawlers, AI assistants, scrapers and scripts away from a site.
//
//   node anti-ai/bin/anti-ai.mjs build [--site anti-ai.site.json]   write every output of the site
//   node anti-ai/bin/anti-ai.mjs check [--site anti-ai.site.json]   fail when an output is out of date
//   node anti-ai/bin/anti-ai.mjs update-list                        refresh data/ai-robots.json
//
// Paths in the site file are relative to the directory the command runs in.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePolicy } from '../lib/classify.mjs';
import * as render from '../lib/render.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST_URL = 'https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json';

export async function loadLists() {
    return {
        aiRobots: JSON.parse(await readFile(join(KIT, 'data/ai-robots.json'), 'utf8')),
        agents: JSON.parse(await readFile(join(KIT, 'data/agents.json'), 'utf8')),
    };
}

/** All outputs of a site as { relative path: content }. */
export function outputs(site, lists) {
    const policy = compilePolicy(site, lists);
    const targets = site.outputs ?? {};
    const files = {};
    const add = (key, content) => {
        if (targets[key]) {
            files[targets[key]] = content;
        }
    };
    add('robots', render.robotsTxt(policy, lists));
    add('aiTxt', render.aiTxt(policy));
    add('tdmrep', render.tdmrep());
    add('meta', render.metaTags(policy));
    add('nginxHttp', render.nginxHttp(policy, site));
    add('nginxServer', render.nginxServer(policy, site));
    add('nginxHeaders', render.nginxHeaders());
    add('fail2banTrapFilter', render.fail2banFilter('trap'));
    add('fail2banDenyFilter', render.fail2banFilter('deny'));
    add('fail2banJail', render.fail2banJail(site));
    add('vercelPolicy', render.vercelPolicy(policy));
    return files;
}

async function main() {
    const [command = 'build', ...rest] = process.argv.slice(2);
    const siteIndex = rest.indexOf('--site');
    const sitePath = siteIndex >= 0 ? rest[siteIndex + 1] : 'anti-ai.site.json';
    if (command === 'update-list') {
        const response = await fetch(LIST_URL, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${LIST_URL}`);
        }
        const list = await response.json();
        if (typeof list !== 'object' || Array.isArray(list) || Object.keys(list).length < 50) {
            throw new Error('unexpected list');
        }
        await writeFile(join(KIT, 'data/ai-robots.json'), `${JSON.stringify(list, null, 4)}\n`);
        console.log(`${Object.keys(list).length} entries; now run build`);
        return;
    }
    if (command !== 'build' && command !== 'check') {
        throw new Error(`unknown command ${command}`);
    }
    const site = JSON.parse(await readFile(sitePath, 'utf8'));
    const files = outputs(site, await loadLists());
    const stale = [];
    for (const [path, content] of Object.entries(files)) {
        if (command === 'check') {
            const current = await readFile(path, 'utf8').catch(() => null);
            if (current !== content) {
                stale.push(path);
            }
        } else {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content);
            console.log(`wrote ${path}`);
        }
    }
    if (stale.length) {
        console.error(`out of date (run the build): ${stale.join(', ')}`);
        process.exit(1);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
