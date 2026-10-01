// Maintainer-only conversion of the permitted, pinned FieldMaps data snapshot.
// No network or images. Never run against an unreviewed source checkout.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const check = process.argv.includes('--check');
async function output(path, value) {
    const content = JSON.stringify(value, null, 2) + '\n';
    if (check) {
        if (await readFile(path, 'utf8') !== content) {
            throw new Error(`Snapshot differs: ${path}`);
        }
    } else {
        await writeFile(path, content);
    }
}
const source = process.argv.slice(2).find((arg) => arg !== '--check') ?? '../reference-projects/FieldMaps';
const commit = '2998bb6d7413a3e036412fa37443e8eead1238f3';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit
    || execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('Expected clean reviewed FieldMaps commit');
}
const temporary = await mkdtemp(join(tmpdir(), 'ast-fieldmaps-'));
try {
    await mkdir(join(temporary, 'scenarios'));
    await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
    const paths = ['transform', 'points-of-interest', ...['index', 'mission24', 'dark-emergency', 'operation-tschernobyl', 'light-sim', 'airsoft-days', 'lost-airfield'].map((file) => `scenarios/${file}`)];
    for (const file of paths) {
        const code = await readFile(`${source}/src/${file}.ts`, 'utf8');
        const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
        await writeFile(join(temporary, `${file}.js`), output);
    }
    const { POINTS_OF_INTEREST } = await import(pathToFileURL(join(temporary, 'points-of-interest.js')));
    const { SCENARIOS } = await import(pathToFileURL(join(temporary, 'scenarios/index.js')));
    const events = SCENARIOS.map(({ id, name, poiNames, playArea, zones = [], headquarters = [], lines = [] }) => ({
        id, name, poiNames, playArea, zones, headquarters: headquarters.map(({ logo, ...point }) => point), lines,
    }));
    await output('src/data/mahlwinkel-fieldmaps.json', { source: 'FieldMaps / @rwolffgang', commit, points: POINTS_OF_INTEREST, events });
    const trace = JSON.parse(await readFile('scripts/data/dark-emergency-trace.json', 'utf8'));
    const hash = createHash('sha256').update(await readFile(`${source}/${trace.image}`)).digest('hex');
    if (hash !== trace.sha256) {
        throw new Error('Tactical reference image changed');
    }
    const { solveTransform } = await import(pathToFileURL(join(temporary, 'transform.js')));
    const controlPoints = trace.controlPoints.map((pixel) => {
        const point = POINTS_OF_INTEREST.find((item) => item.id === pixel.id);
        if (!point) {
            throw new Error(`Missing control point: ${pixel.id}`);
        }
        return { ...point, ...pixel };
    });
    const transform = solveTransform(controlPoints);
    if (transform.rmsMeters > 10) {
        throw new Error(`Calibration residual too high: ${transform.rmsMeters} m`);
    }
    const coordinates = (pixels) => pixels.map(([x, y]) => {
        const { lat, lng } = transform.toLatLng(x, y);
        return [Number(lat.toFixed(7)), Number(lng.toFixed(7))];
    });
    await output('src/data/dark-emergency-correction.json', {
        edition: `${trace.edition}-astac-r2`, image: trace.image, imageSha256: hash,
        calibrationRmsMeters: Number(transform.rmsMeters.toFixed(2)),
        playArea: coordinates(trace.playArea),
        zones: trace.zones.map((zone) => ({ ...zone, color: '#e8c24d', points: coordinates(zone.points) })),
    });
    console.log(`FieldMaps snapshot ${check ? 'verified' : 'written'}; DE tracing RMS ${transform.rmsMeters.toFixed(2)} m (not boundary accuracy).`);
} finally {
    await rm(temporary, { recursive: true, force: true });
}
