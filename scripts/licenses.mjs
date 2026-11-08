// Writes public/licenses/dependencies.txt from the installed runtime dependencies (direct and transitive).
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const seen = new Map();
const queue = Object.keys(pkg.dependencies ?? {});
while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) {
        continue;
    }
    const dir = join(root, 'node_modules', name);
    if (!existsSync(join(dir, 'package.json'))) {
        continue;
    }
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry));
    seen.set(name, { version: meta.version, license: typeof meta.license === 'string' ? meta.license : meta.license?.type ?? 'siehe Paket', text: file ? readFileSync(join(dir, file), 'utf8').trim() : '' });
    queue.push(...Object.keys(meta.dependencies ?? {}));
}
const out = [`AS-TAC ${pkg.version} – Lizenzen der Laufzeit-Abhängigkeiten`, ''];
for (const [name, info] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`${'='.repeat(72)}`, `${name} ${info.version} — ${info.license}`, '', info.text || '(Lizenztext liegt dem Paket nicht bei; Lizenzangabe siehe oben.)', '');
}
writeFileSync(join(root, 'public/licenses/dependencies.txt'), `${out.join('\n')}\n`);
console.log(`${seen.size} packages`);
