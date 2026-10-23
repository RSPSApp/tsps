import React, { useCallback, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import type { XPTrackerPlugin } from "./XPTrackerPlugin";

export function XPTrackerPanel({ plugin }: { plugin: XPTrackerPlugin }): JSX.Element {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const snapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, snapshot, snapshot);
    return <div className="rl-sidebar-panel-content">
        <h3>XP Tracker</h3>
        <p>{state.connected ? "Session experience • online time" : "Session paused while logged out"}</p>
        <button onClick={() => plugin.reset()}>Reset all</button>
        {state.rows.length === 0 && <p>Gain experience to start tracking a skill.</p>}
        {state.rows.map((row) => <section key={row.skill} style={{ borderBottom: "1px solid #555", padding: "12px 0" }}>
            <strong>{row.name}</strong>
            <p>{row.gained.toLocaleString()} XP gained<br />{row.perHour.toLocaleString()} XP/hour</p>
            <button aria-label={`Reset ${row.name}`} onClick={() => plugin.reset(row.skill)}>Reset</button>
        </section>)}
    </div>;
}

function XPIcon({ label }: { label: string }): JSX.Element {
    return <svg className="rl-sidebar-icon-svg" viewBox="0 0 24 24" role="img" aria-label={label}><path d="M4 20V12H8V20ZM10 20V8H14V20ZM16 20V3H20V20Z" /></svg>;
}
export function createXPTrackerNavigationButton(plugin: XPTrackerPlugin): NavigationButton {
    return NavigationButton.builder().tooltip("XP Tracker").icon(XPIcon).priority(3).panel(() => <XPTrackerPanel plugin={plugin} />).build();
}
