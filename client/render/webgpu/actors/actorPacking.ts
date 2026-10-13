import { getClientCycle } from "../../../network/ServerConnection";
import { clamp } from "../../../common/utils/MathUtil";
import type { NpcEcs } from "../../../game/ecs/NpcEcs";
import type { OsrsClient } from "../../../game/OsrsClient";
import { ClientState } from "../../../game/ClientState";
import { interpolateRotation } from "../../../game/movement/NpcClientTick";
import { resolveHeightSamplePlaneForLocal } from "../../../game/scene/PlaneResolver";
import type { TileFlagMapSquare } from "../../../game/scene/TileRenderFlags";
import { computeFacingRotation } from "../../../game/utils/rotation";
import { decodeInteractionIndex } from "../../../rs/interaction/InteractionIndex";
import { NpcDrawPriority } from "../../../rs/config/npctype/NpcType";
import type { NpcType } from "../../../rs/config/npctype/NpcType";
import type { DynamicNpcAnimLoader, DynamicNpcFrameGeometry } from "../../npc/DynamicNpcAnimLoader";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";

export const PLAYER_INTERACT_BASE = 0x8000;

/** Texture capacity from actorGpu.ts; duplicated to keep this module dependency-free. */
const ACTOR_MAX = 8192;

/** Growable RGBA16UI actor-data packer: 8 uint16 per actor. */
export class ActorDataWriter {
    data = new Uint16Array(1024);
    count = 0;

    reset(): void {
        this.count = 0;
    }

    /** Reserves one actor slot and returns its index, or -1 when the texture is full. */
    alloc(): number {
        if (this.count >= ACTOR_MAX) return -1;
        const index = this.count++;
        const required = this.count * 8;
        if (required > this.data.length) {
            const next = new Uint16Array(Math.max(required, this.data.length * 2));
            next.set(this.data);
            this.data = next;
        }
        return index;
    }

    writeZero(index: number): void {
        this.data.fill(0, index * 8, index * 8 + 8);
    }
}

function mapAsTileFlags(map: WebGPUMapSquare): TileFlagMapSquare {
    return map as unknown as TileFlagMapSquare;
}

export function npcLocalForMap(world: number, renderBaseTile: number): number {
    return ((world | 0) - (renderBaseTile | 0) * 128) | 0;
}

export function getEffectiveNpcType(client: OsrsClient, npcTypeId: number): NpcType | undefined {
    if ((npcTypeId | 0) < 0) return undefined;
    try {
        const base = client.npcTypeLoader.load(npcTypeId | 0);
        if (!base) return undefined;
        if (!base.transforms) return base;
        return base.transform(client.varManager, client.npcTypeLoader);
    } catch {
        return undefined;
    }
}

/** Port of render/render/tick2.ts shouldRenderNpcFromMap for server-driven (non-instance) NPCs. */
export function shouldRenderServerNpc(
    client: OsrsClient,
    map: WebGPUMapSquare,
    ecsId: number,
): boolean {
    const ecs = client.npcEcs;
    if (!ecs.isActive(ecsId) || !ecs.isLinked(ecsId)) return false;
    if ((ecs.getWorldViewId(ecsId) | 0) >= 0) return false;
    if (!getEffectiveNpcType(client, ecs.getNpcTypeId(ecsId) | 0)) return false;
    return (
        (ecs.getMapX(ecsId) | 0) === (map.mapX | 0) && (ecs.getMapY(ecsId) | 0) === (map.mapY | 0)
    );
}

/** Port of render/render/anim/npc.ts resolveNpcMovementSequenceIds. */
export function resolveNpcMovementSequenceIds(
    client: OsrsClient,
    ecs: NpcEcs,
    ecsId: number,
): { movementSeqId: number; idleSeqId: number; walkSeqId: number } {
    let movementSeqId = -1;
    let idleSeqId = -1;
    let walkSeqId = -1;
    const npcTypeId = ecs.getNpcTypeId?.(ecsId);
    if (typeof npcTypeId !== "number" || npcTypeId < 0) {
        return { movementSeqId, idleSeqId, walkSeqId };
    }

    try {
        const npcType = client.npcTypeLoader.load(npcTypeId | 0);
        if (!npcType) return { movementSeqId, idleSeqId, walkSeqId };

        const movementSet = Object.assign(npcType.getMovementSeqSet(client.basTypeLoader), ecs.getMovementOverrides(ecsId));
        idleSeqId = movementSet.idle | 0;
        walkSeqId = movementSet.walk | 0;
        const pathLength = ecs.getPathLengthLike?.(ecsId) | 0;
        if (pathLength <= 0) {
            movementSeqId = idleSeqId;
            const rot = ecs.getRotation(ecsId) | 0;
            const targetRot = ecs.getTargetRot(ecsId) | 0;
            const delta = (targetRot - rot) & 2047;
            if (delta !== 0) {
                const rotSpeed = ecs.getRotationSpeed(ecsId) | 0;
                const stillTurning =
                    rotSpeed > 0 && delta >= rotSpeed && delta <= 2048 - rotSpeed;
                if (stillTurning) {
                    const turnSeq = delta > 1024 ? movementSet.turnLeft | 0 : movementSet.turnRight | 0;
                    const resolved = turnSeq >= 0 ? turnSeq : walkSeqId;
                    if (resolved >= 0) movementSeqId = resolved;
                }
            }
            return { movementSeqId, idleSeqId, walkSeqId };
        }

        const movementOrientation = ecs.getCurrentStepRot(ecsId);
        if (movementOrientation === undefined) {
            movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
            return { movementSeqId, idleSeqId, walkSeqId };
        }

        let yaw = ((movementOrientation | 0) - (ecs.getRotation(ecsId) | 0)) & 2047;
        if (yaw > 1024) yaw -= 2048;

        let nextSeq = movementSet.walkBack | 0;
        if (yaw >= -256 && yaw <= 256) nextSeq = movementSet.walk | 0;
        else if (yaw >= 256 && yaw < 768) nextSeq = movementSet.walkRight | 0;
        else if (yaw >= -768 && yaw <= -256) nextSeq = movementSet.walkLeft | 0;
        if (nextSeq === -1) nextSeq = movementSet.walk | 0;

        let speed = 4;
        if (!!npcType.isClipped) {
            if (
                (movementOrientation | 0) !== (ecs.getRotation(ecsId) | 0) &&
                (ecs.getInteractionIndex?.(ecsId) | 0) < 0 &&
                (ecs.getRotationSpeed(ecsId) | 0) !== 0
            ) {
                speed = 2;
            }
            if (pathLength > 2) speed = 6;
            if (pathLength > 3) speed = 8;
            if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                speed = 8;
            }
        } else {
            if (pathLength > 1) speed = 6;
            if (pathLength > 2) speed = 8;
            if ((ecs.getMovementDelayCounter?.(ecsId) | 0) > 0 && pathLength > 1) {
                speed = 8;
            }
        }

        const rawTraversal = ecs.getCurrentStepSpeed(ecsId) | 0;
        if (rawTraversal >= 8) speed <<= 1;
        else if (rawTraversal <= 2) speed >>= 1;

        if (speed >= 8) {
            if (nextSeq === (movementSet.walk | 0) && (movementSet.run | 0) !== -1) {
                nextSeq = movementSet.run | 0;
            } else if (nextSeq === (movementSet.walkBack | 0) && (movementSet.runBack | 0) !== -1) {
                nextSeq = movementSet.runBack | 0;
            } else if (nextSeq === (movementSet.walkLeft | 0) && (movementSet.runLeft | 0) !== -1) {
                nextSeq = movementSet.runLeft | 0;
            } else if (
                nextSeq === (movementSet.walkRight | 0) &&
                (movementSet.runRight | 0) !== -1
            ) {
                nextSeq = movementSet.runRight | 0;
            }
        } else if (speed <= 2) {
            if (nextSeq === (movementSet.walk | 0) && (movementSet.crawl | 0) !== -1) {
                nextSeq = movementSet.crawl | 0;
            } else if (nextSeq === (movementSet.walkBack | 0) && (movementSet.crawlBack | 0) !== -1) {
                nextSeq = movementSet.crawlBack | 0;
            } else if (
                nextSeq === (movementSet.walkLeft | 0) &&
                (movementSet.crawlLeft | 0) !== -1
            ) {
                nextSeq = movementSet.crawlLeft | 0;
            } else if (
                nextSeq === (movementSet.walkRight | 0) &&
                (movementSet.crawlRight | 0) !== -1
            ) {
                nextSeq = movementSet.crawlRight | 0;
            }
        }

        movementSeqId = nextSeq | 0;
        if (movementSeqId < 0) {
            movementSeqId = walkSeqId >= 0 ? walkSeqId : idleSeqId;
        }
    } catch {}

    return { movementSeqId, idleSeqId, walkSeqId };
}

/** Port of render/render/anim/npc.ts shouldLayerNpcMovementSequence. */
export function shouldLayerNpcMovementSequence(
    client: OsrsClient,
    actionSeqId: number,
    movementSeqId: number,
    idleSeqId: number,
): boolean {
    if (
        (actionSeqId | 0) < 0 ||
        (movementSeqId | 0) < 0 ||
        (movementSeqId | 0) === (idleSeqId | 0)
    ) {
        return false;
    }
    try {
        const seqType = client.seqTypeLoader.load(actionSeqId | 0) as any;
        if (seqType?.isSkeletalSeq?.()) {
            return Array.isArray(seqType.skeletalMasks);
        }
        return Array.isArray(seqType?.masks) && seqType.masks.length > 0;
    } catch {
        return false;
    }
}

/** Port of render/render/anim/npc2.ts resolveUnbatchedNpcGeometry (smoothing disabled). */
export function resolveUnbatchedNpcGeometry(
    client: OsrsClient,
    loader: DynamicNpcAnimLoader,
    ecsId: number,
): DynamicNpcFrameGeometry | undefined {
    if (!loader.isReady()) return undefined;

    const ecs = client.npcEcs;
    const npcTypeId = ecs.getNpcTypeId(ecsId) | 0;
    const actionSeqId = ecs.getSeqId(ecsId) | 0;
    const actionActive = actionSeqId >= 0 && (ecs.getSeqDelay?.(ecsId) | 0) === 0;
    const { movementSeqId, idleSeqId } = resolveNpcMovementSequenceIds(client, ecs, ecsId);
    const renderSeqId = actionActive ? actionSeqId : movementSeqId | 0;
    const overlaySeqId =
        actionActive &&
        shouldLayerNpcMovementSequence(client, actionSeqId, movementSeqId | 0, idleSeqId | 0)
            ? movementSeqId | 0
            : -1;
    const frameId = actionActive
        ? ecs.getFrameIndex(ecsId) | 0
        : ecs.getMovementFrameIndex?.(ecsId) | 0;
    const overlayFrameId = overlaySeqId >= 0 ? ecs.getMovementFrameIndex?.(ecsId) | 0 : -1;

    let geometry: DynamicNpcFrameGeometry | undefined;
    try {
        if (renderSeqId >= 0) {
            geometry = loader.getFrameGeometry(
                npcTypeId,
                renderSeqId,
                frameId,
                overlaySeqId,
                overlayFrameId,
            );
        }
        const hasGraphics =
            !!geometry &&
            ((geometry.opaqueVertices.length > 0 && geometry.opaqueIndices.length > 0) ||
                (geometry.alphaVertices.length > 0 && geometry.alphaIndices.length > 0));
        if (!hasGraphics) geometry = loader.getBaseGeometry(npcTypeId);
    } catch {
        try {
            geometry = loader.getBaseGeometry(npcTypeId);
        } catch {
            geometry = undefined;
        }
    }
    return geometry;
}

/** Port of PlayerRenderer.getRenderPlayersForMap (first-person selection omitted). */
export function getRenderPlayersForMap(
    client: OsrsClient,
    map: WebGPUMapSquare,
    selection?: ActorTileSelection,
): number[] {
    const out: number[] = [];
    const pe = client.playerEcs;
    const renderSelf = client.renderSelf !== false;
    const controlledServerId = client.controlledPlayerServerId | 0;
    const controlledPid =
        controlledServerId > 0 ? pe.getIndexForServerId(controlledServerId) : undefined;
    const baseTileX = map.getRenderBaseTileX();
    const baseTileY = map.getRenderBaseTileY();
    const tileSpan = map.getLocalTileSpan();

    for (const activePid of pe.getAllActiveIndices()) {
        const pid = activePid | 0;
        if (!renderSelf && controlledPid !== undefined && pid === controlledPid) continue;
        if ((pe.getWorldViewId(pid) | 0) >= 0) continue;
        if (pe.getIsHidden(pid)) continue;

        const px = pe.getX(pid) | 0;
        const py = pe.getY(pid) | 0;
        const tileX = (px >> 7) | 0;
        const tileY = (py >> 7) | 0;
        if (
            tileX < baseTileX ||
            tileX >= baseTileX + tileSpan ||
            tileY < baseTileY ||
            tileY >= baseTileY + tileSpan
        ) {
            continue;
        }
        if (selection && !selection.shouldRenderPlayer(client, pid)) continue;
        out.push(pid | 0);
    }
    return out;
}

function packActorColorOverride(
    writer: ActorDataWriter,
    index: number,
    override: { amount: number; startCycle: number; endCycle: number; hue: number; sat: number; lum: number },
): void {
    const offset = index * 8;
    const clientCycle = getClientCycle() | 0;
    if (
        override.amount !== 0 &&
        clientCycle >= override.startCycle &&
        clientCycle < override.endCycle
    ) {
        writer.data[offset + 4] = (override.hue & 0x7f) | ((override.sat & 0x7f) << 7);
        writer.data[offset + 5] = (override.lum & 0x7f) | ((override.amount & 0xff) << 7);
    } else {
        writer.data[offset + 4] = 0;
        writer.data[offset + 5] = 0;
    }
    writer.data[offset + 6] = 0;
    writer.data[offset + 7] = 0;
}

/** Pack one server NPC; returns its absolute actor index. */
export function packNpcActorData(
    client: OsrsClient,
    writer: ActorDataWriter,
    map: WebGPUMapSquare,
    ecsId: number,
): number {
    const ecs = client.npcEcs;
    const index = writer.alloc();
    const offset = index * 8;

    const npcX = npcLocalForMap(ecs.getWorldX(ecsId), map.getRenderBaseTileX());
    const npcY = npcLocalForMap(ecs.getWorldY(ecsId), map.getRenderBaseTileY());
    const mapTileSpan = map.getLocalTileSpan();
    const localTileX = clamp((npcX >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
    const localTileY = clamp((npcY >> 7) | 0, 0, Math.max(0, mapTileSpan - 1));
    const renderPlane = resolveHeightSamplePlaneForLocal(
        mapAsTileFlags(map),
        ecs.getLevel(ecsId) | 0,
        localTileX,
        localTileY,
    );

    writer.data[offset + 0] = npcX;
    writer.data[offset + 1] = npcY;
    writer.data[offset + 2] = renderPlane | (ecs.getRotation(ecsId) << 2);
    writer.data[offset + 3] = ecs.getServerId(ecsId);
    packActorColorOverride(writer, index, ecs.getColorOverride(ecsId));
    return index;
}

/** Pack one player; `indexInMap` is its slot in the map's render list (GFX slot). */
export function packPlayerActorData(
    client: OsrsClient,
    writer: ActorDataWriter,
    map: WebGPUMapSquare,
    pid: number,
    indexInMap: number,
): number {
    const pe = client.playerEcs;
    const index = writer.alloc();
    const offset = index * 8;

    const px = pe.getX(pid) | 0;
    const py = pe.getY(pid) | 0;
    const mapBaseTileX = map.getRenderBaseTileX();
    const mapBaseTileY = map.getRenderBaseTileY();
    const mapTileSpan = map.getLocalTileSpan();

    const localTileX = ((px / 128) | 0) - mapBaseTileX;
    const localTileY = ((py / 128) | 0) - mapBaseTileY;
    const tx = clamp(localTileX, 0, Math.max(0, mapTileSpan - 1));
    const ty = clamp(localTileY, 0, Math.max(0, mapTileSpan - 1));
    const renderPlane = resolveHeightSamplePlaneForLocal(
        mapAsTileFlags(map),
        pe.getLevel(pid) | 0,
        tx,
        ty,
    );

    const localX = (px - mapBaseTileX * 128) | 0;
    const localY = (py - mapBaseTileY * 128) | 0;
    const rot = pe.getRotation(pid) & 2047;

    writer.data[offset + 0] = localX;
    writer.data[offset + 1] = localY;
    writer.data[offset + 2] = renderPlane | (rot << 2);
    writer.data[offset + 3] = PLAYER_INTERACT_BASE + (indexInMap & 0x7fff);
    packActorColorOverride(writer, index, pe.getColorOverride(pid));
    return index;
}

/** Port of render/render/draw.ts addProjectileRenderData packing. */
export function packProjectileActorData(
    client: OsrsClient,
    writer: ActorDataWriter,
    map: WebGPUMapSquare,
    proj: {
        getPosition(): { x: number; y: number };
        getRotation(): { yaw: number; pitch: number; roll: number };
        plane: number;
        projectileId: number;
    },
): number {
    const index = writer.alloc();
    const offset = index * 8;

    const mapWorldX = map.getRenderBaseTileX() * 128;
    const mapWorldY = map.getRenderBaseTileY() * 128;
    const mapTileSpan = Math.max(1, map.getLocalTileSpan());
    const pos = proj.getPosition();
    const relativeXf = pos.x - mapWorldX;
    const relativeYf = pos.y - mapWorldY;
    const baseRelativeX = Math.floor(relativeXf);
    const baseRelativeY = Math.floor(relativeYf);
    const localTileX = clamp((baseRelativeX >> 7) | 0, 0, mapTileSpan - 1);
    const localTileY = clamp((baseRelativeY >> 7) | 0, 0, mapTileSpan - 1);
    const renderPlane = resolveHeightSamplePlaneForLocal(
        mapAsTileFlags(map),
        proj.plane | 0,
        localTileX,
        localTileY,
    );

    const rotation = proj.getRotation();
    const yawOsrs = (rotation.yaw & 2047) | 0;
    const pitchOsrs = (rotation.pitch & 2047) | 0;
    const rollOsrs = (rotation.roll & 2047) | 0;

    const pitchShifted = (pitchOsrs >> 4) & 0x7f;
    const pitchHi = (pitchShifted >> 4) & 0x7;
    const pitchLo = pitchShifted & 0xf;
    const rollShifted = (rollOsrs >> 8) & 0x7;
    const plane = renderPlane & 0x3;

    writer.data[offset + 0] = baseRelativeX & 0xffff;
    writer.data[offset + 1] = baseRelativeY & 0xffff;
    writer.data[offset + 2] = (plane | (yawOsrs << 2) | (pitchHi << 13)) & 0xffff;
    writer.data[offset + 3] =
        ((proj.projectileId & 0x1ff) | (pitchLo << 9) | (rollShifted << 13)) & 0xffff;
    writer.data[offset + 4] = 0;
    writer.data[offset + 5] = 0;
    writer.data[offset + 6] = 0;
    writer.data[offset + 7] = 0;
    return index;
}

/** Port of render/render/draw.ts addWorldGfxRenderData packing. */
export function packWorldGfxActorData(
    writer: ActorDataWriter,
    map: WebGPUMapSquare,
    world: { tileX: number; tileY: number; level: number },
): number {
    const index = writer.alloc();
    const offset = index * 8;
    // Relative to where the map is drawn (an instance scene's base), matching u_mapPos.
    const mapBaseX = map.getRenderBaseTileX();
    const mapBaseY = map.getRenderBaseTileY();
    const maxLocal = map.getLocalTileSpan() - 1;
    const localX = ((world.tileX | 0) * 128 + 64) - mapBaseX * 128;
    const localY = ((world.tileY | 0) * 128 + 64) - mapBaseY * 128;
    const localTileX = clamp((world.tileX | 0) - mapBaseX, 0, maxLocal);
    const localTileY = clamp((world.tileY | 0) - mapBaseY, 0, maxLocal);
    const renderPlane = resolveHeightSamplePlaneForLocal(
        mapAsTileFlags(map),
        world.level | 0,
        localTileX,
        localTileY,
    );
    writer.data[offset + 0] = localX;
    writer.data[offset + 1] = localY;
    writer.data[offset + 2] = renderPlane;
    writer.data[offset + 3] = 0;
    writer.data[offset + 4] = 0;
    writer.data[offset + 5] = 0;
    writer.data[offset + 6] = 0;
    writer.data[offset + 7] = 0;
    return index;
}


// ── NPC client animation stepping ───────────────────────────────────────────────────────────
//
// Port of render/tick3.ts _ecsUpdateNpcClient. Under WebGL the per-map baked frame arrays and
// this render-tick pass are what advance an NPC's rotation and movement/action frame tracks; the
// WebGPU stream has no baked arrays, so frame counts/lengths come from the sequence types and the
// resulting ECS state is exactly what the dynamic loader consumes.

interface NpcSequenceTrackStep {
    frameIndex: number;
    animTick: number;
    loopCount: number;
    frameAdvanced: boolean;
    cleared: boolean;
}

/** Port of render/anim/npc2.ts stepNpcSequenceTrack (its host argument is unused). */
export function stepNpcSequenceTrack(
    frameIndex: number,
    animTick: number,
    loopCount: number,
    frameCount: number,
    lengths: number[] | undefined,
    seqType: any,
    clearOnFinish: boolean,
): NpcSequenceTrackStep {
    let fi = Math.max(0, frameIndex | 0);
    let tick = Math.max(0, animTick | 0);
    let loops = Math.max(0, loopCount | 0);
    const safeFrameCount = Math.max(1, frameCount | 0);
    let frameAdvanced = false;
    let cleared = false;

    if (fi >= safeFrameCount) {
        fi = 0;
    }

    if (!seqType) {
        const currLen = ((lengths ? lengths[fi] : 0) ?? 0) | 0;
        tick = (tick + 1) | 0;
        if (tick > currLen) {
            tick = 1;
            fi++;
            frameAdvanced = true;
        }
        if (fi >= safeFrameCount) {
            if (clearOnFinish) {
                cleared = true;
            } else {
                fi = 0;
                tick = 0;
                loops = 0;
            }
        }
        return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
    }

    if (!!seqType?.isSkeletalSeq?.() || (seqType?.skeletalId ?? -1) >= 0) {
        const frameStep = (seqType.frameStep ?? -1) | 0;
        const maxLoops = (seqType.maxLoops ?? 0) | 0;

        fi++;
        tick = 0;
        frameAdvanced = true;

        if (fi >= safeFrameCount) {
            if (frameStep > 0) {
                fi -= frameStep;
                if (clearOnFinish) {
                    loops++;
                    cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
                } else {
                    const looping = !!seqType.looping;
                    if (looping) loops++;
                    if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                        fi = 0;
                        tick = 0;
                        loops = 0;
                    }
                }
            } else if (clearOnFinish) {
                cleared = true;
            } else {
                fi = 0;
                tick = 0;
                loops = 0;
            }
        }

        return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
    }

    const frameStep = (seqType.frameStep ?? -1) | 0;
    const maxLoops = (seqType.maxLoops ?? 0) | 0;
    tick = (tick + 1) | 0;
    const safeFrameIndex = lengths ? Math.min(fi, Math.max(0, lengths.length - 1)) : fi;
    const currLen = ((lengths ? lengths[safeFrameIndex] : 0) ?? 0) | 0;
    if (tick > currLen) {
        tick = 1;
        fi++;
        frameAdvanced = true;
    }

    if (fi >= safeFrameCount) {
        if (frameStep > 0) {
            fi -= frameStep;
            if (clearOnFinish) {
                loops++;
                cleared = loops >= maxLoops || fi < 0 || fi >= safeFrameCount;
            } else {
                const looping = !!seqType.looping;
                if (looping) loops++;
                if (fi < 0 || fi >= safeFrameCount || (looping && loops >= maxLoops)) {
                    fi = 0;
                    tick = 0;
                    loops = 0;
                }
            }
        } else if (clearOnFinish) {
            cleared = true;
        } else {
            fi = 0;
            tick = 0;
            loops = 0;
        }
    }

    return { frameIndex: fi, animTick: tick, loopCount: loops, frameAdvanced, cleared };
}

interface NpcSequenceFrameInfo {
    seqType: any | undefined;
    frameCount: number;
    lengths: number[] | undefined;
}

/** Movement/action frame data a sequence contributes (the role of the baked per-map arrays). */
function resolveNpcSequenceFrameInfo(client: OsrsClient, seqId: number): NpcSequenceFrameInfo {
    if ((seqId | 0) < 0) return { seqType: undefined, frameCount: 1, lengths: undefined };
    let seqType: any;
    try {
        seqType = client.seqTypeLoader.load(seqId | 0);
    } catch {}
    let frameCount = 1;
    let lengths: number[] | undefined;
    if (seqType) {
        if (!!seqType.isSkeletalSeq?.() || (seqType.skeletalId ?? -1) >= 0) {
            frameCount = Math.max(1, seqType.getSkeletalDuration?.() | 0);
        } else if (Array.isArray(seqType.frameIds)) {
            frameCount = Math.max(1, seqType.frameIds.length | 0);
            lengths = new Array<number>(frameCount).fill(1);
            for (let k = 0; k < frameCount; k++) {
                try {
                    lengths[k] = seqType.getFrameLength(client.seqFrameLoader, k | 0) | 0;
                } catch {}
            }
        }
    }
    return { seqType, frameCount, lengths };
}

function shouldStepNpcOnMap(client: OsrsClient, map: WebGPUMapSquare, ecsId: number): boolean {
    const ecs = client.npcEcs;
    if (!ecs.isActive(ecsId) || !ecs.isLinked(ecsId)) return false;
    if ((ecs.getWorldViewId(ecsId) | 0) >= 0) return false;
    return (
        (ecs.getMapX(ecsId) | 0) === (map.mapX | 0) && (ecs.getMapY(ecsId) | 0) === (map.mapY | 0)
    );
}

/**
 * Advances one map's NPCs by `clientTicksElapsed` client cycles: facing/rotation, the movement
 * sequence track (idle/walk/turn) and the action sequence track. Same order and semantics as
 * render/tick3.ts _ecsUpdateNpcClient.
 */
export function updateNpcClientAnimations(
    client: OsrsClient,
    map: WebGPUMapSquare,
    clientTicksElapsed: number,
): void {
    if (clientTicksElapsed <= 0) return;
    const ecs = client.npcEcs;
    const pe = client.playerEcs;
    const ids = ecs.queryByMap(map.mapX, map.mapY);
    if (ids.length === 0) return;

    for (let t = 0; t < clientTicksElapsed; t++) {
        for (let j = 0; j < ids.length; j++) {
            const id = ids[j] | 0;
            if (!shouldStepNpcOnMap(client, map, id)) continue;

            const walkingNow = ecs.shouldUseWalkAnim(id);
            const movementOrientation = walkingNow ? ecs.getCurrentStepRot(id) : undefined;
            ecs.setWalking(id, walkingNow);

            const npcWorldX = ecs.getWorldX(id) | 0;
            const npcWorldY = ecs.getWorldY(id) | 0;
            let desiredFacing: number | undefined;

            const interactionIndex = ecs.getInteractionIndex?.(id);
            const npcInteraction =
                typeof interactionIndex === "number" && interactionIndex >= 0
                    ? decodeInteractionIndex(interactionIndex)
                    : null;
            if (npcInteraction) {
                if (npcInteraction.type === "player") {
                    const targetIdx = pe.getIndexForServerId?.(npcInteraction.id | 0);
                    if (targetIdx != null) {
                        const facing = computeFacingRotation(
                            npcWorldX - (pe.getX(targetIdx) | 0),
                            npcWorldY - (pe.getY(targetIdx) | 0),
                        );
                        if (facing !== undefined) desiredFacing = facing;
                    }
                } else if (npcInteraction.type === "npc") {
                    const targetEcs = ecs.getEcsIdForServer?.(npcInteraction.id | 0);
                    if (targetEcs != null && ecs.isLinked(targetEcs | 0)) {
                        const targetMapId = ecs.getMapId(targetEcs | 0) | 0;
                        const targetWorldX =
                            (((targetMapId >> 8) & 0xff) << 13) + (ecs.getX(targetEcs | 0) | 0);
                        const targetWorldY =
                            ((targetMapId & 0xff) << 13) + (ecs.getY(targetEcs | 0) | 0);
                        const facing = computeFacingRotation(
                            npcWorldX - targetWorldX,
                            npcWorldY - targetWorldY,
                        );
                        if (facing !== undefined) desiredFacing = facing;
                    }
                }
            }
            if (
                desiredFacing === undefined &&
                walkingNow &&
                movementOrientation !== undefined
            ) {
                desiredFacing = movementOrientation;
            }
            if (desiredFacing !== undefined) {
                ecs.setTargetRot(id, desiredFacing);
            }

            const rot = ecs.getRotation(id) | 0;
            const targetRot = ecs.getTargetRot(id) | 0;
            if (rot !== targetRot) {
                ecs.setRotation(id, interpolateRotation(rot, targetRot, ecs.getRotationSpeed(id) | 0));
            }

            const seqId = ecs.getSeqId(id) | 0;
            const seqDelay = ecs.getSeqDelay?.(id) | 0;
            const { movementSeqId } = resolveNpcMovementSequenceIds(client, ecs, id);
            const currentMovementSeqId = ecs.getMovementSeqId?.(id) | 0;
            if ((movementSeqId | 0) !== (currentMovementSeqId | 0)) {
                ecs.setMovementSeqId?.(id, movementSeqId | 0);
                ecs.setMovementFrameIndex?.(id, 0);
                ecs.setMovementAnimTick?.(id, 0);
                ecs.setMovementLoopCount?.(id, 0);
            }

            const movementInfo = resolveNpcSequenceFrameInfo(client, movementSeqId | 0);
            const movementStep = stepNpcSequenceTrack(
                ecs.getMovementFrameIndex?.(id) | 0,
                ecs.getMovementAnimTick?.(id) | 0,
                ecs.getMovementLoopCount?.(id) | 0,
                movementInfo.frameCount,
                movementInfo.lengths,
                movementInfo.seqType,
                false,
            );
            ecs.setMovementFrameIndex?.(id, movementStep.frameIndex | 0);
            ecs.setMovementAnimTick?.(id, movementStep.animTick | 0);
            ecs.setMovementLoopCount?.(id, movementStep.loopCount | 0);

            if (movementStep.frameAdvanced && movementInfo.seqType?.frameSounds?.size) {
                try {
                    client.handleSeqFrameSounds(movementInfo.seqType, movementStep.frameIndex | 0, {
                        position: {
                            x: npcWorldX,
                            y: npcWorldY,
                            z: (ecs.getLevel(id) | 0) * 128,
                        },
                        isLocalPlayer: false,
                    });
                } catch {}
            }

            if (seqId >= 0 && seqDelay === 0) {
                const actionInfo = resolveNpcSequenceFrameInfo(client, seqId);
                const actionStep = stepNpcSequenceTrack(
                    ecs.getFrameIndex(id) | 0,
                    ecs.getAnimTick(id) | 0,
                    ecs.getLoopCount(id) | 0,
                    actionInfo.frameCount,
                    actionInfo.lengths,
                    actionInfo.seqType,
                    true,
                );

                if (actionStep.cleared) {
                    ecs.clearSeq(id);
                } else {
                    ecs.setFrameIndex(id, actionStep.frameIndex | 0);
                    ecs.setAnimTick(id, actionStep.animTick | 0);
                    ecs.setLoopCount(id, actionStep.loopCount | 0);
                }

                if (actionStep.frameAdvanced && actionInfo.seqType?.frameSounds?.size) {
                    try {
                        client.handleSeqFrameSounds(actionInfo.seqType, actionStep.frameIndex | 0, {
                            position: {
                                x: npcWorldX,
                                y: npcWorldY,
                                z: (ecs.getLevel(id) | 0) * 128,
                            },
                            isLocalPlayer: false,
                        });
                    } catch {}
                }
            }
        }
    }
}


// ── Per-frame actor tile selection (port of tick.ts / tick2.ts / overlays4.ts) ──────────────
//
// When two actors stand exactly on the same tile, WebGL keeps one per tile: the candidate set is
// actors perfectly centred on a tile (and, for NPCs, size 1). Priorities (strictly greater
// replaces, first wins ties): controlled player 5, combat target 4, NPC DRAW_PRIORITY_FIRST 3,
// other players 2, NPC DRAW_PRIORITY_DEFAULT 1, NPC DRAW_PRIORITY_LAST 0. Anyone not perfectly
// centred always renders. The winner map is rebuilt once per frame before packing.

const PLAYER_TILE_PRIORITY_CONTROLLED = 5;
const PLAYER_TILE_PRIORITY_COMBAT_TARGET = 4;
const NPC_TILE_PRIORITY_FIRST = 3;
const PLAYER_TILE_PRIORITY_OTHER = 2;
const NPC_TILE_PRIORITY_DEFAULT = 1;
const NPC_TILE_PRIORITY_LAST = 0;

export interface ActorTileWinner {
    kind: "player" | "npc";
    id: number;
    priority: number;
}

/** Port of tick.ts getActorTileSelectionKey. */
export function getActorTileSelectionKey(tileX: number, tileY: number, plane: number): number {
    return (
        (plane & 0x3) * 0x40000000 + ((tileX & 0x7fff) * 0x8000 + (tileY & 0x7fff))
    ) >>> 0;
}

/** Port of tick2.ts isPlayerSceneTileMarkerCandidate: perfectly centred on a tile. */
export function isPlayerSceneTileMarkerCandidate(client: OsrsClient, pid: number): boolean {
    const pe = client.playerEcs;
    const px = pe.getX(pid) | 0;
    const py = pe.getY(pid) | 0;
    return (px & 127) === 64 && (py & 127) === 64;
}

/** Port of tick2.ts isNpcSceneTileMarkerCandidate: size 1 and perfectly centred on a tile. */
export function isNpcSceneTileMarkerCandidate(client: OsrsClient, ecsId: number): boolean {
    const npcEcs = client.npcEcs;
    if ((npcEcs.getSize(ecsId) | 0) !== 1) {
        return false;
    }
    const worldX = npcEcs.getWorldX(ecsId) | 0;
    const worldY = npcEcs.getWorldY(ecsId) | 0;
    return (worldX & 127) === 64 && (worldY & 127) === 64;
}

/** Port of tick2.ts getCombatTargetPlayerEcsIndex. */
export function getCombatTargetPlayerEcsIndex(client: OsrsClient): number | undefined {
    const targetServerId = ClientState.combatTargetPlayerIndex | 0;
    if (targetServerId < 0) return undefined;
    return client.playerEcs.getIndexForServerId(targetServerId | 0);
}

export class ActorTileSelection {
    private frameId = -1;
    private built = false;
    private readonly winners = new Map<number, ActorTileWinner>();

    /** Rebuilds the winner map when the frame changes (mirrors resetActorTileSelectionFrameIfNeeded). */
    ensureForFrame(
        client: OsrsClient,
        frameId: number,
        visibleMaps: readonly WebGPUMapSquare[],
    ): void {
        const id = frameId | 0;
        if (id !== this.frameId) {
            this.frameId = id;
            this.built = false;
            this.winners.clear();
        }
        if (this.built) return;
        this.built = true;
        this.build(client, visibleMaps);
    }

    winnerAt(tileX: number, tileY: number, plane: number): ActorTileWinner | undefined {
        return this.winners.get(getActorTileSelectionKey(tileX | 0, tileY | 0, plane | 0));
    }

    /** Port of tick2.ts shouldRenderPlayerIndex (first-person selection omitted). */
    shouldRenderPlayer(client: OsrsClient, pid: number): boolean {
        const pe = client.playerEcs;
        const renderSelf = client.renderSelf !== false;
        const controlledServerId = client.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0 ? pe.getIndexForServerId(controlledServerId) : undefined;
        if (!renderSelf && controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) {
            return false;
        }
        if (pe.getIsHidden(pid | 0)) {
            return false;
        }
        if (!isPlayerSceneTileMarkerCandidate(client, pid)) {
            return true;
        }
        const winner = this.winnerAt(
            (pe.getX(pid) >> 7) | 0,
            (pe.getY(pid) >> 7) | 0,
            pe.getLevel(pid) | 0,
        );
        return winner?.kind === "player" && (winner.id | 0) === (pid | 0);
    }

    /** Port of tick2.ts shouldRenderNpcFromMap: ownership + effective type + tile selection. */
    shouldRenderNpc(client: OsrsClient, map: WebGPUMapSquare, ecsId: number): boolean {
        if (!shouldRenderServerNpc(client, map, ecsId)) return false;
        if (!isNpcSceneTileMarkerCandidate(client, ecsId)) return true;
        const ecs = client.npcEcs;
        const winner = this.winnerAt(
            (ecs.getWorldX(ecsId) >> 7) | 0,
            (ecs.getWorldY(ecsId) >> 7) | 0,
            ecs.getLevel(ecsId) | 0,
        );
        return winner?.kind === "npc" && (winner.id | 0) === (ecsId | 0);
    }

    /** Port of tick.ts registerActorTileCandidate: strictly greater replaces, first wins ties. */
    register(
        kind: "player" | "npc",
        id: number,
        tileX: number,
        tileY: number,
        plane: number,
        priority: number,
    ): void {
        const key = getActorTileSelectionKey(tileX | 0, tileY | 0, plane | 0);
        const current = this.winners.get(key);
        if (current && (priority | 0) <= (current.priority | 0)) {
            return;
        }
        this.winners.set(key, { kind, id: id | 0, priority: priority | 0 });
    }

    private build(client: OsrsClient, visibleMaps: readonly WebGPUMapSquare[]): void {
        const pe = client.playerEcs;
        const renderSelf = client.renderSelf !== false;
        const controlledServerId = client.controlledPlayerServerId | 0;
        const controlledPid =
            controlledServerId > 0 ? pe.getIndexForServerId(controlledServerId) : undefined;

        if (
            renderSelf &&
            controlledPid !== undefined &&
            isPlayerSceneTileMarkerCandidate(client, controlledPid | 0)
        ) {
            this.registerPlayer(client, controlledPid | 0, PLAYER_TILE_PRIORITY_CONTROLLED);
        }

        const combatTargetPid = getCombatTargetPlayerEcsIndex(client);
        if (
            combatTargetPid !== undefined &&
            (combatTargetPid | 0) !== (controlledPid ?? -1) &&
            isPlayerSceneTileMarkerCandidate(client, combatTargetPid | 0)
        ) {
            this.registerPlayer(client, combatTargetPid | 0, PLAYER_TILE_PRIORITY_COMBAT_TARGET);
        }

        const renderableNpcIds = this.collectRenderableNpcIds(client, visibleMaps);
        this.registerNpcsByPriority(
            client,
            NpcDrawPriority.DRAW_PRIORITY_FIRST,
            NPC_TILE_PRIORITY_FIRST,
            renderableNpcIds,
        );

        const activeServerIds = Array.from(pe.getAllServerIds()).sort((a, b) => a - b);
        for (const serverId of activeServerIds) {
            const pid = pe.getIndexForServerId(serverId | 0);
            if (pid === undefined) continue;
            if (controlledPid !== undefined && (pid | 0) === (controlledPid | 0)) continue;
            if (combatTargetPid !== undefined && (pid | 0) === (combatTargetPid | 0)) continue;
            if (!isPlayerSceneTileMarkerCandidate(client, pid | 0)) continue;
            this.registerPlayer(client, pid | 0, PLAYER_TILE_PRIORITY_OTHER);
        }

        this.registerNpcsByPriority(
            client,
            NpcDrawPriority.DRAW_PRIORITY_DEFAULT,
            NPC_TILE_PRIORITY_DEFAULT,
            renderableNpcIds,
        );
        this.registerNpcsByPriority(
            client,
            NpcDrawPriority.DRAW_PRIORITY_LAST,
            NPC_TILE_PRIORITY_LAST,
            renderableNpcIds,
        );
    }

    private collectRenderableNpcIds(
        client: OsrsClient,
        visibleMaps: readonly WebGPUMapSquare[],
    ): Set<number> {
        const renderable = new Set<number>();
        for (const map of visibleMaps) {
            const ids = client.npcEcs.queryByMap(map.mapX, map.mapY);
            for (let j = 0; j < ids.length; j++) {
                const ecsId = ids[j] | 0;
                if (shouldRenderServerNpc(client, map, ecsId)) renderable.add(ecsId);
            }
        }
        return renderable;
    }

    private registerPlayer(client: OsrsClient, pid: number, priority: number): void {
        const pe = client.playerEcs;
        if (pe.getIsHidden(pid | 0)) return;
        this.register(
            "player",
            pid | 0,
            (pe.getX(pid) >> 7) | 0,
            (pe.getY(pid) >> 7) | 0,
            pe.getLevel(pid) | 0,
            priority | 0,
        );
    }

    private registerNpcsByPriority(
        client: OsrsClient,
        drawPriority: NpcDrawPriority,
        priority: number,
        renderableNpcIds: Set<number>,
    ): void {
        const npcEcs = client.npcEcs;
        for (const idRaw of npcEcs.getServerLinkedEcsIds()) {
            const ecsId = idRaw | 0;
            if (!renderableNpcIds.has(ecsId)) continue;
            if (!isNpcSceneTileMarkerCandidate(client, ecsId)) continue;
            const npcType = getEffectiveNpcType(client, npcEcs.getNpcTypeId(ecsId) | 0);
            if (!npcType) continue;
            const npcDrawPriority = npcType.drawPriority ?? NpcDrawPriority.DRAW_PRIORITY_DEFAULT;
            if ((npcDrawPriority | 0) !== (drawPriority | 0)) continue;

            this.register(
                "npc",
                ecsId,
                (npcEcs.getWorldX(ecsId) >> 7) | 0,
                (npcEcs.getWorldY(ecsId) >> 7) | 0,
                npcEcs.getLevel(ecsId) | 0,
                priority | 0,
            );
        }
    }
}
