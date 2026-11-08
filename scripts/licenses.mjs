// Writes public/licenses/dependencies.txt: every package that ends up in the shipped app.
// Runtime packages come from package-lock.json (non-dev entries, nested versions included);
// build-injected code (the Workbox service-worker runtime) and copied data are listed explicitly.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));

/** Packages bundled into the build although they are dev dependencies (vite-plugin-pwa). */
const BUILD_INJECTED = ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-window'];

/** Data copied into public/ from packages that are not installed. */
const COPIED = [
    {
        name: 'smp-noto-glyphs',
        version: '2.0.0',
        license: 'MIT (Paket); Glyphen aus Noto Sans unter SIL OFL 1.1 — siehe OFL-1.1.txt',
        text: 'Quelle: https://github.com/digidem/styled-map-package (npm smp-noto-glyphs 2.0.0). Das Paket enthält keine eigene Lizenzdatei; laut README: «MIT. The bundled glyph data is derived from Noto Sans fonts, licensed under the SIL Open Font License 1.1.»',
    },
];

function describe(dir) {
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.|-|$)/i.test(entry));
    return {
        version: meta.version,
        license: typeof meta.license === 'string' ? meta.license : meta.license?.type ?? 'siehe Paket',
        text: file ? readFileSync(join(dir, file), 'utf8').trim() : '',
    };
}

const entries = new Map();
for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/') || info.dev || info.devOptional) {
        continue;
    }
    const dir = join(root, path);
    if (!existsSync(join(dir, 'package.json'))) {
        // Optional platform binaries not installed on this machine.
        continue;
    }
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const described = describe(dir);
    entries.set(`${name}@${described.version}`, { name, ...described });
}
for (const name of BUILD_INJECTED) {
    const dir = join(root, 'node_modules', name);
    if (existsSync(join(dir, 'package.json'))) {
        const described = describe(dir);
        entries.set(`${name}@${described.version}`, { name, ...described });
    }
}
for (const copied of COPIED) {
    entries.set(`${copied.name}@${copied.version}`, copied);
}

const out = [`AS-TAC ${pkg.version} – Lizenzen der ausgelieferten Abhängigkeiten`, '', 'Kartenschrift: siehe OFL-1.1.txt. Kartendaten: siehe ODbL-1.0.txt.', ''];
const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
for (const info of sorted) {
    out.push('='.repeat(72), `${info.name} ${info.version} — ${info.license}`, '', info.text || '(Lizenztext liegt dem Paket nicht bei; Lizenzangabe siehe oben.)', '');
}
writeFileSync(join(root, 'public/licenses/dependencies.txt'), `${out.join('\n')}\n`);
console.log(`${sorted.length} packages`);
