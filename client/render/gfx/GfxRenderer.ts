import { graphicAgeMs } from './GfxManager';
import { vec2 } from "gl-matrix";
import PicoGL, { DrawCall, Texture } from "picogl";

import { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import { GfxCache, graphicFrameCycle } from "./GfxCache";
import { GfxManager, TILE_GFX_LIFT_UNITS } from "./GfxManager";
import type { GfxInstance } from "./GfxManager";
import { SpotAnimGpuCache } from "./SpotAnimGpuCache";
import { dispatchGfxFrameSounds } from "./GfxFrameSounds";
import { getPainterIndices, hasMixedPriorities } from "../npc/NpcPriorityPass";

type Pass = "opaque" | "alpha";

export class GfxRenderer {
    private cache: GfxCache;
    private gpuCache: SpotAnimGpuCache;
    // Reusable Maps to avoid per-frame allocations
    private reusableGroupsMap = new Map<string, Array<{ slot: number; yOffUnits: number; rotation: number }>>();
    private reusableYOffsetMap = new Map<number, Array<{ slot: number; yOffUnits: number; rotation: number }>>();
    // Frame index cache to avoid recomputing cumulative offsets (null = no frame lengths)
    private frameOffsetCache = new Map<number, number[] | null>();

    constructor(
        private renderer: WebGLOsrsRenderer,
        private mgr: GfxManager,
    ) {
        this.cache = new GfxCache(renderer);
        this.gpuCache = new SpotAnimGpuCache(renderer, this.cache, 192);
    }

    getCache(): GfxCache {
        return this.cache;
    }

    /** Drops every graphic's geometry and timing, CPU and GPU (custom graphics changed). */
    clear(): void {
        this.cache.clear();
        this.gpuCache.clear();
        this.frameOffsetCache.clear();
    }

    getGpuCache(): SpotAnimGpuCache {
        return this.gpuCache;
    }

    /**
     * Clear and return the reusable groups map to avoid per-frame allocation.
     */
    private getReusableGroupsMap(): Map<string, Array<{ slot: number; yOffUnits: number; rotation: number }>> {
        // Clear all arrays in the map and clear the map itself
        for (const arr of this.reusableGroupsMap.values()) {
            arr.length = 0;
        }
        this.reusableGroupsMap.clear();
        return this.reusableGroupsMap;
    }

    /**
     * Clear and return the reusable y-offset map to avoid per-frame allocation.
     */
    private getReusableYOffsetMap(): Map<number, Array<{ slot: number; yOffUnits: number; rotation: number }>> {
        for (const arr of this.reusableYOffsetMap.values()) {
            arr.length = 0;
        }
        this.reusableYOffsetMap.clear();
        return this.reusableYOffsetMap;
    }

    /** Render attached actor effects (players and NPCs) for a given map/pass using actorDataTexture. */
    renderMapPass(
        map: WebGLMapSquare,
        actorDataTexture: Texture | undefined,
        pass: Pass,
        offsets: { player?: number; npc?: number; world?: number } = {},
    ): void {
        if (!actorDataTexture) return;
        const playerOffset =
            offsets.player !== undefined && offsets.player !== -1 ? offsets.player | 0 : undefined;
        const npcOffset =
            offsets.npc !== undefined && offsets.npc !== -1 ? offsets.npc | 0 : undefined;
        const worldOffset =
            offsets.world !== undefined && offsets.world !== -1 ? offsets.world | 0 : undefined;
        if (playerOffset === undefined && npcOffset === undefined && worldOffset === undefined)
            return;

        const transparent = pass === "alpha";
        const nowMs = (performance?.now?.() as number) || Date.now();
        const prog = transparent
            ? (this.renderer as any).npcProgram
            : ((this.renderer as any).npcProgramOpaque ?? (this.renderer as any).npcProgram);
        if (!prog) return;
        const programKey = transparent ? "npc-alpha" : "npc-opaque";

        // A boat deck's overlay map is drawn where the boat is: its world graphics take the map's
        // render position, the boat's transform and the deck's height, as players aboard do.
        // Where the map is drawn (an instance scene's base), as its actors are placed from.
        const mapPos = vec2.fromValues(map.renderPosX, map.renderPosY);
        const r: any = this.renderer;
        const deckView = r.osrsClient?.worldViewManager?.getWorldViewByOverlayMapId?.(map.id);
        const deckEntity = deckView ? r.getWorldEntityIndexForMapId?.(map.id) : undefined;
        const deck =
            deckView && deckEntity !== undefined
                ? {
                      mapPos: vec2.fromValues(map.renderPosX, map.renderPosY),
                      transform:
                          r.worldEntityAnimator?.getTransform(deckEntity) ??
                          WebGLMapSquare.IDENTITY_MAT4,
                      yOffset: (r.getWorldEntityDeckHeight?.(0, 0) ?? 0) | 0,
                  }
                : undefined;

        const renderAttachments = <T extends { inst: GfxInstance; slot: number }>(
            entries: T[],
            baseOffset: number | undefined,
            resolveYOffset: (entry: T) => number,
            onDeck = false,
        ) => {
            if (baseOffset === undefined) return;
            if (entries.length === 0) return;

            const groups = this.getReusableGroupsMap();
            for (const entry of entries) {
                const { inst, slot } = entry;
                if (inst.startTimeMs == null) continue;
                const ageMs = graphicAgeMs(inst,nowMs);
                const frameIdx = this.computeSpotFrameIdxByMs(inst.spotId, Math.floor(ageMs));

                // The graphic's frame sounds, once per frame change (shared with the WebGPU renderer).
                dispatchGfxFrameSounds(this.renderer.osrsClient, inst, frameIdx, entry as any);
                const frameCycle = this.cache.smoothingCycle(
                    inst.spotId,
                    frameIdx,
                    graphicFrameCycle(
                        this.getFrameOffsets(inst.spotId),
                        Math.floor(ageMs),
                        frameIdx,
                    ),
                );
                const key = `${inst.spotId}|${frameIdx}|${frameCycle}|${inst.hueShift??0}`;
                const arr = groups.get(key) ?? [];
                const yOffUnits = resolveYOffset(entry) | 0;
                // The actor's facing, which the shader turns attached graphics by.
                const owner: any = entry;
                const mv: any = this.renderer.osrsClient;
                const rotation = typeof owner.pid === "number"
                    ? (mv.playerEcs?.getRotation?.(owner.pid | 0) ?? 0) & 2047
                    : typeof owner.ecsId === "number"
                        ? (mv.npcEcs?.getRotation?.(owner.ecsId | 0) ?? 0) & 2047
                        : 0;
                arr.push({ slot, yOffUnits, rotation });
                if (!groups.has(key)) groups.set(key, arr);
            }

            for (const [key, instances] of groups) {
                if (instances.length === 0) continue;
                const [spotStr, frameStr, cycleStr, hueStr] = key.split("|");
                const spotId = parseInt(spotStr, 10) | 0;
                const frameIdx = parseInt(frameStr, 10) | 0;
                const frameCycle = parseInt(cycleStr, 10) | 0;
                const vaoRec = this.gpuCache.getOrCreate(
                    spotId,
                    frameIdx,
                    transparent,
                    programKey,
                    prog,
                    frameCycle,
                );
                if (!vaoRec) continue;
                // Translucent layers of several priorities (the Echo Amoxliatl icicle's shells)
                // are painted in the OSRS painter's order: colour without depth writes, then depth.
                const painterGeometry = transparent
                    ? this.cache.ensureFrameGeometry(spotId, frameIdx, true, frameCycle)
                    : undefined;
                const painter = !!painterGeometry &&
                    hasMixedPriorities(painterGeometry.vertices, painterGeometry.indices, painterGeometry.facePriorities);
                const dc: DrawCall = this.renderer
                    .configureDrawCall(vaoRec.drawCall)
                    .uniformBlock("SceneUniforms", (this.renderer as any).sceneUniformBuffer)
                    .uniform("u_timeLoaded", -1.0)
                    .texture("u_textures", (this.renderer as any).textureArray)
                    .texture("u_textureMaterials", (this.renderer as any).textureMaterials)
                    .texture("u_waterTextures", (this.renderer as any).waterTextures)
                    .uniform("u_worldEntityOpacity", 1.0)
                    .uniform("u_mapPos", onDeck && deck ? deck.mapPos : mapPos)
                    .uniform("u_npcDataOffset", baseOffset | 0)
                    .uniform(
                        "u_worldEntityTransform",
                        onDeck && deck ? deck.transform : WebGLMapSquare.IDENTITY_MAT4,
                    )
                    .texture("u_npcDataTexture", actorDataTexture)
                    .texture("u_heightMap", map.heightMapTexture)
                    .texture("u_waterMask", map.waterMaskTexture)
                    .uniform("u_sceneBorderSize", map.borderSize);

                (this.renderer as any).app.disable(PicoGL.CULL_FACE);

                const yOffsetGroups = this.getReusableYOffsetMap();
                for (const inst of instances) {
                    const yOff = inst.yOffUnits | 0;
                    let group = yOffsetGroups.get(yOff);
                    if (!group) {
                        group = [];
                        yOffsetGroups.set(yOff, group);
                    }
                    group.push(inst);
                }

                for (const [yOff, groupInstances] of yOffsetGroups) {
                    dc.uniform("u_modelYOffset", (yOff + (onDeck && deck ? deck.yOffset : 0)) | 0);
                    for (const inst of groupInstances) {
                        dc.uniform("u_drawIdOverride", inst.slot | 0);
                        dc.uniform("u_visualHueShift", Number(hueStr)/360);
                        if (painter) {
                            const sorted = getPainterIndices(`${key}|a`, painterGeometry!.vertices,
                                painterGeometry!.indices, (this.renderer as any).osrsClient.camera.viewMatrix,
                                inst.rotation, painterGeometry!.facePriorities);
                            const ib: any = vaoRec.ib;
                            if (ib.painterKey !== sorted.key) {
                                ib.data(sorted.indices);
                                ib.painterKey = sorted.key;
                            }
                        }
                        const app: any = (this.renderer as any).app;
                        try {
                            if (painter) app.depthMask(false);
                            dc.draw();
                            if (painter) {
                                app.depthMask(true).colorMask(false, false, false, false);
                                dc.draw();
                            }
                        } finally {
                            if (painter) app.depthMask(true).colorMask(true, true, true, true);
                            (prog as any).uniform("u_visualHueShift", 0);
                        }
                    }
                }

                if ((this.renderer as any).cullBackFace)
                    (this.renderer as any).app.enable(PicoGL.CULL_FACE);
            }
        };

        if (playerOffset !== undefined) {
            const playerEntries = this.mgr.getAttachedPlayersForMap(map);
            renderAttachments(playerEntries, playerOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units;
                }
                return 0;
            });
        }

        if (npcOffset !== undefined) {
            const npcEntries = this.mgr.getAttachedNpcsForMap(map);
            renderAttachments(npcEntries, npcOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units;
                }
                return 0;
            });
        }

        if (worldOffset !== undefined) {
            const worldEntries = this.mgr.getWorldInstancesForMap(map);
            renderAttachments(worldEntries, worldOffset, ({ inst }) => {
                if (inst.anchor === "offset") {
                    const tiles = inst.yOffsetTiles ?? inst.world?.heightOffsetTiles ?? 0;
                    const units = Math.round(tiles * 128);
                    return units + TILE_GFX_LIFT_UNITS;
                }
                return TILE_GFX_LIFT_UNITS;
            }, true);
        }
    }

    /**
     * Get or compute cumulative frame offsets for fast frame index lookup.
     * Cached per spotId to avoid recomputation.
     */
    private getFrameOffsets(spotId: number): number[] | null {
        let offsets = this.frameOffsetCache.get(spotId);
        if (offsets !== undefined) {
            return offsets;
        }

        const lengths = this.cache.getFrameLengths(spotId);
        if (!lengths || lengths.length === 0) {
            this.frameOffsetCache.set(spotId, null);
            return null;
        }

        // Precompute cumulative offsets for O(1) binary search
        offsets = new Array(lengths.length);
        let acc = 0;
        for (let i = 0; i < lengths.length; i++) {
            acc += Math.max(1, lengths[i] | 0);
            offsets[i] = acc;
        }
        this.frameOffsetCache.set(spotId, offsets);
        return offsets;
    }

    private computeSpotFrameIdxByMs(spotId: number, ageMs: number): number {
        try {
            const cycles = Math.max(0, Math.floor((ageMs | 0) / 20));
            const offsets = this.getFrameOffsets(spotId);

            if (offsets && offsets.length > 0) {
                const total = offsets[offsets.length - 1];
                const t = total > 0 ? ((cycles % total) + total) % total : cycles % offsets.length;

                // Binary search through cumulative offsets
                let low = 0;
                let high = offsets.length - 1;
                while (low < high) {
                    const mid = (low + high) >>> 1;
                    if (t < offsets[mid]) {
                        high = mid;
                    } else {
                        low = mid + 1;
                    }
                }
                return low | 0;
            }

            const fc = Math.max(1, this.cache.getFrameCount(spotId) | 0);
            return ((cycles % fc) + fc) % fc;
        } catch {
            return 0;
        }
    }
}
