import type { OsrsClient } from "../../game/OsrsClient";
import { sequenceInterpolation, type ActorInterpolation } from "../../rs/model/seq/FrameInterpolation";

/** Keep distant NPCs on their inexpensive baked poses in both backends. */
export function npcInterpolation(
    client: OsrsClient,
    id: number,
    seqId: number,
    frame: number,
    overlaySeqId = -1,
    overlayFrame = -1,
): ActorInterpolation | undefined {
    const plugins = client.clientPlugins;
    if (!plugins.smoothsNpcs()) return undefined;
    const ecs = client.npcEcs;
    const player = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    if (player === undefined || ecs.getWorldViewId(id) !== client.playerEcs.getWorldViewId(player)) {
        return undefined;
    }
    if (Math.abs(ecs.getWorldX(id) - client.playerEcs.getX(player)) > 16 * 128 ||
        Math.abs(ecs.getWorldY(id) - client.playerEcs.getY(player)) > 16 * 128) {
        return undefined;
    }
    const action = ecs.getSeqId(id) >= 0 && ecs.getSeqDelay(id) === 0;
    const sample = (seq: number, index: number, isAction: boolean) => {
        if (seq < 0 || !plugins.smoothsNpc(ecs.getNpcTypeId(id), seq, isAction)) return undefined;
        return sequenceInterpolation(
            client.seqTypeLoader.load(seq), index,
            isAction ? ecs.getAnimTick(id) : ecs.getMovementAnimTick(id), client.seqFrameLoader,
            isAction ? "action" : "movement",
            isAction ? ecs.getLoopCount(id) : ecs.getMovementLoopCount(id),
        );
    };
    const base = sample(seqId, frame, action);
    const overlay = sample(overlaySeqId, overlayFrame, false);
    return base || overlay ? { base, overlay } : undefined;
}
