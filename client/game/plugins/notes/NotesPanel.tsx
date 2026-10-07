import { useCallback, useSyncExternalStore } from "react";

import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { NotesPlugin } from "./NotesPlugin";

function NotesIcon({ label }: { label: string }): JSX.Element {
    return (
        <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}>
            <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
            <path d="M9 3.5v17M11.5 8.5h5M11.5 12h5M11.5 15.5h4" />
        </svg>
    );
}

/** The Notes plugin's sidebar panel: one text area, saved as you type. */
export function NotesPanel({ plugin }: { plugin: NotesPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const getSnapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    return (
        <div className="rl-sidebar-panel-content">
            <textarea
                className="rl-sidebar-notes-input"
                value={state.config.notes}
                onChange={(event) => plugin.setConfig({ notes: event.target.value })}
                placeholder="Write your notes here."
                aria-label="Notes"
            />
        </div>
    );
}

/** The Notes button, at RuneLite's priority for it. */
export function createNotesNavigationButton(plugin: NotesPlugin): NavigationButton {
    return NavigationButton.builder()
        .tooltip("Notes")
        .icon(NotesIcon)
        .priority(7)
        .panel(() => <NotesPanel plugin={plugin} />)
        .build();
}
