import { NpcEcs } from "./NpcEcs";
import type { GameRenderer } from "../GameRenderer";

/** Attached graphics belong to a mapping's lifetime, not its reusable server index. */
export function createNpcEcs(
    getRenderer: () => Pick<GameRenderer, "clearNpcSpotAnimations"> | undefined,
): NpcEcs {
    return new NpcEcs(1024, serverId => getRenderer()?.clearNpcSpotAnimations(serverId));
}
