import type { GfxInstance } from "./GfxManager";

/** Who a graphic plays on: a player (`pid`), an NPC (`ecsId`), or neither (a world graphic, at `inst.world`). */
export interface GfxSoundOwner {
    pid?: number;
    ecsId?: number;
}

/**
 * Plays the frame sounds of a graphic's sequence (seq `frameSounds`, e.g. 11428 on the Demonic Pacts
 * reflect's `leagues_6_fire_shield`) once each time its drawn frame changes. Both renderers call this
 * from their graphics pass, so a graphic sounds the same whichever draws it; `inst.lastSoundFrame`
 * keeps a frame from sounding twice.
 */
export function dispatchGfxFrameSounds(client: any, inst: GfxInstance, frameIdx: number, owner: GfxSoundOwner = {}): void {
    if (inst.lastSoundFrame === frameIdx) return;
    try {
        const spot = client?.spotAnimTypeLoader?.load?.(inst.spotId | 0);
        const seqId: number = typeof spot?.sequenceId === "number" ? spot.sequenceId | 0 : -1;
        if (seqId < 0) return;
        const seqType = client.seqTypeLoader?.load?.(seqId | 0);
        if (!seqType || !seqType.frameSounds?.size) return;

        let px: number | undefined;
        let py: number | undefined;
        let pz: number | undefined;
        let isLocal = false;
        if (typeof owner.pid === "number") {
            const pid = owner.pid | 0;
            px = client.playerEcs?.getX?.(pid) | 0;
            py = client.playerEcs?.getY?.(pid) | 0;
            pz = (client.playerEcs?.getLevel?.(pid) | 0) * 128;
            const sid = client.playerEcs?.getServerIdForIndex?.(pid);
            isLocal = typeof sid === "number" && (sid | 0) === (client.controlledPlayerServerId | 0);
        } else if (typeof owner.ecsId === "number") {
            const eid = owner.ecsId | 0;
            px = client.npcEcs?.getX?.(eid) | 0;
            py = client.npcEcs?.getY?.(eid) | 0;
            pz = (client.npcEcs?.getLevel?.(eid) | 0) * 128;
        } else if (inst.world) {
            px = (inst.world.tileX | 0) * 128 + 64;
            py = (inst.world.tileY | 0) * 128 + 64;
            pz = (inst.world.level | 0) * 128;
        }

        client.handleSeqFrameSounds(seqType, frameIdx | 0, {
            position: px !== undefined && py !== undefined ? { x: px, y: py, z: pz } : undefined,
            isLocalPlayer: isLocal,
            debugSeqId: seqId | 0,
            debugFrame: frameIdx | 0,
        });
    } catch {
    } finally {
        inst.lastSoundFrame = frameIdx | 0;
    }
}
