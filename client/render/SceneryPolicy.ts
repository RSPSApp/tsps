import { ClientState } from "../game/ClientState";
import type { GameRenderer } from "../game/GameRenderer";
import type { MapSquare } from "../game/MapManager";
import type { OsrsClient } from "../game/OsrsClient";

/** Always keep the playable scene and its approach margin fully detailed. */
export function sceneryBuildOptions(client: OsrsClient, mapX: number, mapY: number): { farOnly: boolean } {
    const settings = client.clientPlugins.scenerySettings?.();
    if (!settings || ClientState.inInstance) return { farOnly: false };
    const pid = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    if (pid === undefined || client.playerEcs.getWorldViewId(pid) >= 0) return { farOnly: false };
    const x = client.playerEcs.getX(pid) / 128, y = client.playerEcs.getY(pid) / 128;
    const distance = Math.max(mapX * 64 - x, x - (mapX + 1) * 64, mapY * 64 - y, y - (mapY + 1) * 64, 0);
    return { farOnly: distance > Math.max(96, settings.detailDistance + 64) };
}

const scans = new WeakMap<object, { next: number; requested: Map<number, number> }>();

/** Rebuild approaching far squares in place, before they become part of the playable scene. */
export function syncSceneryDetail<T extends MapSquare>(renderer: GameRenderer<T>): void {
    if (ClientState.inInstance) return;
    const now = performance.now();
    let state = scans.get(renderer);
    if (!state) scans.set(renderer, state = { next: 0, requested: new Map() });
    if (now < state.next) return;
    state.next = now + 250;
    for (const id of state.requested.keys()) if (!renderer.mapManager.mapSquares.has(id)) state.requested.delete(id);
    // Approaching squares must upgrade before optional memory-saving downgrades.
    const maps = [...renderer.mapManager.mapSquares.entries()].sort((a, b) => Number(!!b[1].farOnly) - Number(!!a[1].farOnly));
    for (const [id, map] of maps) {
        if (renderer.mapManager.worldEntityMapIds.has(id)) continue;
        const expected = sceneryBuildOptions(renderer.osrsClient, map.mapX, map.mapY).farOnly;
        if (!!map.farOnly === expected) { state.requested.delete(id); continue; }
        // Leave a full square detailed for one more square of travel to avoid boundary churn.
        if (expected && !map.farOnly) {
            const settings = renderer.osrsClient.clientPlugins.scenerySettings?.();
            const client = renderer.osrsClient;
            const pid = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
            if (settings && pid !== undefined) {
                const x = client.playerEcs.getX(pid) / 128, y = client.playerEcs.getY(pid) / 128;
                const distance = Math.max(map.mapX * 64 - x, x - (map.mapX + 1) * 64, map.mapY * 64 - y, y - (map.mapY + 1) * 64, 0);
                if (distance <= Math.max(96, settings.detailDistance + 64) + 64) continue;
            }
        }
        if (renderer.mapManager.loadingMapIds.has(id) || now - (state.requested.get(id) ?? -Infinity) < 10000) continue;
        state.requested.set(id, now);
        renderer.mapManager.loadMap(map.mapX, map.mapY, true);
        break;
    }
}
