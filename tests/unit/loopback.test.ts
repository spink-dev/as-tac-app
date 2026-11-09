import { describe, expect, it } from 'vitest';
import { LoopbackBackend, type KeyValue } from '../../src/core/live/loopback';

function memory(): KeyValue {
    const data = new Map<string, string>();
    return { get: (key) => data.get(key) ?? null, set: (key, value) => void data.set(key, value) };
}

/** The local test mode must enforce the same rules as the SQL functions. */
describe('loopback live backend', () => {
    it('validates pushes like the server', async () => {
        const store = memory();
        const owner = new LoopbackBackend(store, 'owner');
        const plan = await owner.createPlan('Test', null, 'Owner');
        const ok = await owner.apply(plan, 'owner', [{ collection: 'teams', entityId: 't1', data: { id: 't1' }, base: 0 }], 'c1');
        expect(ok.result.applied).toHaveLength(1);
        await expect(owner.apply(plan, 'owner', [{ collection: 'teams', entityId: 't2', data: { id: 'other' }, base: 0 }], 'c1')).rejects.toThrow(/mismatch/);
        await expect(owner.apply(plan, 'owner', [{ collection: 'teams', entityId: 'x'.repeat(81), data: { id: 'x'.repeat(81) }, base: 0 }], 'c1')).rejects.toThrow(/entity id/);
        const many = Array.from({ length: 501 }, (_, i) => ({ collection: 'teams' as const, entityId: `t${i}`, data: { id: `t${i}` }, base: 0 }));
        await expect(owner.apply(plan, 'owner', many, 'c1')).rejects.toThrow('batch');
        // A rejected batch changes nothing.
        expect(owner.entities(plan, 0)).toHaveLength(1);
        // meta is keyed by name, not by data.id.
        const meta = await owner.apply(plan, 'owner', [{ collection: 'meta', entityId: 'plan', data: { name: 'Renamed' }, base: 0 }], 'c1');
        expect(meta.result.applied).toHaveLength(1);
    });

    it('limits invites to the creator\'s current role', async () => {
        const store = memory();
        const owner = new LoopbackBackend(store, 'owner');
        const admin = new LoopbackBackend(store, 'admin');
        const viewer = new LoopbackBackend(store, 'viewer');
        const plan = await owner.createPlan('Test', null, 'Owner');
        const adminCode = owner.invite(plan, 'owner', 'admin');
        expect((await admin.redeem(adminCode, 'Admin')).role).toBe('admin');
        // Admins invite viewers only.
        expect(() => admin.invite(plan, 'admin', 'admin')).toThrow('forbidden');
        const viewerCode = admin.invite(plan, 'admin', 'viewer');
        expect((await viewer.redeem(viewerCode, 'Viewer')).role).toBe('viewer');
        await expect(viewer.apply(plan, 'viewer', [{ collection: 'teams', entityId: 't1', data: { id: 't1' }, base: 0 }], 'c3')).rejects.toThrow('forbidden');
        expect(() => viewer.invite(plan, 'viewer', 'viewer')).toThrow('forbidden');
        // An invite whose creator lost the right to issue it no longer works.
        const another = admin.invite(plan, 'admin', 'viewer');
        const state = JSON.parse(store.get(`as-tac-loopback:plan:${plan}`)!);
        state.members.admin.role = 'viewer';
        store.set(`as-tac-loopback:plan:${plan}`, JSON.stringify(state));
        await expect(new LoopbackBackend(store, 'late').redeem(another, 'Late')).rejects.toThrow('invite');
    });
});
