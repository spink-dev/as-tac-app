import { create } from 'zustand';

export type DialogName = 'newPlan' | 'areaDownload' | 'import' | 'join' | 'credits' | 'shortcuts' | 'placeImport' | 'share' | 'qrReceive' | 'onboarding' | 'whatsNew';

interface DialogState {
    open: DialogName | null;
    payload: unknown;
    show: (name: DialogName, payload?: unknown) => void;
    hide: () => void;
}

export const useDialogs = create<DialogState>((set) => ({
    open: null,
    payload: null,
    show(name, payload = null) {
        set({ open: name, payload });
    },
    hide() {
        set({ open: null, payload: null });
    },
}));

export function showDialog(name: DialogName, payload?: unknown) {
    useDialogs.getState().show(name, payload);
}
