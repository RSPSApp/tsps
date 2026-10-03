import { getClientCycleFloat } from "../../network/ServerConnection";
import type {
    ProjectileActorRef,
    ProjectileEndpoint,
    ProjectileLaunch,
} from "../../common/projectiles/ProjectileLaunch";
import { IProjectileManager } from "../../game/interfaces/IProjectileManager";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import { BridgePlaneStrategy } from "../../game/scene/PlaneResolver";
import type { WebGLOsrsRenderer } from "../WebGLOsrsRenderer";
import { Projectile, ProjectileConfig } from "./Projectile";

// --- Constants & Configuration ---

const CONSTANTS = {
    TILE_SIZE: 128,
    MAP_SIZE: 64, // 64x64 tiles per map square
};

// --- Helper Types ---

type EntityType = ProjectileActorRef["kind"];

interface DynamicSourceMeta {
    actor: ProjectileActorRef;
    plane: number;
    sourceHeight: number;
}

interface DynamicTargetMeta {
    actor: ProjectileActorRef;
    plane: number;
}

// --- Sub-System: Entity & Target Resolution ---

/**
 * Handles looking up Players and NPCs from the ECS and resolving their specific
 * coordinate points (accounting for OSRS Chest/Head height logic).
 */
class ProjectileTargetSystem {
    constructor(private renderer: WebGLOsrsRenderer) {}

    public getEntityPosition(
        type: EntityType,
        serverId: number,
        plane?: number,
    ): { x: number; y: number; plane: number } | null {
        const osrs = this.renderer.osrsClient;
        if (!osrs) return null;

        if (type === "player") {
            const idx = osrs.playerEcs?.getIndexForServerId(serverId);
            if (idx === undefined) return null;
            return {
                x: osrs.playerEcs.getX(idx),
                y: osrs.playerEcs.getY(idx),
                plane: Number.isFinite(plane)
                    ? (plane as number) | 0
                    : osrs.playerEcs.getLevel(idx),
            };
        } else if (type === "npc") {
            const npcEcs = osrs.npcEcs;
            const ecsId = npcEcs?.getEcsIdForServer?.(serverId);
            if (ecsId === undefined || !npcEcs.isActive(ecsId) || !npcEcs.isLinked(ecsId)) {
                return null;
            }
            // NPCs are stored in local map coords, convert to World
            const npcX = npcEcs.getX(ecsId);
            const npcY = npcEcs.getY(ecsId);
            const mapId = npcEcs.getMapId(ecsId);
            const worldX = ((mapId >> 8) << 13) + npcX;
            const worldY = ((mapId & 0xff) << 13) + npcY;
            const worldPlane = npcEcs.getLevel(ecsId);
            return {
                x: worldX,
                y: worldY,
                plane: Number.isFinite(plane) ? (plane as number) | 0 : worldPlane,
            };
        }
        return null;
    }

    public isLocalPlayer(serverId: number): boolean {
        const osrs = this.renderer.osrsClient;
        return osrs?.controlledPlayerServerId === serverId;
    }
}

// --- Main Class ---

/**
 * Manages active projectiles.
 * Refactored for strict  and maintainability.
 */
export class ProjectileManager implements IProjectileManager {
    private nextId = 1;

    // State
    private projectiles = new Map<number, Projectile>();
    private dynamicTargets = new Map<number, DynamicTargetMeta>();
    private dynamicSources = new Map<number, DynamicSourceMeta>(); // Sources are tracked until launch

    // Reusable buffer for getProjectilesForMap (avoids per-call allocation)
    private projectilesForMapBuffer: Projectile[] = [];

    // Time Tracking
    private simCycle: number = NaN; // The integer client cycle we are currently simulating
    private lastAdvanceTime: number = NaN; // The raw client-cycle time of the last update

    // Sub-systems
    private targetSystem: ProjectileTargetSystem;

    constructor(private renderer: WebGLOsrsRenderer) {
        this.targetSystem = new ProjectileTargetSystem(renderer);
    }

    // =========================================================================
    //  Time & Cycle Management
    // =========================================================================

    private getCurrentCycleFloat(): number {
        return getClientCycleFloat();
    }

    private getCurrentTick(): number {
        if (Number.isFinite(this.simCycle)) return this.simCycle;
        return Math.floor(this.getCurrentCycleFloat());
    }

    /**
     * Gets ground height in world units.
     * Renderer height sampling already uses negative-up tile heights.
     * We keep that sign and scale to 128-unit world space.
     */
    private getGroundHeight(x: number, y: number, plane: number): number {
        try {
            const r: any = this.renderer as any;
            const mm = r.mapManager;
            if (mm) {
                // projectile Z is solved against getTileHeight(..., Client_plane),
                // i.e. height sampling uses the render/height plane (bridge-promoted), not the
                // interaction/roof plane.
                const sample = sampleBridgeHeightForWorldTile(
                    mm,
                    x / CONSTANTS.TILE_SIZE,
                    y / CONSTANTS.TILE_SIZE,
                    plane,
                    BridgePlaneStrategy.RENDER,
                );
                if (Number.isFinite(sample.height)) {
                    return sample.height * CONSTANTS.TILE_SIZE;
                }
            }

            // Fallback to renderer helper (render-plane strategy).
            const h = r.getApproxTileHeight?.(
                x / CONSTANTS.TILE_SIZE,
                y / CONSTANTS.TILE_SIZE,
                plane,
            );
            if (Number.isFinite(h)) {
                return (h as number) * CONSTANTS.TILE_SIZE;
            }
        } catch {}
        return 0;
    }

    private tileToWorldCenter(tile: number): number {
        return tile * CONSTANTS.TILE_SIZE + (CONSTANTS.TILE_SIZE >> 1);
    }

    private resolveEndpointPosition(endpoint: ProjectileEndpoint): {
        x: number;
        y: number;
        ground: number;
        plane: number;
    } {
        const actor = endpoint.actor;
        if (actor) {
            const actorPosition = this.targetSystem.getEntityPosition(
                actor.kind,
                actor.serverId,
                endpoint.plane,
            );
            if (actorPosition) {
                return {
                    x: actorPosition.x,
                    y: actorPosition.y,
                    ground: this.getGroundHeight(
                        actorPosition.x,
                        actorPosition.y,
                        actorPosition.plane,
                    ),
                    plane: actorPosition.plane,
                };
            }
        }

        const x = this.tileToWorldCenter(endpoint.tileX);
        const y = this.tileToWorldCenter(endpoint.tileY);
        return {
            x,
            y,
            ground: this.getGroundHeight(x, y, endpoint.plane),
            plane: endpoint.plane,
        };
    }

    // =========================================================================
    //  Launch Logic
    // =========================================================================

    public launch(launch: ProjectileLaunch): number {
        const receiptCycle = Math.floor(this.getCurrentCycleFloat());
        const startCycle = receiptCycle + launch.startCycleOffset;
        const endCycle =
            receiptCycle + Math.max(launch.startCycleOffset + 1, launch.endCycleOffset);
        const source = this.resolveEndpointPosition(launch.source);
        const target = this.resolveEndpointPosition(launch.target);

        const id = this.nextId++;
        const config: ProjectileConfig = {
            projectileId: launch.projectileId,
            debugId: id,
            sourceX: source.x,
            sourceY: source.y,
            sourceZ: source.ground - launch.sourceHeight,
            targetX: target.x,
            targetY: target.y,
            targetGroundZ: target.ground,
            startCycle,
            endCycle,
            startPos: launch.startPos,
            sourceHeight: launch.sourceHeight,
            endHeight: launch.endHeight,
            slope: launch.slope,
            plane: launch.source.plane,
            ...this.getGfxFrameData(launch.projectileId),
        };

        const projectile = new Projectile(config);
        this.projectiles.set(id, projectile);
        this.setupDynamicTracking(id, launch);

        if (receiptCycle >= startCycle) {
            projectile.trackTarget(receiptCycle);
            // OSRS updates already-active projectiles on the same client cycle they spawn.
            const catchUpCycles = Math.min(1, Math.max(0, projectile.endCycleExact - receiptCycle));
            if (catchUpCycles > 0) {
                projectile.advance(catchUpCycles);
            } else {
                projectile.snapToTarget();
            }
        }

        return id;
    }

    private getGfxFrameData(gfxId: number) {
        try {
            const cache = (this.renderer as any).gfxRenderer?.getCache?.();
            return {
                frameLengths: cache?.getFrameLengths(gfxId),
                frameCount: cache?.getFrameCount(gfxId),
            };
        } catch {
            return { frameCount: 1 };
        }
    }

    private setupDynamicTracking(id: number, launch: ProjectileLaunch) {
        const sourceActor = launch.source.actor;
        if (sourceActor) {
            this.dynamicSources.set(id, {
                actor: sourceActor,
                plane: launch.source.plane | 0,
                sourceHeight: launch.sourceHeight,
            });
        }

        const targetActor = launch.target.actor;
        if (targetActor) {
            this.dynamicTargets.set(id, {
                actor: targetActor,
                plane: launch.target.plane | 0,
            });
        }
    }

    // =========================================================================
    //  Update Loop (The Core)
    // =========================================================================

    public update(deltaTimeMs?: number): void {
        const currentCycleRaw = this.getCurrentCycleFloat();
        const targetTick = Math.floor(currentCycleRaw);

        // Initialize Sim Cycle if first run
        if (!Number.isFinite(this.simCycle) || !Number.isFinite(this.lastAdvanceTime)) {
            this.simCycle = targetTick;
            this.lastAdvanceTime = currentCycleRaw;
            return;
        }

        // We need to solve each integer boundary before advancing through that cycle,
        // mirroring OSRS order: setDestination(cycle) then advance(graphicsCycle).
        let t = this.lastAdvanceTime;
        let boundariesProcessed = 0;
        const MAX_BOUNDARIES_PER_UPDATE = 10;

        while (t < currentCycleRaw && boundariesProcessed < MAX_BOUNDARIES_PER_UPDATE) {
            const nextBoundary = Math.min(Math.floor(t) + 1, currentCycleRaw);
            const step = nextBoundary - t;

            const intTick = Math.floor(nextBoundary + 1e-6);
            if (Math.abs(nextBoundary - intTick) < 1e-6 && intTick > this.simCycle) {
                this.simCycle = intTick;
                this.updateDiscreteTick(intTick);
                boundariesProcessed++;
            }

            if (step > 0) {
                this.updateContinuousFrame(step, nextBoundary);
                t = nextBoundary;
            } else {
                t = nextBoundary;
            }
        }

        // If we are still behind (tab background throttling), fast-forward the rest without
        // discrete solves to avoid spiraling.
        if (t < currentCycleRaw) {
            const remaining = Math.min(1.5, currentCycleRaw - t);
            if (remaining > 0) {
                this.updateContinuousFrame(remaining, currentCycleRaw);
            }
        }

        this.lastAdvanceTime = currentCycleRaw;
    }

    /**
     * Handles logic that happens exactly once per Game Tick.
     * - Updating Dynamic Target positions
     * - Releasing Source Tethers
     * - Calculating Trajectory for the current tick
     */
    private updateDiscreteTick(tick: number): void {
        for (const [id, projectile] of this.projectiles) {
            // A. Update Target Position (Homing)
            const targetMeta = this.dynamicTargets.get(id);
            if (targetMeta) {
                this.applyTargetActorToProjectile(projectile, targetMeta);
            }

            // B. Update Source Position (Tethering - only before launch)
            const sourceMeta = this.dynamicSources.get(id);
            if (sourceMeta) {
                if (!projectile.hasStarted()) {
                    this.applySourceActorToProjectile(projectile, sourceMeta);
                } else {
                    // OSRS behavior: Once it flies, it detaches from source
                    this.dynamicSources.delete(id);
                }
            }

            // C. Validate Start Height (Fix for late map loads)
            // If the map loaded *after* spawn, the ground height was 0. Fix it now.
            if (tick === projectile.startCycle + 1) {
                this.validateSourceHeight(projectile);
            }

            // D. Physics Solve
            if (tick >= projectile.startCycle && tick <= projectile.endCycle + 1) {
                projectile.trackTarget(tick);
            }
        }
    }

    /**
     * Handles visual interpolation between ticks.
     */
    private updateContinuousFrame(delta: number, absoluteTime: number): void {
        const stepStartTime = absoluteTime - delta;
        for (const [id, projectile] of this.projectiles) {
            // Wait until start time; clamp partial-step that crosses spawn.
            if (absoluteTime <= projectile.startCycle) continue;
            const effectiveDelta =
                stepStartTime < projectile.startCycle
                    ? absoluteTime - projectile.startCycle
                    : delta;

            // Advance visual state
            const remaining = Math.max(0, projectile.endCycleExact - absoluteTime);

            // Calculate step (don't overshoot)
            const step = Math.min(effectiveDelta, remaining);

            if (step > 0) {
                projectile.advance(step);
            } else {
                projectile.snapToTarget();
            }

            // Expiry Check
            if (absoluteTime >= projectile.endCycleExact - 1e-4) {
                this.removeProjectile(id);
            }
        }
    }

    private applySourceActorToProjectile(projectile: Projectile, meta: DynamicSourceMeta): void {
        const pos = this.targetSystem.getEntityPosition(
            meta.actor.kind,
            meta.actor.serverId,
            meta.plane,
        );
        if (!pos) return;

        const ground = this.getGroundHeight(pos.x, pos.y, pos.plane);
        projectile.setSource(pos.x, pos.y, ground - meta.sourceHeight);
    }

    private applyTargetActorToProjectile(projectile: Projectile, meta: DynamicTargetMeta): void {
        const pos = this.targetSystem.getEntityPosition(
            meta.actor.kind,
            meta.actor.serverId,
            meta.plane,
        );
        if (!pos) return;

        const ground = this.getGroundHeight(pos.x, pos.y, pos.plane);
        projectile.setTarget(pos.x, pos.y, ground, true);
    }

    private validateSourceHeight(projectile: Projectile): void {
        try {
            const s = projectile.getSource();
            const ground = this.getGroundHeight(s.x, s.y, projectile.plane);
            projectile.revalidateSourceHeight(ground);
        } catch {}
    }

    // =========================================================================
    //  Lifecycle & cleanup
    // =========================================================================

    public remove(id: number): void {
        this.removeProjectile(id);
    }

    private removeProjectile(id: number): void {
        this.projectiles.delete(id);
        this.dynamicTargets.delete(id);
        this.dynamicSources.delete(id);
    }

    public clear(): void {
        this.projectiles.clear();
        this.dynamicTargets.clear();
        this.dynamicSources.clear();
        this.simCycle = NaN;
    }

    // =========================================================================
    //  Public Getters / Interface Impl
    // =========================================================================

    public getActiveProjectiles(): Projectile[] {
        const tick = this.getCurrentTick();
        const out: Projectile[] = [];
        for (const p of this.projectiles.values()) {
            if (tick >= p.startCycle) out.push(p);
        }
        return out;
    }

    public getProjectilesForMap(mapX: number, mapY: number): Projectile[] {
        const tick = this.getCurrentTick();
        const out = this.projectilesForMapBuffer;
        out.length = 0; // Clear and reuse buffer
        // An instance scene is one map square: it draws every projectile in the scene, as it does
        // every NPC (a Gauntlet arena need not be in the square the scene is built as).
        const r: any = this.renderer as any;
        const scene = r.instanceActive ? r.instanceSceneMap : null;
        for (const p of this.projectiles.values()) {
            if (tick < p.startCycle) continue;

            const pos = p.getPosition();
            // Map check: X >> 13 gives map coordinate (8192 units per map)
            // Or using tiles: (X / 128) >> 6
            const pMapX = scene ? scene.mapX | 0 : pos.x >> 13;
            const pMapY = scene ? scene.mapY | 0 : pos.y >> 13;

            if (pMapX === mapX && pMapY === mapY) {
                out.push(p);
            }
        }
        return out;
    }

    public getCount(): number {
        return this.projectiles.size;
    }

    public isLocalCaster(p: Projectile): boolean {
        // Reverse lookup source meta (slow, but rare)
        for (const [id, meta] of this.dynamicSources) {
            if (this.projectiles.get(id) === p && meta.actor.kind === "player") {
                return this.targetSystem.isLocalPlayer(meta.actor.serverId);
            }
        }
        return false;
    }
}
