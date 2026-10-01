// Maintainer-only conversion of the permitted, pinned FieldMaps data snapshot.
// No network or images. Never run against an unreviewed source checkout.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const source = process.argv[2] ?? '../reference-projects/FieldMaps';
const commit = '2998bb6d7413a3e036412fa37443e8eead1238f3';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit
    || execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('Expected clean reviewed FieldMaps commit');
}
const temporary = await mkdtemp(join(tmpdir(), 'ast-fieldmaps-'));
try {
    await mkdir(join(temporary, 'scenarios'));
    await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
    const paths = ['points-of-interest', ...['index', 'mission24', 'dark-emergency', 'operation-tschernobyl', 'light-sim', 'airsoft-days', 'lost-airfield'].map((file) => `scenarios/${file}`)];
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
    await writeFile('src/data/mahlwinkel-fieldmaps.json', JSON.stringify({ source: 'FieldMaps / @rwolffgang', commit, points: POINTS_OF_INTEREST, events }, null, 2) + '\n');
} finally {
    await rm(temporary, { recursive: true, force: true });
}
