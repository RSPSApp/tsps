import type { OsrsClient } from "../../game/OsrsClient";
import { sequenceInterpolation, type ActorInterpolation } from "../../rs/model/seq/FrameInterpolation";

/** Sample the same controller state for colour, transparency, shadows and both backends. */
export function playerInterpolation(
    client: OsrsClient,
    pid: number,
    seqId: number,
    frame: number,
    overlaySeqId?: number,
    overlayFrame?: number,
): ActorInterpolation | undefined {
    const serverId = client.playerEcs.getServerIdForIndex(pid);
    if (serverId === undefined || !client.playerAnimController) return undefined;
    const action = client.playerAnimController.getSequenceState(serverId);
    const movement = client.playerAnimController.getMovementSequenceState(serverId);
    const sample = (id: number, index: number, isOverlay: boolean) => {
        if (!client.clientPlugins.smoothsPlayer(id)) return undefined;
        const isAction = !isOverlay && action?.seqId === id && action.delay === 0;
        const state = isAction ? action : movement;
        if (state?.seqId !== id || state.frame !== index) return undefined;
        return sequenceInterpolation(
            client.seqTypeLoader.load(id), index, state.frameCycle,
            client.seqFrameLoader, isAction ? "action" : "movement", state.loopCounter,
        );
    };
    const base = sample(seqId, frame, false);
    const overlay = overlaySeqId === undefined || overlayFrame === undefined
        ? undefined : sample(overlaySeqId, overlayFrame, true);
    return base || overlay ? { base, overlay } : undefined;
}
