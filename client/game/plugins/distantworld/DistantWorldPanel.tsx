import { useCallback, useSyncExternalStore } from "react";
import { NavigationButton } from "@runelite/client/ui/NavigationButton";
import { imageIcon, runeliteImage } from "@runelite/client/ui/runeliteImages";
import type { DistantWorldPlugin } from "./DistantWorldPlugin";

function DistantWorldPanel({ plugin }: { plugin: DistantWorldPlugin }) {
    const subscribe = useCallback((listener: () => void) => plugin.subscribe(listener), [plugin]);
    const snapshot = useCallback(() => plugin.getState(), [plugin]);
    const state = useSyncExternalStore(subscribe, snapshot, snapshot);
    return <div className="rl-sidebar-panel-content rl-sidebar-scrollable">
        <p className="rl-sidebar-panel-copy">{state.status}</p>
        <p className="rl-sidebar-panel-copy">Scenery: {state.distance} tiles. Geometry: {state.gpuMiB} MiB.</p>
        {state.sceneryOwner && <p className="rl-sidebar-panel-copy">{state.sceneryOwner} controls scenery settings. Distant World only adds NPC previews within its render distance.</p>}
        <p className="rl-sidebar-panel-copy">Selected NPC previews: {state.previews} of {state.eligible} eligible. Catalog: {state.catalog} spawns.</p>
        {state.previews < state.eligible && <p className="rl-sidebar-panel-copy">The current preview budget is {state.previewLimit}. NPCs in the camera view take priority.</p>}
        {state.truncated && <p className="rl-sidebar-panel-copy">The server catalog reached its spawn limit. Move closer to refresh distant coverage.</p>}
        <label className="rl-sidebar-panel-copy">Maximum distance: {plugin.config.distance()} tiles
            <input aria-label="Maximum scenery distance" type="range" min="128" max="1024" step="32" value={plugin.config.distance()} disabled={!!state.sceneryOwner}
                onChange={e => plugin.setConfig("distance", Number(e.target.value))} />
        </label>
        <label className="rl-sidebar-panel-copy">NPC limit
            <input aria-label="NPC preview limit" type="number" min="16" max="1024" value={plugin.config.npcLimit()}
                onChange={e => plugin.setConfig("npcLimit", Number(e.target.value))} />
        </label>
        <label className="rl-sidebar-panel-copy">Geometry budget (MiB)
            <input aria-label="Geometry budget" type="number" min="64" max="512" value={plugin.config.memoryBudget()} disabled={!!state.sceneryOwner}
                onChange={e => plugin.setConfig("memoryBudget", Number(e.target.value))} />
        </label>
        {([ ["npcs", "Animated distant NPC previews"], ["showRange", "Outline the real NPC update range"],
            ["deferredActions", "Offer approach and interact actions"] ] as const).map(([key, text]) =>
            <label key={key} className="rl-sidebar-check"><input type="checkbox" checked={plugin.config[key]()}
                onChange={e => plugin.setConfig(key, e.target.checked)} /><span>{text}</span></label>)}
        <p className="rl-sidebar-panel-copy">Cosmetic NPCs wander within their spawn radii. Stationary spawns stay fixed. This movement is not live activity. Right-click a preview to approach it. Actions require a unique real NPC when you arrive.</p>
        <button className="rl-sidebar-text-button" type="button" onClick={() => plugin.approach.cancel("Approach cancelled.", true)}>Cancel approach</button>
    </div>;
}
export function createDistantWorldNavigationButton(plugin: DistantWorldPlugin): NavigationButton {
    return NavigationButton.builder().tooltip("Distant World").icon(imageIcon(runeliteImage("tile_packs_icon.png")))
        .priority(5).panel(() => <DistantWorldPanel plugin={plugin} />).build();
}
