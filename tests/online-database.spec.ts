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
