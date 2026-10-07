import type { WebGLOsrsRendererHost } from "../../../render/render/hostInterface";
import { RENDER_CONSTANTS } from "../../../render/render/constants";
import { getCurrentTick } from "../../../network/serverConnection/timing";
import type { OverheadTextEntry } from "../../../ui/devoverlay/Overlay";
import { getAttackTimerTicks } from "./attackTimerState";

/** The game's yellow overhead-chat colour (colour id 0). */
const TIMER_COLOUR_ID = 0;

/**
 * The local player's attack timer as overhead text: the ticks until their next attack, while
 * there are any. It shares the player's stacking group, so it sits with their overhead chat.
 */
export function appendAttackTimerOverhead(
    host: WebGLOsrsRendererHost,
    index: number | undefined,
    output: OverheadTextEntry[],
    maxEntries: number,
    playerDefaultHeightTiles: number | undefined,
): void {
    if (index === undefined || output.length >= maxEntries) return;
    if (!host.osrsClient.attackTimerPlugin?.isEnabled()) return;
    const ticks = getAttackTimerTicks(getCurrentTick());
    if (ticks <= 0) return;
    const pe = host.osrsClient.playerEcs;
    // On a boat deck the player is drawn elsewhere; leave the timer out there.
    if ((pe.getWorldViewId(index) | 0) >= 0) return;

    const overhead = host.acquireOverheadTextEntry();
    overhead.worldX = (pe.getX(index) | 0) / 128.0;
    overhead.worldZ = (pe.getY(index) | 0) / 128.0;
    overhead.plane = pe.getLevel(index) | 0;
    overhead.footprintRadius = RENDER_CONSTANTS.PLAYER_FOOTPRINT_RADIUS;
    overhead.groupKey = host.makeActorGroupKey(false, pe.getServerIdForIndex?.(index) ?? 0);
    overhead.text = String(ticks);
    overhead.color = host.mapOverheadColor(TIMER_COLOUR_ID);
    overhead.colorId = TIMER_COLOUR_ID;
    overhead.effect = 0;
    overhead.modIcon = undefined;
    overhead.pattern = undefined;
    overhead.duration = 1;
    overhead.remaining = 1;
    overhead.life = 1;
    overhead.heightOffsetTiles = host.resolvePlayerLogicalHeightTiles(index, playerDefaultHeightTiles);
    output.push(overhead);
}
