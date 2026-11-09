/**
 * Hand a file to the user: the OS share sheet where files can be shared (AirDrop, Quick Share,
 * messengers), otherwise a regular download. Returns how it was delivered.
 */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title });
            return 'shared';
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return 'cancelled';
            }
        }
    }
    saveFile(blob, filename);
    return 'downloaded';
}

export function saveFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

let abandon: (() => void) | null = null;

/**
 * Open the system file picker. The input is attached while open: detached inputs are ignored
 * by some browsers. Where the picker has no `cancel` event, a cancelled pick stays pending
 * until the next pick, which settles it (no late `change` is ever dropped).
 */
export function pickFile(accept: string): Promise<File | null> {
    abandon?.();
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.setAttribute('aria-hidden', 'true');
        let settled = false;
        const done = (file: File | null) => {
            if (settled) {
                return;
            }
            settled = true;
            if (abandon === cancel) {
                abandon = null;
            }
            input.remove();
            resolve(file);
        };
        const cancel = () => done(null);
        abandon = cancel;
        input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', cancel, { once: true });
        document.body.append(input);
        input.click();
    });
}

export function isIos(): boolean {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
