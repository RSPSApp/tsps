/** Optional presentation beyond the normal playable scene. Never changes server visibility. */
export interface ScenerySettings {
    drawDistance: number;
    detailDistance: number;
}

/** An independently owned cosmetic actor. Its key is never a server NPC index. */
export interface CosmeticNpc {
    key: string;
    typeId: number;
    x: number;
    y: number;
    plane: number;
    rotation: number;
    seqId: number;
    frameId: number;
}
