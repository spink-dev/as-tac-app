import { deflateSync } from 'fflate';
import type { Project } from '../model/schema';
import { migrateProject } from './astac';
import { inflateCapped } from './zip';

/**
 * Small plans travel inside a link (`#plan=…`, deflate + base64url) so a QR code can carry them.
 * The fragment never reaches a server. Image maps and logos can't fit and are left out.
 */
export const LINK_PREFIX = '#plan=';
/** Larger QR codes get hard to scan from a phone screen. */
export const MAX_LINK_PAYLOAD = 1800;
const MAX_INFLATED = 2 * 1024 * 1024;

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        throw new Error('link-invalid');
    }
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

/** The plan without anything that needs binary assets or is device-local. */
export function linkablePlan(project: Project): Project {
    return {
        ...project,
        images: [],
        tracks: [],
        teams: project.teams.map((team) => {
            const copy = { ...team, displayMode: team.displayMode === 'logo' ? 'icon' as const : team.displayMode };
            delete copy.logoAsset;
            return copy;
        }),
        elements: project.elements.map((element) => {
            const copy = { ...element };
            delete copy.attachments;
            delete copy.anchorImageId;
            return copy;
        }),
    };
}

/** Returns the link, or `null` when the plan is too large for a scannable QR code. */
export function encodePlanLink(project: Project, base: string): string | null {
    const json = new TextEncoder().encode(JSON.stringify(linkablePlan(project)));
    const payload = toBase64Url(deflateSync(json, { level: 9 }));
    return payload.length <= MAX_LINK_PAYLOAD ? `${base}${LINK_PREFIX}${payload}` : null;
}

/** Decode a `#plan=` fragment; inflation is capped (untrusted input). */
export async function decodePlanLink(hash: string): Promise<Project> {
    if (!hash.startsWith(LINK_PREFIX) || hash.length > LINK_PREFIX.length + 8000) {
        throw new Error('link-invalid');
    }
    const compressed = fromBase64Url(hash.slice(LINK_PREFIX.length));
    let bytes: Uint8Array;
    try {
        bytes = await inflateCapped(compressed, MAX_INFLATED);
    } catch {
        throw new Error('link-invalid');
    }
    return migrateProject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
