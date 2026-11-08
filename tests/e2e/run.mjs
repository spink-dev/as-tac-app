// Runs every browser scenario against a running preview (npm run preview → :4000) and fails on any failed check.
import { spawnSync } from 'node:child_process';

const scenarios = ['smoke', 'tools', 'panels', 'images', 'field', 'share', 'live', 'live-weak', 'live-media', 'update'];
let failed = 0;
for (const name of scenarios) {
    const started = Date.now();
    const run = spawnSync(process.execPath, [`tests/e2e/${name}.mjs`], { encoding: 'utf8', env: process.env, timeout: 300000 });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const ok = run.status === 0 && !/check failed|^FAIL|Error:/m.test(output) && /no page errors/.test(output);
    failed += ok ? 0 : 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    if (!ok) {
        console.log(output.split('\n').slice(-25).join('\n'));
    }
}
process.exit(failed ? 1 : 0);
