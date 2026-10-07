import { vec2 } from "gl-matrix";
import { DrawCall, Texture } from "picogl";

import type { WebGLMapSquare } from "../WebGLMapSquare";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import type { GfxCache } from "../gfx/GfxCache";
import type { SpotAnimGpuCache, SpotAnimGpuRecord } from "../gfx/SpotAnimGpuCache";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import { BridgePlaneStrategy } from "../../game/scene/PlaneResolver";
import type { Projectile } from "./Projectile";
import type { ProjectileManager } from "./ProjectileManager";

type Pass = "opaque" | "alpha";
type ProjectileRenderGroup = {
    spotId: number;
    frameIdx: number;
    /** Cycles into the frame when animation smoothing blends it; 0 otherwise. */
    frameCycle: number;
    slots: number[];
};

/**
 * Renders projectiles using SpotAnimation models.
 * Uses the actor data texture system (like NPCs) for positioning.
 */
export class ProjectileRenderer {
    private gfxCache?: GfxCache;
    private gpuCache?: SpotAnimGpuCache;
    private reusableGroups = new Map<string, ProjectileRenderGroup>();
    // Tracks last frame per projectile for sound dispatch throttle
    private lastSoundFrame: WeakMap<Projectile, number> = new WeakMap();

    constructor(
        private renderer: WebGLOsrsRenderer,
        private projectileManager: ProjectileManager,
    ) {
        this.refreshSpotAnimCaches();
    }

    private refreshSpotAnimCaches(): boolean {
        const gfxRenderer = (this.renderer as any).gfxRenderer;
        this.gfxCache = gfxRenderer?.getCache();
        this.gpuCache = gfxRenderer?.getGpuCache?.();
        return !!this.gfxCache && !!this.gpuCache;
    }

    private resolveFrameIndex(spotId: number, projectile: Projectile): number {
        if (!this.gfxCache) return 0;
        const frameCount = Math.max(1, this.gfxCache.getFrameCount(spotId) | 0);
        const raw = projectile.animationFrame | 0;
        const wrapped = ((raw % frameCount) + frameCount) % frameCount;
        return wrapped;
    }

    private getOrCreateSpotAnimGpu(
        spotId: number,
        frameIdx: number,
        transparent: boolean,
        program: any,
        frameCycle: number = 0,
    ): SpotAnimGpuRecord | undefined {
        if (!program) return undefined;
        const programKey = transparent ? "projectile-alpha" : "projectile-opaque";
        return this.gpuCache?.getOrCreate(
            spotId,
            frameIdx,
            transparent,
            programKey,
            program,
            frameCycle,
        );
    }

    private getReusableGroups(): Map<string, ProjectileRenderGroup> {
        for (const group of this.reusableGroups.values()) {
            group.slots.length = 0;
        }
        this.reusableGroups.clear();
        return this.reusableGroups;
    }

    private getProjectileProgram(transparent: boolean): any | undefined {
        return transparent
            ? (this.renderer as any).projectileProgram
            : ((this.renderer as any).projectileProgramOpaque ??
                  (this.renderer as any).projectileProgram);
    }

    private dispatchFrameSound(projectile: Projectile, spotId: number, frameIdx: number): void {
        if (this.lastSoundFrame.get(projectile) === frameIdx) return;

        try {
            const mv: any = this.renderer.osrsClient as any;
            const spot = mv.spotAnimTypeLoader?.load?.(spotId | 0);
            const seqId: number = typeof spot?.sequenceId === "number" ? spot.sequenceId | 0 : -1;
            if (seqId >= 0) {
                const seqType = mv.seqTypeLoader?.load?.(seqId | 0);
                if (seqType && seqType.frameSounds?.size) {
                    const p = projectile.getPosition();
                    const isLocal =
                        (this.projectileManager as any)?.isLocalCaster?.(projectile) ?? false;
                    mv.handleSeqFrameSounds(seqType, frameIdx | 0, {
                        position: {
                            x: p.x | 0,
                            y: p.y | 0,
                            z: (projectile.plane | 0) * 128,
                        },
                        isLocalPlayer: !!isLocal,
                        debugSeqId: seqId | 0,
                        debugFrame: frameIdx | 0,
                    });
                }
            }
        } catch {}

        this.lastSoundFrame.set(projectile, frameIdx | 0);
    }

    private collectProjectileGroups(projectiles: Projectile[]): Map<string, ProjectileRenderGroup> {
        const groups = this.getReusableGroups();

        for (let slot = 0; slot < projectiles.length; slot++) {
            const projectile = projectiles[slot];
            const spotId = projectile.projectileId | 0;
            const frameIdx = this.resolveFrameIndex(spotId, projectile);
            this.dispatchFrameSound(projectile, spotId, frameIdx);
            const frameCycle =
                this.gfxCache?.smoothingCycle(spotId, frameIdx, projectile.getFrameCycle()) ?? 0;

            const key = `${spotId}|${frameIdx}|${frameCycle}`;
            let group = groups.get(key);
            if (!group) {
                group = { spotId, frameIdx, frameCycle, slots: [] };
                groups.set(key, group);
            }
            group.slots.push(slot);
        }

        return groups;
    }

    private configureProjectileDrawCall(
        vaoDrawCall: DrawCall,
        map: WebGLMapSquare,
        baseOffset: number,
        actorDataTexture: Texture,
        subOffset: vec2,
    ): DrawCall {
        return this.renderer
            .configureDrawCall(vaoDrawCall)
            .uniformBlock("SceneUniforms", (this.renderer as any).sceneUniformBuffer)
            .uniform("u_timeLoaded", -1.0)
            .texture("u_textures", (this.renderer as any).textureArray)
            .texture("u_textureMaterials", (this.renderer as any).textureMaterials)
            .texture("u_waterTextures", (this.renderer as any).waterTextures)
            .uniform("u_worldEntityOpacity", 1.0)
            // Where the map is drawn: its corner, or an instance's scene base.
            .uniform("u_mapPos", vec2.fromValues(map.renderPosX, map.renderPosY))
            .uniform("u_npcDataOffset", baseOffset | 0)
            .texture("u_npcDataTexture", actorDataTexture)
            .texture("u_heightMap", map.heightMapTexture)
            .texture("u_waterMask", map.waterMaskTexture)
            .uniform("u_sceneBorderSize", map.borderSize)
            .uniform("u_projectileSubOffset", subOffset);
    }

    private resolveModelYOffset(
        projectile: Projectile,
        pos: { x: number; y: number; z: number },
    ): number {
        let heightOffset = pos.z;
        try {
            const sample = sampleBridgeHeightForWorldTile(
                (this.renderer as any).mapManager,
                pos.x / 128,
                pos.y / 128,
                projectile.plane | 0,
                BridgePlaneStrategy.RENDER,
            );
            if (sample.valid && Number.isFinite(sample.height)) {
                heightOffset = sample.height * 128 - pos.z;
            }
        } catch {}
        return heightOffset;
    }

    /**
     * Render projectiles for a given map using actor data texture
     */
    renderMapPass(
        map: WebGLMapSquare,
        baseOffset: number,
        actorDataTexture: Texture | undefined,
        pass: Pass,
    ): void {
        if (!this.refreshSpotAnimCaches() || !this.gfxCache || !actorDataTexture) return;
        if (!map.projectileDataTextureOffsets || baseOffset === -1) return;

        const transparent = pass === "alpha";
        const prog = this.getProjectileProgram(transparent);
        if (!prog) return;

        // Get projectiles in this map region
        const projectiles = this.projectileManager.getProjectilesForMap(map.mapX, map.mapY);
        if (projectiles.length === 0) return;

        const groups = this.collectProjectileGroups(projectiles);
        const app = (this.renderer as any).app;

        // Glow projectiles use nested translucent shells. Keep depth testing against
        // the scene, but let every shell blend instead of the outer one hiding the rest.
        if (transparent) app.depthMask(false);

        const mapWorldX = map.getRenderBaseTileX() * 128;
        const mapWorldY = map.getRenderBaseTileY() * 128;

        for (const group of groups.values()) {
            const vaoRec = this.getOrCreateSpotAnimGpu(
                group.spotId,
                group.frameIdx,
                transparent,
                prog,
                group.frameCycle,
            );
            if (!vaoRec) {
                continue;
            }

            const subOffset = vec2.create();
            const dc = this.configureProjectileDrawCall(
                vaoRec.drawCall,
                map,
                baseOffset,
                actorDataTexture,
                subOffset,
            );

            for (const slot of group.slots) {
                const proj = projectiles[slot];
                const pos = proj.getPosition();
                const relativeXf = pos.x - mapWorldX;
                const relativeYf = pos.y - mapWorldY;
                const fracX = relativeXf - Math.floor(relativeXf);
                const fracY = relativeYf - Math.floor(relativeYf);

                dc.uniform("u_drawIdOverride", slot | 0);
                dc.uniform("u_modelYOffset", this.resolveModelYOffset(proj, pos));
                vec2.set(subOffset, fracX, fracY);
                dc.uniform("u_projectileSubOffset", subOffset);
                dc.draw();
            }

            dc.uniform("u_drawIdOverride", -1);
            vec2.set(subOffset, 0, 0);
            dc.uniform("u_projectileSubOffset", subOffset);
        }

        if (transparent) app.depthMask(true);
    }
}
