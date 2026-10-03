import { AnimationFrames } from "../AnimationFrames";

export type NpcInstance = {
    /** Optional server-authored NPC index (OSRS: 1..65534). */
    serverId?: number;
    typeId: number;
    x: number;
    y: number;
    level: number;
    worldViewId?: number;
    name?: string;
    /**
     * The map square that draws this NPC when it is not the one its tile is in: an instance
     * scene is built as a single map square, so every NPC in it belongs to that square.
     */
    ownerMapId?: number;
};

/** The map square that owns (draws, picks) an NPC instance. */
export function npcOwnerMapId(instance: Pick<NpcInstance, "ownerMapId" | "x" | "y">): number {
    if (typeof instance.ownerMapId === "number") return instance.ownerMapId | 0;
    return (((instance.x | 0) >> 6) << 8) | ((instance.y | 0) >> 6);
}

export type NpcRenderExtraAnim = {
    seqId: number;
    anim: AnimationFrames;
    frameLengths: number[];
};

export type NpcRenderTemplate = {
    typeId: number;
    idleAnim: AnimationFrames;
    walkAnim: AnimationFrames | undefined;
    extraAnims?: NpcRenderExtraAnim[];
};

export type NpcRenderBundle = {
    template: NpcRenderTemplate;
    instances: NpcInstance[];
};
