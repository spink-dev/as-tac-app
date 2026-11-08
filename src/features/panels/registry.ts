import type { ComponentType } from 'react';
import type { PanelId } from '../../core/store/ui';
import type { StringKey } from '../../i18n';

/** Panels contributed by feature modules (phases, maps, share, live). */
export const PANEL_EXTENSIONS: { id: PanelId; label: StringKey; Component: ComponentType }[] = [];

export function registerPanel(id: PanelId, label: StringKey, Component: ComponentType) {
    if (!PANEL_EXTENSIONS.some((panel) => panel.id === id)) {
        PANEL_EXTENSIONS.push({ id, label, Component });
    }
}
