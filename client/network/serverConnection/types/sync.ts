/** A transient effect on an already known NPC, for this connection only. */
export type NpcSpecificEffect =
    | { kind: "animation"; index: number; id: number; delay: number }
    | { kind: "spot"; index: number; id: number; slot: number; height: number; delay: number }
    | { kind: "headicon"; index: number; slot: number; archiveId: number; spriteId: number };

export interface RebuildRegionPayload {
    regionX: number;
    regionY: number;
    forceReload: boolean;
    templateChunks: number[][][];
    xteaKeys: number[][];
    mapRegions: number[];
}

export interface RebuildNormalPayload {
    regionX: number;
    regionY: number;
    forceReload: boolean;
    xteaKeys: number[][];
    mapRegions: number[];
}

export interface RebuildWorldEntityPayload {
    entityIndex: number;
    configId: number;
    sizeX: number;
    sizeZ: number;
    zoneX: number;
    zoneZ: number;
    regionX: number;
    regionY: number;
    forceReload: boolean;
    templateChunks: number[][][];
    xteaKeys: number[][];
    mapRegions: number[];
    buildAreas: import("../../../common/worldentity/WorldEntityTypes").WorldEntityBuildArea[];
}

export interface WorldEntityMaskPayload {
    animationId?: number;
    sequenceFrame?: number;
    actionMask?: number;
}

export interface WorldEntityOldUpdate {
    updateType: number;
    positionDelta?: { x: number; y: number; z: number; orientation: number };
    mask?: WorldEntityMaskPayload;
}

export interface WorldEntityNewSpawn {
    entityIndex: number;
    sizeX: number;
    sizeZ: number;
    configId: number;
    drawMode: number;
    position: { x: number; y: number; z: number; orientation: number };
    mask?: WorldEntityMaskPayload;
}

export interface WorldEntityInfoPayload {
    oldCount: number;
    oldUpdates: WorldEntityOldUpdate[];
    newSpawns: WorldEntityNewSpawn[];
}

export type SkillsUpdateEvent = {
    kind: "snapshot" | "delta";
    totalLevel: number;
    combatLevel: number;
    skills: import("./messages").SkillEntryMessage[];
};
