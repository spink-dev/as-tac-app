/** Leader → followers briefing state. Wired to the live transport by the session module. */
export interface BriefingState {
    phaseIndex: number;
    camera: { center: [number, number]; zoom: number; bearing: number } | null;
}

type Sender = (state: BriefingState) => void;
let sender: Sender | null = null;
let current: () => BriefingState | null = () => null;

export function setBriefingSender(fn: Sender | null, read: () => BriefingState | null) {
    sender = fn;
    current = read;
}

export function broadcastBriefing() {
    const state = current();
    if (sender && state) {
        sender(state);
    }
}
