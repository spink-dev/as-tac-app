import { openTab } from './workspace-helpers';
import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { makeElement } from '../src/features/editor/geometry';

const owner = crypto.randomUUID();
const admin = crypto.randomUUID();
const viewer = crypto.randomUUID();
const outsider = crypto.randomUUID();
let db: PGlite;
async function as(user: string) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec('set role authenticated');
}
async function create() {
    await as(owner);
    const id = crypto.randomUUID();
    await db.query('select public.ast_create_project($1,$2,$3)', [id, 'Gemeinsamer Plan', 'benglen']);
    await db.query('select public.ast_set_member($1,$2,$3)', [id, admin, 'admin']);
    await db.query('select public.ast_set_member($1,$2,$3)', [id, viewer, 'viewer']);
    return id;
}
async function apply(id: string, op: string, changes: unknown[], projectVersion = 1) {
    return db.query<any>('select (public.ast_apply($1,$2,$3,$4)).*', [id, op, projectVersion, JSON.stringify(changes)]);
}
test.beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema auth, public to authenticated;
        grant execute on function auth.uid() to authenticated;`);
    for (const id of [owner, admin, viewer, outsider]) {
        await db.query('insert into auth.users values($1)', [id]);
    }
    await db.exec(readFileSync('supabase/migrations/202610010001_online.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610010002_briefing.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610010003_workspace.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610010004_symbols.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202610010005_zurich.sql', 'utf8'));
});
test.afterAll(async () => {
    await db.close();
});

test('RLS denies outsiders, viewers cannot mutate, only owner manages membership', async () => {
    const id = await create();
    await as(outsider);
    expect((await db.query('select * from public.ast_projects')).rows).toHaveLength(0);
    expect((await db.query('select * from public.ast_memberships')).rows).toHaveLength(0);
    await expect(db.query('select public.ast_set_member($1,$2,$3)', [id, outsider, 'admin'])).rejects.toThrow('forbidden');
    await as(viewer);
    expect((await db.query('select * from public.ast_projects where id=$1',[id])).rows).toHaveLength(1);
    await expect(db.query('update public.ast_projects set server_seq=100 where id=$1',[id])).rejects.toThrow('permission denied');
    await expect(db.query('insert into public.ast_memberships values($1,$2,$3)',[id,outsider,'owner'])).rejects.toThrow('permission denied');
    await expect(apply(id,crypto.randomUUID(),[{ kind:'project', id, value:{ name:'Attack' }, expectedVersion:1 }])).rejects.toThrow('forbidden');
    await as(admin);
    await expect(db.query('select public.ast_set_member($1,$2,$3)', [id, outsider, 'admin'])).rejects.toThrow('forbidden');
    await as(owner);
    await expect(db.query('select public.ast_set_member($1,$2,$3)', [id, owner, null])).rejects.toThrow('invalid_role');
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from public.ast_projects')).rejects.toThrow('permission denied');
    await expect(db.query('select public.ast_create_project($1,$2,$3)', [crypto.randomUUID(),'Attack','benglen'])).rejects.toThrow('permission denied');
});

test('object CAS, idempotency, tombstone versions and durable ordered replay', async () => {
    const id = await create();
    const a = makeElement(id,'point',[[8.63,47.36]],'A');
    const b = makeElement(id,'point',[[8.631,47.36]],'B');
    const op = crypto.randomUUID();
    const changes = [{kind:'element',id:a.id,value:a,expectedVersion:0}];
    const first = await apply(id,op,changes);
    expect(first.rows[0].server_seq).toBe(1);
    expect((await apply(id,op,changes)).rows[0]).toEqual(first.rows[0]);
    await expect(apply(id,op,[{...changes[0],value:{...a,label:'Different'}}])).rejects.toThrow('operation_id_reused');
    await as(admin);
    expect((await apply(id,crypto.randomUUID(),[{kind:'element',id:b.id,value:b,expectedVersion:0}])).rows[0].server_seq).toBe(2);
    await expect(apply(id,crypto.randomUUID(),changes)).rejects.toThrow('version_conflict');
    await apply(id,crypto.randomUUID(),[{kind:'element',id:a.id,value:null,expectedVersion:1}]);
    await expect(apply(id,crypto.randomUUID(),changes)).rejects.toThrow('version_conflict');
    await apply(id,crypto.randomUUID(),[{kind:'element',id:a.id,value:{...a,version:3},expectedVersion:2}]);
    await as(viewer);
    const events = await db.query<any>('select * from public.ast_operations where project_id=$1 and server_seq > 1 order by server_seq',[id]);
    expect(events.rows.map(e => e.server_seq)).toEqual([2,3,4]);
    const snapshot = (await db.query<any>('select * from public.ast_projects where id=$1',[id])).rows[0];
    expect(snapshot.document.elements.find((e: any) => e.id===a.id).version).toBe(3);
    expect(snapshot.versions[`element:${a.id}`]).toBe(3);
    await as(owner);
    await db.query('select public.ast_set_member($1,$2,$3)',[id,admin,null]);
    await as(admin);
    expect((await db.query('select * from public.ast_operations where project_id=$1',[id])).rows).toHaveLength(0);
    await expect(apply(id,op,changes)).rejects.toThrow('forbidden');
});

test('invalid geometry, references and structural conflicts roll back sequence and complete batch', async () => {
    const id = await create();
    const a = makeElement(id,'point',[[8.63,47.36]],'A');
    for (const value of [
        {...a,geometry:{type:'Point',coordinates:[8,91]}},
        {...a,geometry:{type:'Point',coordinates:[8,47,1]}},
        {...a,teamId:crypto.randomUUID()},
        {...a,projectId:crypto.randomUUID()},
        {...a,gpsHistory:[]},
    ]) {
        await expect(apply(id,crypto.randomUUID(),[{kind:'element',id:a.id,value,expectedVersion:0}])).rejects.toThrow();
    }
    const valid = {kind:'element',id:a.id,value:a,expectedVersion:0};
    await expect(apply(id,crypto.randomUUID(),[valid,{kind:'project',id,value:{name:''},expectedVersion:1}])).rejects.toThrow();
    let snapshot = (await db.query<any>('select * from public.ast_projects where id=$1',[id])).rows[0];
    expect(snapshot.server_seq).toBe(0);
    expect(snapshot.document.elements).toHaveLength(0);
    await apply(id,crypto.randomUUID(),[{kind:'project',id,value:{name:'Renamed'},expectedVersion:1}]);
    await expect(apply(id,crypto.randomUUID(),[{kind:'team',id:crypto.randomUUID(),value:null,expectedVersion:0}],1)).rejects.toThrow('version_conflict');
    snapshot = (await db.query<any>('select * from public.ast_projects where id=$1',[id])).rows[0];
    expect(snapshot.server_seq).toBe(1);
    expect(snapshot.document.name).toBe('Renamed');
});


test('full geometry and reference batch validates; referenced deletion and sensor injection are atomic failures', async () => {
    const id = await create();
    const team = { id: crypto.randomUUID(), name: 'Alpha', shortLabel: 'A', colour: '#176b89' };
    const elements = (['point','text','line','freehand','polygon','circle'] as const).map(type => makeElement(id,type,[[8.63,47.36],[8.631,47.36],[8.631,47.361]],type));
    const phase = { id: crypto.randomUUID(), order: 0, title: 'Start', notes: '', camera: {center:[8.63,47.36],zoom:15,bearing:0,pitch:0}, visibleElementIds: elements.map(e => e.id) };
    elements.forEach(e => {
        e.teamId = team.id;
        e.phaseIds = [phase.id];
    });
    await apply(id,crypto.randomUUID(),[
        {kind:'team',id:team.id,value:team,expectedVersion:0},
        {kind:'phase',id:phase.id,value:phase,expectedVersion:0},
        ...elements.map(value => ({kind:'element',id:value.id,value,expectedVersion:0})),
    ]);
    await expect(apply(id,crypto.randomUUID(),[{kind:'team',id:team.id,value:null,expectedVersion:1}],2)).rejects.toThrow('invalid_reference');
    await expect(apply(id,crypto.randomUUID(),[{kind:'element',id:elements[0].id,value:{...elements[0],version:99},expectedVersion:1}],2)).rejects.toThrow('invalid_object_version');
    await expect(apply(id,crypto.randomUUID(),[{kind:'project',id,value:{name:'Changed',gps:{latitude:47}},expectedVersion:2}],2)).rejects.toThrow('invalid_metadata');
    const snapshot = (await db.query<any>('select * from public.ast_projects where id=$1',[id])).rows[0];
    expect(snapshot.server_seq).toBe(1);
    expect(snapshot.document.elements).toHaveLength(6);
    expect(snapshot.document.teams).toHaveLength(1);
});

// Exercise the actual client state machine against the actual SQL functions.
// PGlite serializes one connection; this proves protocol behavior, not socket-level races.
import { OnlineSession, type Draft, type SyncApi, scope } from '../src/core/sync/session';
import type { OnlineProject, OnlineOperation, Role } from '../src/core/sync/client';
let queue = Promise.resolve();
function apiFor(user: string): SyncApi {
    function call<T>(fn: () => Promise<T>): Promise<T> {
        const next = queue.then(async () => {
            await as(user);
            return fn();
        });
        queue = next.then(() => {}, () => {});
        return next;
    }
    return {
        members: (id) => call(async () => (await db.query<{user_id:string;role:Role}>('select user_id,role from public.ast_memberships where project_id=$1', [id])).rows),
        snapshot: (id) => call(async () => {
            const record = (await db.query<OnlineProject>('select id,document,server_seq,versions from public.ast_projects where id=$1', [id])).rows[0];
            if (!record) {
                throw Object.assign(new Error('forbidden'), { code: '42501' });
            }
            return record;
        }),
        apply: (id, op, version, changes) => call(async () => (await apply(id, op, changes, version)).rows[0] as OnlineOperation),
        operation: (id, op) => call(async () => (await db.query<OnlineOperation>('select * from public.ast_operations where project_id=$1 and op_id=$2', [id, op])).rows[0] ?? null),
    };
}
function memoryStore() {
    let value: Draft | null = null;
    return {
        load: async () => structuredClone(value),
        save: async (draft: Draft | null) => {
            value = structuredClone(draft);
        },
    };
}
async function settled(session: OnlineSession) {
    await expect.poll(() => session.getSnapshot().busy).toBe(false);
}
function online(value: boolean) {
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value });
}

test('two editors and a viewer converge; versioned undo never overwrites another editor', async () => {
    online(true);
    const id = await create();
    const a = new OnlineSession(apiFor(owner), id, owner, memoryStore());
    const b = new OnlineSession(apiFor(admin), id, admin, memoryStore());
    const v = new OnlineSession(apiFor(viewer), id, viewer, memoryStore());
    await Promise.all([a.start(), b.start(), v.start()]);
    const pointA = makeElement(id, 'point', [[8.63,47.36]], 'A');
    const pointB = makeElement(id, 'point', [[8.631,47.36]], 'B');
    a.change([{kind:'element', id:pointA.id, value:pointA}]);
    b.change([{kind:'element', id:pointB.id, value:pointB}]);
    await Promise.all([settled(a), settled(b)]);
    await Promise.all([a.refresh(), b.refresh(), v.refresh()]);
    expect(v.getSnapshot().snapshot?.server_seq).toBe(2);
    expect(v.getSnapshot().project?.elements.map(e => e.label).sort()).toEqual(['A','B']);
    expect(() => v.change([{kind:'project',name:'Attack'}])).toThrow();
    a.undo();
    await settled(a);
    expect(a.getSnapshot().project?.elements.map(e => e.label)).toEqual(['B']);
    expect(a.getSnapshot().canRedo).toBe(true);
    a.redo();
    await settled(a);
    expect(a.getSnapshot().project?.elements.find(e => e.id === pointA.id)?.version).toBe(3);
    await b.refresh();
    b.change([{kind:'element',id:pointA.id,value:{...pointA,label:'B edits A',version:4}}]);
    await settled(b);
    await a.refresh();
    expect(a.getSnapshot().canUndo).toBe(false);
    await v.refresh();
    expect(v.getSnapshot().project?.elements.find(e => e.id === pointA.id)?.label).toBe('B edits A');
});

test('same-object conflict survives restart, shows both versions and publishes only explicitly', async () => {
    online(true);
    const id = await create();
    const store = memoryStore();
    const a = new OnlineSession(apiFor(owner), id, owner, memoryStore());
    const b = new OnlineSession(apiFor(admin), id, admin, store);
    await Promise.all([a.start(), b.start()]);
    const point = makeElement(id,'point',[[8.63,47.36]],'Original');
    a.change([{kind:'element',id:point.id,value:point}]);
    await settled(a);
    await b.refresh();
    a.change([{kind:'element',id:point.id,value:{...point,label:'Server',version:2}}]);
    await settled(a);
    b.change([{kind:'element',id:point.id,value:{...point,label:'Mine',version:2}}]);
    await settled(b);
    expect(b.getSnapshot().status).toBe('conflict');
    expect((await store.load())?.project.elements[0].label).toBe('Mine');
    b.dispose();
    const restored = new OnlineSession(apiFor(admin),id,admin,store);
    await restored.start();
    expect(restored.getSnapshot().status).toBe('conflict');
    expect(restored.getSnapshot().snapshot?.document.elements[0].label).toBe('Server');
    const draft = restored.getSnapshot().draft!;
    await restored.resolve(draft.changes.map(scope), restored.getSnapshot().snapshot!.server_seq);
    expect(restored.getSnapshot().status).toBe('live');
    expect(restored.getSnapshot().project?.elements[0]).toMatchObject({label:'Mine',version:3});
    expect(await store.load()).toBeNull();
});

test('lost acknowledgement and sequence gaps recover without duplicate writes; offline draft waits', async () => {
    online(true);
    const id = await create();
    const real = apiFor(owner);
    let calls = 0;
    const unreliable: SyncApi = {...real, apply: async (...args) => {
        calls += 1;
        await real.apply(...args);
        throw new Error('Response lost');
    }};
    const store = memoryStore();
    const a = new OnlineSession(unreliable,id,owner,store);
    await a.start();
    a.change([{kind:'project',name:'Committed despite lost reply'}]);
    await settled(a);
    expect(a.getSnapshot().draft?.sent).toBe(true);
    await a.refresh();
    expect(a.getSnapshot().status).toBe('live');
    expect(a.getSnapshot().snapshot?.server_seq).toBe(1);
    expect(calls).toBe(1);
    online(false);
    a.change([{kind:'project',name:'Offline draft'}]);
    await settled(a);
    online(true);
    await a.refresh();
    expect(calls).toBe(1);
    expect(a.getSnapshot().draft?.sent).toBe(false);
    expect(a.getSnapshot().snapshot?.document.name).toBe('Committed despite lost reply');
    await a.retry();
    await a.refresh();
    expect(a.getSnapshot().project?.name).toBe('Offline draft');
    expect(a.getSnapshot().snapshot?.server_seq).toBe(2);
    expect(calls).toBe(2);
});

test('storage failure sends nothing; revoked membership hides plan and preserves draft', async () => {
    online(true);
    const id = await create();
    const bad = new OnlineSession(apiFor(admin),id,admin, {load:async () => null, save:async () => { throw new Error('quota'); }});
    await bad.start();
    bad.change([{kind:'project',name:'Not sent'}]);
    await settled(bad);
    expect(bad.getSnapshot().status).toBe('storage-error');
    expect((await apiFor(owner).snapshot(id)).server_seq).toBe(0);
    const store = memoryStore();
    const a = new OnlineSession(apiFor(admin),id,admin,store);
    await a.start();
    online(false);
    a.change([{kind:'project',name:'Saved draft'}]);
    await settled(a);
    online(true);
    await as(owner);
    await db.query('select public.ast_set_member($1,$2,$3)',[id,admin,null]);
    await a.refresh();
    expect(a.getSnapshot().status).toBe('denied');
    expect(a.getSnapshot().project).toBeNull();
    expect(a.getSnapshot().role).toBeNull();
    expect((await store.load())?.project.name).toBe('Saved draft');
    expect(() => a.change([{kind:'project',name:'Attack'}])).toThrow();
});

test('configured browser editor uses SQL, viewer receives changes and IndexedDB draft survives reload', async ({ browser }) => {
    test.skip(process.env.AST_ONLINE_UI_TEST !== '1', 'Requires configured production test build');
    const id = await create();
    let network = true;
    async function open(user: string) {
        const context = await browser.newContext({ viewport: {width:393,height:852}, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const api = apiFor(user);
        await context.route('https://as-tac-test.invalid/**', async (route) => {
            if (!network && user === owner) {
                await route.abort();
                return;
            }
            const request = route.request();
            const url = new URL(request.url());
            let data: unknown;
            try {
                if (url.pathname === '/auth/v1/token') {
                    data = { access_token:'test-only-token',refresh_token:'test-only-refresh',token_type:'bearer',expires_in:3600,user:{id:user,email:'test@example.test',aud:'authenticated'} };
                } else if (url.pathname === '/rest/v1/ast_projects') {
                    const record = await api.snapshot(id);
                    data = url.searchParams.has('id') ? record : [record];
                } else if (url.pathname === '/rest/v1/ast_memberships') {
                    data = await api.members(id);
                } else if (url.pathname === '/rest/v1/ast_operations') {
                    const op = await api.operation(id, url.searchParams.get('op_id')!.slice(3));
                    data = op ? [op] : [];
                } else if (url.pathname === '/rest/v1/rpc/ast_briefing' || url.pathname === '/rest/v1/rpc/ast_present') {
                    const body = request.postDataJSON();
                    const result = queue.then(async () => {
                        await as(user);
                        return url.pathname.endsWith('/ast_briefing')
                            ? db.query<any>('select public.ast_briefing($1) as value',[body.p_project])
                            : db.query<any>('select public.ast_present($1,$2,$3,$4,$5) as value',[body.p_project,body.p_session,body.p_action,body.p_phase,JSON.stringify(body.p_camera)]);
                    });
                    queue = result.then(() => {}, () => {});
                    data = (await result).rows[0].value;
                } else if (url.pathname === '/rest/v1/rpc/ast_apply') {
                    const body = request.postDataJSON();
                    data = await api.apply(body.p_project,body.p_op,body.p_project_version,body.p_changes);
                } else {
                    data = null;
                }
                await route.fulfill({json:data ?? null});
            } catch (error) {
                await route.fulfill({status:409,json:{code:(error as any).code,message:(error as Error).message}});
            }
        });
        async function loginOpen() {
            await page.goto('/');
            await openTab(page, 'Projekt');
            await page.getByText('Online-Projekte & Mitglieder',{exact:true}).click();
            await page.getByLabel('E-Mail',{exact:true}).fill('test@example.test');
            await page.getByLabel('Passwort',{exact:true}).fill('test-only-password');
            await page.getByRole('button',{name:'Anmelden',exact:true}).click();
            await page.getByRole('button',{name:'Online-Stand aktualisieren',exact:true}).click();
            await page.getByLabel('Online-Projekt',{exact:true}).selectOption(id);
            await page.getByRole('button',{name:'Gemeinsam auf der Karte öffnen',exact:true}).click();
            await expect(page.locator('.map')).toHaveAttribute('aria-busy','false');
            await openTab(page, 'Projekt');
            await expect(page.getByRole('heading',{name:'Gemeinsamer Plan',exact:true,level:2})).toBeVisible();
            await openTab(page, 'Orientierung');
        }
        await loginOpen();
        return {context,page,errors,loginOpen};
    }
    const a = await open(owner);
    const v = await open(viewer);
    await openTab(v.page, 'Planung');
    await expect(v.page.getByRole('group', { name: 'Zeichenwerkzeuge' })).toHaveCount(0);
    await openTab(v.page, 'Orientierung');
    await openTab(a.page, 'Planung');
    await a.page.getByRole('group',{name:'Zeichenwerkzeuge'}).getByRole('button',{name:'Punkt',exact:true}).click();
    await a.page.locator('.maplibregl-canvas').click({position:{x:100,y:220}});
    await expect(a.page.getByRole('region',{name:'Online-Status',includeHidden:true})).toContainText('Serverstand bestätigt');
    await expect(v.page.locator('.element-list li')).toHaveCount(1);
    network = false;
    await openTab(a.page, 'Projekt');
    await a.page.getByRole('button',{name:'Serverstand prüfen',exact:true}).click();
    await expect(a.page.getByRole('region',{name:'Online-Status',includeHidden:true})).toContainText('Offline');
    await openTab(a.page, 'Planung');
    await a.page.getByLabel('Beschriftung',{exact:true}).fill('Entwurf im Funkloch');
    await openTab(a.page, 'Planung');
    await a.page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await expect(a.page.getByRole('region',{name:'Online-Status',includeHidden:true})).toContainText('Eigener Entwurf');
    const count = (await apiFor(owner).snapshot(id)).server_seq;
    network = true;
    await openTab(a.page, 'Projekt');
    await a.page.getByRole('button',{name:'Serverstand prüfen',exact:true}).click();
    expect((await apiFor(owner).snapshot(id)).server_seq).toBe(count);
    await a.loginOpen();
    await expect(a.page.locator('.element-list')).toContainText('Entwurf im Funkloch');
    await openTab(a.page, 'Projekt');
    await a.page.getByRole('button',{name:'Unveränderte Sendung erneut prüfen',exact:true}).click();
    await expect(v.page.locator('.element-list')).toContainText('Entwurf im Funkloch');
    for (const title of ['Sammeln', 'Vorrücken']) {
        await openTab(a.page, 'Planung');
        await a.page.getByLabel('Neue Phase',{exact:true}).fill(title);
        await openTab(a.page, 'Planung');
        await a.page.getByRole('button',{name:'Phase anlegen',exact:true}).click();
        await expect(a.page.getByRole('region',{name:'Online-Status',includeHidden:true})).toContainText('Serverstand bestätigt');
    }
    await openTab(a.page, 'Briefing');
    await a.page.getByRole('button',{name:'Briefing starten',exact:true}).click();
    // Exclusive presentation is voluntary and does not increment the shared plan sequence.
    const confirmed = (await apiFor(owner).snapshot(id)).server_seq;
    await openTab(a.page, 'Briefing');
    await a.page.getByRole('button',{name:'Briefing leiten',exact:true}).click();
    await expect(a.page.getByText(/Du leitest das Briefing/)).toBeVisible();
    await expect(v.page.getByLabel('Präsentation folgen',{exact:true})).toBeEnabled();
    await expect(v.page.getByLabel('Präsentation folgen',{exact:true})).not.toBeChecked();
    await openTab(v.page, 'Briefing');
    await v.page.getByLabel('Präsentation folgen',{exact:true}).check();
    await expect(v.page.getByLabel('Präsentation folgen',{exact:true})).toBeChecked();
    await expect(v.page.getByRole('region',{name:'Lokales Briefing'})).toContainText('Sammeln');
    await openTab(v.page, 'Briefing');
    await v.page.getByLabel('Präsentation folgen',{exact:true}).uncheck();
    await openTab(a.page, 'Briefing');
    await a.page.getByRole('button',{name:'Nächste Phase',exact:true}).click();
    await expect(a.page.getByRole('region',{name:'Lokales Briefing'})).toContainText('Vorrücken');
    await expect(v.page.getByRole('region',{name:'Lokales Briefing'})).toContainText('Sammeln');
    await openTab(v.page, 'Briefing');
    await v.page.getByLabel('Präsentation folgen',{exact:true}).check();
    await expect(v.page.getByRole('region',{name:'Lokales Briefing'})).toContainText('Vorrücken');
    await openTab(a.page, 'Briefing');
    await a.page.getByRole('button',{name:'Leitung abgeben',exact:true}).click();
    expect((await apiFor(owner).snapshot(id)).server_seq).toBe(confirmed);
    await a.page.screenshot({ path: 'test-results/online-briefing-mobile.png', fullPage: true });
    // Cached snapshots open without authentication or any successful API request.
    network = false;
    await a.page.goto('/');
    await openTab(a.page, 'Projekt');
    await a.page.getByText('Online-Projekte & Mitglieder',{exact:true}).click();
    await a.page.getByText('Gesicherte Online-Projekte ohne Anmeldung öffnen',{exact:true}).click();
    await a.page.getByRole('button',{name:/Offline-Kopie · Stand/}).click();
    await expect(a.page.locator('.element-list')).toContainText('Entwurf im Funkloch');
    await expect(a.page.getByRole('region',{name:'Online-Status',includeHidden:true})).toContainText('Offline-Kopie');
    await openTab(a.page, 'Planung');
    await a.page.locator('.element-list button').first().click();
    await openTab(a.page, 'Planung');
    await a.page.getByLabel('Beschriftung',{exact:true}).fill('Offline ohne Anmeldung');
    await openTab(a.page, 'Planung');
    await a.page.getByRole('button',{name:'Übernehmen',exact:true}).click();
    await expect(a.page.locator('.element-list')).toContainText('Offline ohne Anmeldung');
    await openTab(a.page, 'Projekt');
    await expect(a.page.getByRole('button',{name:'Unveränderte Sendung erneut prüfen',exact:true})).toBeDisabled();
    expect((await apiFor(owner).snapshot(id)).server_seq).toBe(confirmed);
    await a.page.screenshot({ path: 'test-results/online-draft-mobile.png', fullPage: true });
    expect(a.errors).toEqual([]);
    expect(v.errors).toEqual([]);
    await a.context.close();
    await v.context.close();
});

test('briefing lease is exclusive, rejects viewers and expires without modifying plan', async () => {
    const id = await create();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const camera = {center:[8.63,47.36],zoom:15,bearing:0,pitch:0};
    const present = (session: string, action: string, position: unknown = camera) => db.query<any>('select public.ast_present($1,$2,$3,null,$4) as value',[id,session,action,JSON.stringify(position)]);
    await as(viewer);
    await expect(present(first,'claim')).rejects.toThrow('forbidden');
    await expect(db.query('select * from public.ast_briefings')).rejects.toThrow('permission denied');
    await as(owner);
    expect((await present(first,'claim')).rows[0].value).toMatchObject({presenterId:owner,sessionId:first,camera});
    await as(admin);
    await expect(present(second,'claim')).rejects.toThrow('already_presenting');
    await expect(present(second,'update')).rejects.toThrow('presentation_expired');
    await as(owner);
    await expect(present(first,'update',{...camera,center:[8,91]})).rejects.toThrow('invalid_camera');
    await expect(present(first,'update',{...camera,gps:{}})).rejects.toThrow('invalid_camera');
    await present(first,'update',{...camera,zoom:16});
    await as(viewer);
    expect((await db.query<any>('select public.ast_briefing($1) as value',[id])).rows[0].value.camera.zoom).toBe(16);
    await as(outsider);
    await expect(db.query('select public.ast_briefing($1)',[id])).rejects.toThrow('forbidden');
    await db.exec('reset role');
    await db.query("update public.ast_briefings set expires_at=clock_timestamp()-interval '1 second' where project_id=$1",[id]);
    await as(viewer);
    expect((await db.query<any>('select public.ast_briefing($1) as value',[id])).rows[0].value).toBeNull();
    await as(admin);
    await present(second,'claim');
    await as(owner);
    await expect(present(first,'update')).rejects.toThrow('presentation_expired');
    await db.query('select public.ast_set_member($1,$2,$3)',[id,admin,'viewer']);
    expect((await db.query<any>('select public.ast_briefing($1) as value',[id])).rows[0].value).toBeNull();
    await present(first,'claim');
    await present(first,'release');
    expect((await db.query<any>('select public.ast_briefing($1) as value',[id])).rows[0].value).toBeNull();
    const snapshot = (await db.query<any>('select document,server_seq from public.ast_projects where id=$1',[id])).rows[0];
    expect(snapshot.server_seq).toBe(0);
    expect(snapshot.document.phases).toEqual([]);
});


test('form edit keeps its original base during refresh and offline draft accumulates atomic actions', async () => {
    online(true);
    const id = await create();
    const a = new OnlineSession(apiFor(owner),id,owner,memoryStore());
    const b = new OnlineSession(apiFor(admin),id,admin,memoryStore());
    await Promise.all([a.start(),b.start()]);
    const point = makeElement(id,'point',[[8.63,47.36]],'Initial');
    a.change([{kind:'element',id:point.id,value:point}]);
    await settled(a);
    await b.refresh();
    b.hold();
    a.change([{kind:'element',id:point.id,value:{...point,version:2,label:'Remote'}}]);
    await settled(a);
    await b.refresh();
    expect(b.getSnapshot().project?.elements[0].label).toBe('Initial');
    expect(b.getSnapshot().snapshot?.document.elements[0].label).toBe('Remote');
    b.change([{kind:'element',id:point.id,value:{...point,version:2,label:'Typed before refresh'}}]);
    await settled(b);
    expect(b.getSnapshot().status).toBe('conflict');
    online(false);
    a.change([{kind:'element',id:point.id,value:{...point,version:3,label:'Draft 1',teamId:undefined}}]);
    await settled(a);
    const extra = makeElement(id,'point',[[8.631,47.36]],'Draft 2');
    a.change([{kind:'element',id:extra.id,value:extra}]);
    await settled(a);
    expect(a.getSnapshot().draft?.changes).toHaveLength(2);
    online(true);
    await a.retry();
    expect(a.getSnapshot().status).toBe('live');
    expect(a.getSnapshot().project?.elements.map(e => e.label).sort()).toEqual(['Draft 1','Draft 2']);
});


test('successive online undo/redo preserves causal versions and stops at intervening remote work', async () => {
    online(true);
    const id = await create();
    const a = new OnlineSession(apiFor(owner),id,owner,memoryStore());
    await a.start();
    const p = makeElement(id,'point',[[8.63,47.36]],'One');
    a.change([{kind:'element',id:p.id,value:p}]);
    await settled(a);
    a.change([{kind:'element',id:p.id,value:{...p,version:2,label:'Two'}}]);
    await settled(a);
    a.undo();
    await settled(a);
    expect(a.getSnapshot().canUndo).toBe(true);
    a.undo();
    await settled(a);
    expect(a.getSnapshot().project?.elements).toHaveLength(0);
    a.redo();
    await settled(a);
    expect(a.getSnapshot().canRedo).toBe(true);
    a.redo();
    await settled(a);
    expect(a.getSnapshot().project?.elements[0].label).toBe('Two');
    const b = new OnlineSession(apiFor(admin),id,admin,memoryStore());
    await b.start();
    b.change([{kind:'element',id:p.id,value:{...b.getSnapshot().project!.elements[0],label:'Remote'}}]);
    await settled(b);
    await a.refresh();
    a.change([{kind:'element',id:p.id,value:{...a.getSnapshot().project!.elements[0],label:'After remote'}}]);
    await settled(a);
    a.undo();
    await settled(a);
    expect(a.getSnapshot().project?.elements[0].label).toBe('Remote');
    expect(a.getSnapshot().canUndo).toBe(false);
});

test('format 2 layers validate atomically, root-only catalog editions are immutable and public-readable', async () => {
    const id = await create();
    const layer = { id: crypto.randomUUID(), name: 'Zonen', opacity: 0.4, locked: true };
    const workspace = { layers: [layer], siteId: 'benglen', eventId: 'exercise', edition: '1', source: 'Eigene Erfassung' };
    const element = { ...makeElement(id, 'point', [[8.63, 47.36]], 'Eingang'), layerId: layer.id, sourceId: 'benglen:entrance' };
    await apply(id, crypto.randomUUID(), [{ kind: 'project', id, value: { schemaVersion: 2, workspace }, expectedVersion: 1 }, { kind: 'element', id: element.id, value: element, expectedVersion: 0 }]);
    await expect(apply(id, crypto.randomUUID(), [{ kind: 'project', id, value: { workspace: { ...workspace, layers: [] } }, expectedVersion: 2 }], 2)).rejects.toThrow('invalid_reference');
    const document = (await db.query<any>('select document from public.ast_projects where id=$1', [id])).rows[0].document;
    const map = { ...JSON.parse(readFileSync('public/maps/benglen.json', 'utf8')), format: 'as-tac-map', formatVersion: 1, data: JSON.parse(readFileSync('public/maps/benglen.geojson', 'utf8')) };
    const release = crypto.randomUUID();
    await expect(db.query('select public.ast_publish($1,$2,$3)', [release, document, map])).rejects.toThrow('forbidden');
    await as(admin);
    await expect(db.query('select public.ast_publish($1,$2,$3)', [release, document, map])).rejects.toThrow('forbidden');
    await expect(db.query('insert into ast_private.roots values($1)', [admin])).rejects.toThrow('permission denied');
    await db.exec('reset role');
    await db.query('insert into ast_private.roots values($1)', [owner]);
    await as(owner);
    await db.query('select public.ast_publish($1,$2,$3)', [release, document, map]);
    await expect(db.query('select public.ast_publish($1,$2,$3)', [crypto.randomUUID(), document, map])).rejects.toThrow('duplicate key');
    await db.exec('reset role; set role anon');
    expect((await db.query<any>('select public.ast_catalog() as catalog')).rows[0].catalog[0].id).toBe(release);
    const bundle = (await db.query<any>('select public.ast_catalog_package($1) as bundle', [release])).rows[0].bundle;
    expect(bundle.project.workspace).toEqual(workspace);
    expect(bundle.map.sha256).toBe(map.sha256);
    await expect(db.query('update ast_private.catalog set title=$1', ['Attack'])).rejects.toThrow('permission denied');
    await db.exec('reset role');
    await db.query('delete from ast_private.roots where user_id=$1', [owner]);
    await as(owner);
    await expect(db.query('select public.ast_publish($1,$2,$3)', [crypto.randomUUID(), { ...document, workspace: { ...workspace, edition: '2' } }, map])).rejects.toThrow('forbidden');
});

test('briefing rejects out-of-range zoom and malformed center arrays', async () => {
    const id = await create();
    for (const camera of [{ center: [8, 47], zoom: 100, bearing: 0, pitch: 0 }, { center: [8, 47, 1], zoom: 15, bearing: 0, pitch: 0 }]) {
        await expect(db.query('select public.ast_present($1,$2,$3,$4,$5)', [id, crypto.randomUUID(), 'claim', null, camera])).rejects.toThrow('invalid_camera');
    }
});

test('optional map symbols roundtrip and invalid style values roll back atomically', async () => {
    const id = await create();
    const element = makeElement(id, 'polygon', [[8.63, 47.36], [8.631, 47.36], [8.631, 47.361]], 'Safe');
    element.style = { ...element.style, symbol: 'shield', pattern: 'hatch', labelMode: 'always' };
    await apply(id, crypto.randomUUID(), [{ kind: 'element', id: element.id, value: element, expectedVersion: 0 }]);
    const snapshot = (await db.query<any>('select document from public.ast_projects where id=$1', [id])).rows[0].document;
    expect(snapshot.elements[0].style).toEqual(element.style);
    await expect(apply(id, crypto.randomUUID(), [{ kind: 'element', id: element.id, value: { ...element, version: 2, style: { ...element.style, pattern: 'url' } }, expectedVersion: 1 }])).rejects.toThrow();
});

test('Zurich is an accepted prepared collaborative map', async () => {
    await as(owner);
    const id = crypto.randomUUID();
    await db.query('select public.ast_create_project($1,$2,$3)', [id, 'Zürich Feldtest', 'zurich']);
    const { rows } = await db.query<any>('select document from public.ast_projects where id=$1', [id]);
    expect(rows[0].document.mapPackageId).toBe('zurich');
});
