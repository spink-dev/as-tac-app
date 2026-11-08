import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

/** Runs the real migration under PGlite with Supabase's auth.uid() stubbed from a session setting. */
const owner = crypto.randomUUID();
const admin = crypto.randomUUID();
const viewer = crypto.randomUUID();
const outsider = crypto.randomUUID();
let db: PGlite;

async function as(user: string | null) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
    await db.exec('set role authenticated');
}

async function push(plan: string, ops: unknown[]) {
    const result = await db.query<{ r: { applied: { entityId: string; version: number; seq: number }[]; conflicts: { entityId: string; version: number; data: unknown }[] } }>('select public.live_push($1, $2, $3) as r', [plan, JSON.stringify(ops), 'client-a']);
    return result.rows[0].r;
}

async function newPlan() {
    await as(owner);
    const plan = (await db.query<{ id: string }>("select public.live_create_plan('Zug Alpha', 'mahlwinkel', 'Sam') as id")).rows[0].id;
    const adminCode = (await db.query<{ c: string }>("select public.live_create_invite($1, 'admin') as c", [plan])).rows[0].c;
    const viewerCode = (await db.query<{ c: string }>("select public.live_create_invite($1, 'viewer') as c", [plan])).rows[0].c;
    await as(admin);
    await db.query("select public.live_redeem_invite($1, 'Admin')", [adminCode]);
    await as(viewer);
    await db.query("select public.live_redeem_invite($1, 'Zuschauer')", [viewerCode.toLowerCase()]);
    return { plan, adminCode, viewerCode };
}

beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
        grant usage on schema auth, public to authenticated, anon;
        grant execute on function auth.uid() to authenticated, anon;`);
    for (const id of [owner, admin, viewer, outsider]) {
        await db.query('insert into auth.users values ($1)', [id]);
    }
    await db.exec(readFileSync('supabase/migrations/20261108000001_live.sql', 'utf8'));
}, 60000);

afterAll(async () => {
    await db?.close();
});

describe('live database', () => {
    it('lets members read, admins write and keeps viewers and outsiders out', async () => {
        const { plan } = await newPlan();
        await as(admin);
        const first = await push(plan, [{ collection: 'elements', entityId: 'el_1', data: { kind: 'marker', id: 'el_1' }, base: 0 }]);
        expect(first.applied).toHaveLength(1);
        expect(first.conflicts).toHaveLength(0);

        await as(viewer);
        expect((await db.query('select * from public.live_entities where plan_id = $1', [plan])).rows).toHaveLength(1);
        await expect(push(plan, [{ collection: 'elements', entityId: 'el_2', data: {}, base: 0 }])).rejects.toThrow('forbidden');
        await expect(db.query("insert into public.live_entities (plan_id, collection, entity_id, version, seq) values ($1, 'elements', 'x', 1, 99)", [plan])).rejects.toThrow('permission denied');
        await expect(db.query("update public.live_members set role = 'owner' where plan_id = $1", [plan])).rejects.toThrow('permission denied');
        await expect(db.query('select public.live_create_invite($1, $2)', [plan, 'admin'])).rejects.toThrow('forbidden');
        await expect(db.query('select public.live_chat_send($1, $2)', [plan, 'hi'])).rejects.toThrow('forbidden');

        await as(outsider);
        expect((await db.query('select * from public.live_entities where plan_id = $1', [plan])).rows).toHaveLength(0);
        expect((await db.query('select * from public.live_plans')).rows).toHaveLength(0);
        await expect(push(plan, [])).rejects.toThrow('forbidden');
        await expect(db.query('select * from public.live_invites')).rejects.toThrow('permission denied');

        await as(null);
        await expect(db.query("select public.live_create_plan('x', null, null)")).rejects.toThrow('unauthenticated');
    });

    it('returns a conflict instead of overwriting a newer version', async () => {
        const { plan } = await newPlan();
        await as(owner);
        await push(plan, [{ collection: 'teams', entityId: 'team_a', data: { name: 'A' }, base: 0 }]);
        const ok = await push(plan, [{ collection: 'teams', entityId: 'team_a', data: { name: 'A1' }, base: 1 }]);
        expect(ok.applied[0].version).toBe(2);
        await as(admin);
        const stale = await push(plan, [{ collection: 'teams', entityId: 'team_a', data: { name: 'Admin edit' }, base: 1 }]);
        expect(stale.applied).toHaveLength(0);
        expect(stale.conflicts[0]).toMatchObject({ entityId: 'team_a', version: 2, data: { name: 'A1' } });
        // Deletes leave a tombstone peers can see by sequence.
        const del = await push(plan, [{ collection: 'teams', entityId: 'team_a', data: null, base: 2 }]);
        expect(del.applied[0].version).toBe(3);
        const row = (await db.query<{ data: unknown; seq: number }>("select data, seq from public.live_entities where plan_id = $1 and entity_id = 'team_a'", [plan])).rows[0];
        expect(row.data).toBeNull();
    });

    it('keeps the admin chat away from viewers and invites from lowering roles', async () => {
        const { plan, viewerCode } = await newPlan();
        await as(admin);
        await db.query('select public.live_chat_send($1, $2)', [plan, 'Zug 2 rückt vor']);
        expect((await db.query('select body from public.live_chat where plan_id = $1', [plan])).rows).toHaveLength(1);
        await as(viewer);
        expect((await db.query('select body from public.live_chat where plan_id = $1', [plan])).rows).toHaveLength(0);
        await as(admin);
        const redeemed = (await db.query<{ r: { role: string } }>("select public.live_redeem_invite($1, 'x') as r", [viewerCode])).rows[0].r;
        expect(redeemed.role).toBe('admin');
        await expect(db.query('select public.live_set_role($1, $2, $3)', [plan, viewer, 'admin'])).rejects.toThrow('forbidden');
        await as(owner);
        await db.query('select public.live_set_role($1, $2, $3)', [plan, viewer, 'admin']);
        await expect(db.query('select public.live_set_role($1, $2, $3)', [plan, owner, 'viewer'])).rejects.toThrow('role');
        await expect(db.query('select public.live_remove_member($1, $2)', [plan, owner])).rejects.toThrow('owner');
    });

    it('rejects malformed entities and expired codes', async () => {
        const { plan } = await newPlan();
        await as(owner);
        await expect(push(plan, [{ collection: 'secrets', entityId: 'x', data: {}, base: 0 }])).rejects.toThrow();
        await expect(push(plan, [{ collection: 'elements', entityId: '../../x', data: {}, base: 0 }])).rejects.toThrow();
        await expect(push(plan, [{ collection: 'elements', entityId: 'x', data: 'string', base: 0 }])).rejects.toThrow();
        await as(outsider);
        await expect(db.query("select public.live_redeem_invite('ZZZZZZZZ', 'x')")).rejects.toThrow('invite');
        expect((await db.query<{ t: string | null }>("select public.live_topic_role('plan:not-a-uuid') as t")).rows[0].t).toBeNull();
        expect((await db.query<{ t: string | null }>('select public.live_topic_role($1) as t', [`plan:${plan}`])).rows[0].t).toBeNull();
    });
});
