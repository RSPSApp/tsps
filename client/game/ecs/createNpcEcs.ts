import { NpcEcs } from "./NpcEcs";
import type { GameRenderer } from "../GameRenderer";
import type { NpcInfoFrame } from "../sync/NpcUpdateDecoder";

export type NpcGraphicsEcs = NpcEcs & {
    /**
     * Applies one NPC_INFO's removals. An index the same NPC_INFO adds again is the same NPC
     * (tsps sends a type change as a removal and an add), so its spot graphics continue.
     */
    removeForNpcInfo(frame: Pick<NpcInfoFrame, "removals" | "spawns">, despawn: (serverId: number) => void): void;
};

/** Attached graphics belong to a mapping's lifetime, not its reusable server index. */
export function createNpcEcs(
    getRenderer: () => Pick<GameRenderer, "clearNpcSpotAnimations"> | undefined,
    onServerUnmapped?: (serverId: number) => void,
): NpcGraphicsEcs {
    let continuing: ReadonlySet<number> | undefined;
    const ecs = new NpcEcs(1024, serverId => {
        if (!continuing?.has(serverId)) {
            getRenderer()?.clearNpcSpotAnimations(serverId);
            onServerUnmapped?.(serverId);
        }
    }) as NpcGraphicsEcs;
    ecs.removeForNpcInfo = (frame, despawn) => {
        continuing = new Set(frame.spawns.map(spawn => spawn.npcId | 0));
        try {
            for (const serverId of frame.removals) despawn(serverId | 0);
        } finally {
            continuing = undefined;
        }
    };
    return ecs;
}
