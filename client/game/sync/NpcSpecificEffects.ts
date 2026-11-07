import { notifyActorGraphic } from "../ActorEventHooks";
import type { GameRenderer } from "../GameRenderer";
import type { NpcEcs } from "../ecs/NpcEcs";
import type { NpcSpecificEffect } from "../../network/serverConnection/types/sync";

/** Apply a one-shot viewer effect using the same sequence and graphic owners as NPC sync. */
export function applyNpcSpecificEffect(
    ecs: NpcEcs,
    renderer: Pick<GameRenderer, "registerNpcSpotAnimation"> | undefined,
    effect: NpcSpecificEffect,
    clientCycle: number,
): void {
    const ecsId = ecs.getEcsIdForServer(effect.index);
    if (ecsId === undefined) return;
    if (effect.kind === "animation") {
        ecs.handleServerSequence(ecsId, effect.id, effect.delay, clientCycle);
    } else if (effect.kind === "spot") {
        renderer?.registerNpcSpotAnimation({ npcServerId: effect.index, spotId: effect.id,
            slot: effect.slot, height: effect.height, startCycle: clientCycle + effect.delay });
        notifyActorGraphic({ type: "npc", serverId: effect.index, graphic: effect.id });
    }
}
