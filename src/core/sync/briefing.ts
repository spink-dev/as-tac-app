import { useEffect, useRef, useState } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import type { Phase } from '../projects/model';
import type { OnlineApi } from './client';
import { captureCamera } from '../../features/briefing/ManagementPanel';
export interface Presentation {
    presenterId: string;
    sessionId: string;
    phaseId: string | null;
    camera: Phase['camera'];
    remainingMs: number;
}
export function usePresentation(api: OnlineApi, projectId: string, userId: string, map: LibreMap | null, phase: Phase | null, canPresent: boolean, pauseGps: () => void, enabled = true) {
    const [sessionId] = useState(() => crypto.randomUUID());
    const [state, setState] = useState<Presentation | null>(null);
    const [following, setFollowing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const latest = useRef({ map, phase, following, canPresent, state });
    latest.current = { map, phase, following, canPresent, state };
    const alive = useRef(true);
    const request = useRef(false);
    const generation = useRef(0);
    const expiry = useRef(0);
    const isLeader = state?.sessionId === sessionId && state.presenterId === userId;
    const receive = (value: Presentation | null, started: number) => {
        if (!alive.current) {
            return;
        }
        // Monotonic local deadline accounts conservatively for response transit time.
        expiry.current = started + (value?.remainingMs ?? 0);
        if (!value || expiry.current <= performance.now()) {
            setState(null);
            setFollowing(false);
            return;
        }
        setState(value);
        if (latest.current.following && value.sessionId !== sessionId && value.camera) {
            pauseGps();
            latest.current.map?.jumpTo(value.camera);
        }
    };
    const fail = () => {
        if (alive.current) {
            setState(null);
            setFollowing(false);
            setError('Briefing-Verbindung unterbrochen oder Leitung nicht verfügbar. Folgen bei Bedarf erneut einschalten.');
        }
    };
    async function action(kind: 'claim' | 'update' | 'release') {
        if (request.current || !latest.current.canPresent) {
            return;
        }
        request.current = true;
        generation.current += 1;
        setBusy(true);
        const started = performance.now();
        try {
            const value = await api.present(projectId, sessionId, kind, latest.current.phase?.id ?? null, captureCamera(latest.current.map));
            receive(value, started);
            if (alive.current) {
                setError('');
            }
        } catch {
            fail();
        } finally {
            request.current = false;
            if (alive.current) {
                setBusy(false);
            }
        }
    }
    useEffect(() => {
        if (!enabled) {
            return;
        }
        alive.current = true;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            if (request.current) {
                timer = setTimeout(tick, 500);
                return;
            }
            const current = latest.current;
            if (current.state?.sessionId === sessionId && current.canPresent) {
                await action('update');
            } else {
                const started = performance.now();
                const gen = generation.current;
                try {
                    const value = await api.briefing(projectId);
                    if (!stopped && gen === generation.current) {
                        receive(value, started);
                    }
                } catch {
                    if (!stopped && gen === generation.current) {
                        fail();
                    }
                }
            }
            if (!stopped) {
                timer = setTimeout(tick, 1500);
            }
        };
        void tick();
        const expire = setInterval(() => {
            if (expiry.current && performance.now() >= expiry.current) {
                setState(null);
                setFollowing(false);
            }
        }, 250);
        return () => {
            stopped = true;
            alive.current = false;
            clearTimeout(timer);
            clearInterval(expire);
            // No implicit takeover/reconnect; server lease expires within 20 seconds.
        };
    }, [api, projectId, sessionId, enabled]);
    useEffect(() => {
        if (!canPresent && isLeader) {
            setState(null);
            setFollowing(false);
        }
    }, [canPresent, isLeader]);
    return { state, isLeader, following, busy, error, claim: () => action('claim'), release: () => action('release'), follow: (value: boolean) => {
        setFollowing(value);
        if (value && state?.camera) {
            pauseGps();
            map?.jumpTo(state.camera);
        }
    } };
}
