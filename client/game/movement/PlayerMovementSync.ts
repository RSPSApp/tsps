import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { faceAngleRs } from "../../rs/utils/rotation";
import {
    MovementDirection,
    deltaToDirection,
    directionToDelta,
    directionToOrientation,
} from "../../common/Direction";
import { PlayerAnimController } from "../PlayerAnimController";
import type { NpcEcs } from "../ecs/NpcEcs";
import { PlayerEcs } from "../ecs/PlayerEcs";
import type { ResolveTilePlaneFn } from "../scene/PlaneResolver";
import type { MovementStep, TileCoord } from "./MovementPath";
import { MovementPath } from "./MovementPath";
import { MovementState, MovementStateInit } from "./MovementState";
import type {
    MovementStateOptions,
    MovementUpdate,
    RegisterMovementEntity,
} from "./MovementSyncTypes";
import { type CollisionFlagAtFn, OsrsRouteFinder32 } from "./OsrsRouteFinder32";

function toTileCoord(subCoord: number): number {
    return (subCoord | 0) >> 7;
}

/**
 * Server-authoritative player movement bridge.
 *
 * Translates per-tick server movement updates (directions / traversals / snap)
 * into ECS interpolation commands, with bounded local anticipation for WASD.
 * There is no intermediate waypoint queue;
 * steps are pushed directly to the ECS ring buffer, matching the OSRS client's
 * `appendPathStep` / `setPathPosition` model.
 *
 * Matches the setPathPosition / appendPathStep / interpolateActor / updateMovement model.
 */
/** Where boats' decks are in the world: a deck position projected to world fine units, and a boat's orientation. */
export interface WorldEntityPlacement {
    projectDeckToWorld(entityIndex: number, fineX: number, fineY: number): { x: number; y: number } | undefined;
    orientationOf(entityIndex: number): number | undefined;
}

export class PlayerMovementSync {
    private readonly states = new Map<number, MovementState>();
    private readonly routeFinder = new OsrsRouteFinder32();
    private serverTickMs = 600;
    private keyboardPrediction?: {
        serverId: number;
        steps: TileCoord[];
        expiresAt: number;
        expired: boolean;
        stopped: boolean;
    };

    constructor(
        private readonly playerEcs: PlayerEcs,
        private readonly animController?: PlayerAnimController,
        private readonly resolveTilePlane?: ResolveTilePlaneFn,
        private readonly npcEcs?: NpcEcs,
        private readonly seqTypeLoader?: SeqTypeLoader,
        private readonly getCollisionFlagAt?: CollisionFlagAtFn,
        private readonly worldEntities?: WorldEntityPlacement,
    ) {
        this.playerEcs.setInteractionOrientationProvider?.((ecsIndex) =>
            this.computeInteractionOrientation(ecsIndex),
        );
    }

    /**
     * Clears all pending movement for the given serverId.
     * Used by local actions (e.g. spell casts) that should immediately stop the player.
     */
    clearMovementFor(serverId: number): void {
        if (this.keyboardPrediction?.serverId === serverId) this.keyboardPrediction = undefined;
        const state = this.states.get(serverId);
        if (!state) return;
        const ecsIndex = state.ecsIndex;
        if (ecsIndex >= 0) {
            try {
                this.playerEcs.clearServerQueue(ecsIndex);
            } catch {}
        }
    }

    setServerTickMs(ms: number): void {
        this.serverTickMs = Math.max(1, ms | 0);
        try {
            this.playerEcs.setServerTickMs(ms | 0);
        } catch {}
    }

    registerEntity(info: RegisterMovementEntity): MovementState {
        const subX = info.subX | 0;
        const subY = info.subY | 0;
        const tile = { x: toTileCoord(subX), y: toTileCoord(subY) };
        const effectiveLevel = this.resolveTilePlane
            ? this.resolveTilePlane(tile.x, tile.y, info.level)
            : info.level;
        const init: MovementStateInit = {
            serverId: info.serverId,
            ecsIndex: info.ecsIndex,
            tile,
            level: effectiveLevel,
            subX,
            subY,
        };
        const state = new MovementState(init);
        this.states.set(info.serverId, state);
        return state;
    }

    unregister(serverId: number): void {
        if (this.keyboardPrediction?.serverId === serverId) this.keyboardPrediction = undefined;
        this.states.delete(serverId);
        try {
            this.animController?.release(serverId);
        } catch {}
    }

    // ── Server update entry point ───────────────────────────────────────

    /** Anticipate at most one tick of checked WASD steps, without changing the server tile. */
    predictKeyboardMovement(serverId: number, tiles: readonly TileCoord[], running: boolean): void {
        const state = this.states.get(serverId);
        if (!state || !tiles.length) return;
        if (this.keyboardPrediction) {
            if (this.keyboardPrediction.serverId === serverId) this.keyboardPrediction.stopped = false;
            return;
        }
        const index = state.ecsIndex;
        if (this.playerEcs.isForcedMovementActive(index, this.playerEcs.getClientCycle())) return;
        // Use the route finder's tile order, as server movement reconstruction does.
        const route = this.getKeyboardPath({ x: state.tileX, y: state.tileY }, tiles[tiles.length - 1], state.level, running);
        const steps = route?.slice(0, running ? 2 : 1).map(step => step.tile);
        if (!steps?.length) return;
        if (!this.playerEcs.trimQueuedStepsAfter(index, state.subX, state.subY)) return;
        let previous = { x: state.tileX, y: state.tileY };
        for (const tile of steps) {
            const direction = deltaToDirection(tile.x - previous.x, tile.y - previous.y);
            if (direction === undefined) return;
            if (!this.playerEcs.setServerPos(index, (tile.x << 7) + 64, (tile.y << 7) + 64,
                running ? 2 : 1, directionToOrientation(direction))) return;
            previous = tile;
        }
        this.playerEcs.setRunning(index, running);
        this.keyboardPrediction = { serverId, steps, expiresAt: Date.now() + this.serverTickMs * 2,
            expired: false, stopped: false };
    }

    stopKeyboardMovement(serverId: number): void {
        const prediction = this.keyboardPrediction;
        const state = this.states.get(serverId);
        if (!state || prediction?.serverId !== serverId) return;
        prediction.stopped = true;
        if (prediction.expired) {
            this.rewindKeyboardPrediction(state);
            this.keyboardPrediction = undefined;
            return;
        }
        if (this.playerEcs.trimQueuedStepsAfter(state.ecsIndex, state.subX, state.subY)) {
            prediction.steps = [];
            this.keyboardPrediction = undefined;
            return;
        }
        // Finish the active tile, but discard speculative steps that haven't started.
        const target = this.playerEcs.getMovementTarget(state.ecsIndex);
        const active = prediction.steps.findIndex(tile =>
            (tile.x << 7) + 64 === target.x && (tile.y << 7) + 64 === target.y);
        prediction.steps = prediction.steps.slice(0, active + 1);
        if (active < 0) {
            this.playerEcs.trimQueuedStepsAfter(state.ecsIndex, state.subX, state.subY);
            this.keyboardPrediction = undefined;
        } else this.playerEcs.clearQueuedSteps(state.ecsIndex);
    }

    private rewindKeyboardPrediction(state: MovementState): void {
        const prediction = this.keyboardPrediction;
        if (!prediction) return;
        const index = state.ecsIndex;
        const target = this.playerEcs.getMovementTarget(index);
        const active = prediction.steps.findIndex(tile =>
            (tile.x << 7) + 64 === target.x && (tile.y << 7) + 64 === target.y);
        this.playerEcs.clearServerQueue(index);
        // Retrace the checked tiles when the server rejects a step; don't cut a corner.
        for (const tile of prediction.steps.slice(0, Math.max(0, active)).reverse()) {
            this.playerEcs.setServerPos(index, (tile.x << 7) + 64, (tile.y << 7) + 64);
        }
        if (this.playerEcs.getX(index) !== state.subX || this.playerEcs.getY(index) !== state.subY) {
            this.playerEcs.setServerPos(index, state.subX, state.subY);
        }
        prediction.expired = true;
    }

    private getKeyboardPath(from: TileCoord, to: TileCoord, plane: number, running: boolean): MovementStep[] | undefined {
        let count = 1;
        if (this.getCollisionFlagAt) {
            count = this.routeFinder.findRouteSize1(from.x, from.y, to.x, to.y,
                plane, this.getCollisionFlagAt, false);
            if (count < 0) return undefined;
        }
        const steps: MovementStep[] = [];
        let x = from.x, y = from.y;
        for (let n = 0; n < count; n++) {
            const targetX = this.getCollisionFlagAt ? this.routeFinder.outX[n] : to.x;
            const targetY = this.getCollisionFlagAt ? this.routeFinder.outY[n] : to.y;
            while (x !== targetX || y !== targetY) {
                const dx = Math.sign(targetX - x), dy = Math.sign(targetY - y);
                x += dx;
                y += dy;
                steps.push({ tile: { x, y }, direction: deltaToDirection(dx, dy)!,
                    run: running, traversal: running ? 2 : 1 });
            }
        }
        return steps;
    }

    receiveUpdate(update: MovementUpdate): { path: MovementPath; teleported: boolean } {
        const directions = Array.isArray(update.directions)
            ? update.directions.map((dir) => (dir | 0) & 7)
            : [];
        const traversals = Array.isArray(update.traversals)
            ? update.traversals.map((t) => (t | 0) & 3)
            : [];
        let subX =
            typeof update.x === "number"
                ? update.x | 0
                : typeof update.subX === "number"
                  ? update.subX | 0
                  : undefined;
        let subY =
            typeof update.y === "number"
                ? update.y | 0
                : typeof update.subY === "number"
                  ? update.subY | 0
                  : undefined;

        const existingState = this.states.get(update.serverId);
        const isFirstAppearance = !existingState;

        const initialTile =
            subX !== undefined && subY !== undefined
                ? { x: toTileCoord(subX), y: toTileCoord(subY) }
                : existingState
                  ? { x: existingState.tileX, y: existingState.tileY }
                  : { x: 0, y: 0 };

        const effectiveLevel = this.resolveTilePlane
            ? this.resolveTilePlane(initialTile.x, initialTile.y, update.level | 0)
            : update.level | 0;
        update.level = effectiveLevel;

        const defaultSubX = (initialTile.x << 7) + 64;
        const defaultSubY = (initialTile.y << 7) + 64;
        const state = existingState
            ? existingState
            : this.registerEntity({
                  serverId: update.serverId,
                  ecsIndex: update.ecsIndex,
                  tile: initialTile,
                  level: effectiveLevel,
                  subX: typeof subX === "number" ? subX : defaultSubX,
                  subY: typeof subY === "number" ? subY : defaultSubY,
              });
        if (state.ecsIndex !== update.ecsIndex) {
            state.setEcsIndex(update.ecsIndex);
        }

        if (this.playerEcs.isContinuousMovement?.(update.ecsIndex)) {
            // Native tile sync still supplies interactions/appearance, but precise
            // snapshots own movement while the actor is between tile centres.
            state.setTile(initialTile, defaultSubX, defaultSubY, effectiveLevel);
            return { path: new MovementPath(initialTile, initialTile, [], false), teleported: false };
        }
        const running = !!update.running;
        const serverSubX = typeof subX === "number" ? (subX as number) | 0 : undefined;
        const serverSubY = typeof subY === "number" ? (subY as number) | 0 : undefined;
        const forcedTeleport = isFirstAppearance || !!update.snap;
        let fromTile = { x: state.tileX, y: state.tileY };

        if (!forcedTeleport && directions.length > 0) {
            let startX = initialTile.x | 0;
            let startY = initialTile.y | 0;
            for (const direction of directions) {
                const delta = directionToDelta((direction & 7) as MovementDirection);
                startX -= delta.dx;
                startY -= delta.dy;
            }
            fromTile = { x: startX | 0, y: startY | 0 };
        }

        let tile = initialTile;
        let finalSubX = typeof serverSubX === "number" ? serverSubX : (tile.x << 7) + 64;
        let finalSubY = typeof serverSubY === "number" ? serverSubY : (tile.y << 7) + 64;

        // ── Build path from update ──────────────────────────────────────

        const destTile = initialTile;
        const dxToDest = (destTile.x - fromTile.x) | 0;
        const dyToDest = (destTile.y - fromTile.y) | 0;
        const chebyshevDist = Math.max(Math.abs(dxToDest), Math.abs(dyToDest)) | 0;
        const isRunDisplacement = running || traversals.some((t) => (t | 0) === 2);

        let path: MovementPath;

        if (
            !forcedTeleport &&
            isRunDisplacement &&
            chebyshevDist > 0 &&
            chebyshevDist <= 2 &&
            typeof this.getCollisionFlagAt === "function"
        ) {
            // OSRS reconstructs every run-speed update through its local route finder.
            // A server run can be encoded as a single +1,+1 endpoint even when the
            // actual steps were cardinal; using the packed direction directly makes
            // the rendered player cut diagonally through wall corners.
            path = this.buildRunTargetPath(fromTile, destTile, update.level | 0);
            tile = destTile;
            finalSubX = typeof serverSubX === "number" ? serverSubX : (destTile.x << 7) + 64;
            finalSubY = typeof serverSubY === "number" ? serverSubY : (destTile.y << 7) + 64;
        } else if (directions.length > 0 && !forcedTeleport) {
            // Standard step-by-step movement from server directions.
            const steps: MovementStep[] = [];
            let currX = fromTile.x;
            let currY = fromTile.y;
            for (let i = 0; i < directions.length; i++) {
                const direction = (directions[i] & 7) as MovementDirection;
                const delta = directionToDelta(direction);
                currX += delta.dx;
                currY += delta.dy;
                const traversal = traversals[i];
                steps.push({
                    tile: { x: currX, y: currY },
                    direction,
                    run: traversal === 2,
                    traversal,
                });
            }
            tile = { x: currX, y: currY };
            finalSubX = (currX << 7) + 64;
            finalSubY = (currY << 7) + 64;
            path = new MovementPath(fromTile, tile, steps, false);
        } else if (!forcedTeleport && chebyshevDist > 0 && chebyshevDist <= 2 && traversals[0] === 1) {
            // Compact movement supplies an endpoint, not explicit path directions. WALK
            // appends that destination directly; only RUN uses the local route finder.
            const direction = deltaToDirection(Math.sign(dxToDest), Math.sign(dyToDest))!;
            path = new MovementPath(fromTile, destTile, [{
                tile: destTile, direction, run: false, traversal: 1,
            }], false);
        } else if (!forcedTeleport && chebyshevDist > 0) {
            tile = destTile;
            finalSubX = typeof serverSubX === "number" ? serverSubX : (destTile.x << 7) + 64;
            finalSubY = typeof serverSubY === "number" ? serverSubY : (destTile.y << 7) + 64;
            path = new MovementPath(fromTile, tile, [], true);
        } else {
            // No movement or teleport.
            if (serverSubX === undefined || serverSubY === undefined) {
                finalSubX = (state.tileX << 7) + 64;
                finalSubY = (state.tileY << 7) + 64;
            } else {
                finalSubX = serverSubX;
                finalSubY = serverSubY;
            }
            tile = { x: toTileCoord(finalSubX), y: toTileCoord(finalSubY) };
            path = new MovementPath(fromTile, tile, [], forcedTeleport);
        }

        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(tile.x, tile.y, update.level | 0)
            : update.level | 0;
        update.level = resolvedLevel;
        const teleported = forcedTeleport || path.isTeleport;

        // ── Apply to ECS ────────────────────────────────────────────────

        this.applyPath(
            state,
            path,
            {
                subX: finalSubX,
                subY: finalSubY,
                level: resolvedLevel,
                running,
                rotation: update.rotation,
                orientation: update.orientation,
                turned: !!update.turned,
                moved: !!update.moved,
            },
            teleported,
        );

        return { path, teleported };
    }

    // ── ECS application ─────────────────────────────────────────────────

    private applyPath(
        state: MovementState,
        path: MovementPath,
        opts: MovementStateOptions,
        teleport: boolean,
    ): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;

        state.setLastSteps(path.steps);
        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(path.to.x, path.to.y, opts.level)
            : opts.level;

        // ── Teleport / first appearance ─────────────────────────────────
        if (teleport) {
            if (this.keyboardPrediction?.serverId === state.serverId) this.keyboardPrediction = undefined;
            this.playerEcs.teleport(ecsIndex, path.to.x, path.to.y, resolvedLevel);
            this.playerEcs.setRunning(ecsIndex, false);
            state.setTile(path.to, opts.subX, opts.subY, resolvedLevel);
            state.lastRunning = false;

            if (typeof opts.orientation === "number") {
                this.playerEcs.setTargetRot(ecsIndex, opts.orientation & 2047);
                state.lastOrientation = opts.orientation & 2047;
            } else if (typeof opts.rotation === "number") {
                this.playerEcs.setRotationImmediate(ecsIndex, opts.rotation & 2047);
                state.lastOrientation = opts.rotation & 2047;
            }
            return;
        }

        // ── No movement this tick ───────────────────────────────────────
        if (path.stepCount === 0) {
            this.applyOrientationOnly(state, opts);
            return;
        }

        // ── Movement steps ──────────────────────────────────────────────
        // New server steps extend from the last authoritative tile. Keep any
        // queued visual steps needed to reach that tile, then drop stale future
        // steps before appending the updated path.
        const fromSubX = (path.from.x << 7) + 64;
        const fromSubY = (path.from.y << 7) + 64;
        if (this.keyboardPrediction?.serverId === state.serverId &&
            this.playerEcs.isForcedMovementActive(ecsIndex, this.playerEcs.getClientCycle())) {
            this.keyboardPrediction = undefined;
        }
        const prediction = this.keyboardPrediction?.serverId === state.serverId
            ? this.keyboardPrediction : undefined;
        const acknowledged = prediction ? prediction.steps.findIndex(tile =>
            tile.x === path.to.x && tile.y === path.to.y) + 1 : 0;
        const matched = prediction && (acknowledged > 0 || (prediction.steps.length > 0 &&
            path.steps.slice(0, prediction.steps.length).every((step, n) =>
                step.tile.x === prediction.steps[n].x && step.tile.y === prediction.steps[n].y)));
        let stepsToQueue = path.steps;
        if (matched) {
            // Matching server steps acknowledge prediction, rather than replaying it backwards.
            stepsToQueue = acknowledged ? [] : path.steps.slice(prediction.steps.length);
            prediction.steps = prediction.steps.slice(acknowledged || path.steps.length);
            if (!prediction.steps.length) this.keyboardPrediction = undefined;
        } else if (prediction) {
            // Rebase from the active visual tile to the newest server destination.
            // Replaying the server path's old origin makes the player run backwards.
            const target = this.playerEcs.getMovementTarget(ecsIndex);
            const corrected = this.getKeyboardPath({ x: target.x >> 7, y: target.y >> 7 },
                path.to, resolvedLevel, opts.running);
            this.playerEcs.clearQueuedSteps(ecsIndex);
            if (corrected) stepsToQueue = corrected;
            else {
                this.playerEcs.teleport(ecsIndex, path.to.x, path.to.y, resolvedLevel);
                stepsToQueue = [];
            }
            this.keyboardPrediction = undefined;
        }
        const aligned = prediction || this.playerEcs.trimQueuedStepsAfter(ecsIndex, fromSubX, fromSubY);
        if (!aligned) {
            const sameOriginTile = (this.playerEcs.getX(ecsIndex) >> 7) === path.from.x &&
                (this.playerEcs.getY(ecsIndex) >> 7) === path.from.y;
            // A route can start anywhere within its first tile after free movement.
            if (sameOriginTile) this.playerEcs.clearServerQueue(ecsIndex);
            else this.playerEcs.teleport(ecsIndex, path.from.x, path.from.y, resolvedLevel);
        }

        const anyRun = path.steps.some((s) => !!s.run);
        let lastOrientation = directionToOrientation(path.steps[path.steps.length - 1].direction) & 2047;

        let queueOverflowed = false;
        for (const step of stepsToQueue) {
            const stepSubX = (step.tile.x << 7) + 64;
            const stepSubY = (step.tile.y << 7) + 64;
            const traversal =
                typeof step.traversal === "number" ? step.traversal | 0 : step.run ? 2 : 1;
            const factor = traversal === 0 ? 0.5 : traversal === 2 ? 2 : 1;
            const dirOrientation = directionToOrientation(step.direction) & 2047;
            lastOrientation = dirOrientation;
            const queued = this.playerEcs.setServerPos(
                ecsIndex,
                stepSubX,
                stepSubY,
                factor,
                dirOrientation,
            );
            if (!queued) {
                queueOverflowed = true;
                break;
            }
        }

        const finalStep = path.steps[path.steps.length - 1];
        if (queueOverflowed) {
            lastOrientation = directionToOrientation(finalStep.direction) & 2047;
            try {
                this.playerEcs.clearServerQueue(ecsIndex);
                this.playerEcs.teleport(
                    ecsIndex,
                    finalStep.tile.x,
                    finalStep.tile.y,
                    resolvedLevel,
                );
                this.playerEcs.setTargetRot(ecsIndex, lastOrientation);
            } catch {}
        }

        // Update state to the final tile from this tick's steps.
        const finalSubX = (finalStep.tile.x << 7) + 64;
        const finalSubY = (finalStep.tile.y << 7) + 64;
        state.setTile(finalStep.tile, finalSubX, finalSubY, resolvedLevel);

        this.playerEcs.setRunning(ecsIndex, !!opts.running);
        state.lastRunning = anyRun;
        state.lastOrientation = lastOrientation;

        // Apply interaction-facing once the steps are queued.
        const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
        if (interactionOrientation !== undefined) {
            this.playerEcs.setTargetRot(ecsIndex, interactionOrientation & 2047);
            state.lastOrientation = interactionOrientation & 2047;
        }

        if (opts.moved) {
            try {
                this.animController?.cancelSequenceOnMove?.(state.serverId);
            } catch {}
        }
    }

    // ── Per-client-tick update ───────────────────────────────────────────

    /**
     * Called every client tick.  Updates interaction-facing orientation and
     * ensures idle animation transitions when movement finishes.
     *
     * There is no waypoint queue to drain — all steps live in the ECS ring buffer.
     */
    updateInteractionRotations(): void {
        const prediction = this.keyboardPrediction;
        if (prediction && !prediction.expired && Date.now() >= prediction.expiresAt) {
            const state = this.states.get(prediction.serverId);
            if (state && this.playerEcs.isForcedMovementActive(state.ecsIndex, this.playerEcs.getClientCycle())) {
                this.keyboardPrediction = undefined;
            } else if (state && prediction.stopped) {
                this.rewindKeyboardPrediction(state);
                this.keyboardPrediction = undefined;
            } else if (state) {
                // A late reply isn't a rejection. Freeze further anticipation and
                // let the next authoritative update reconcile the active tile.
                this.stopKeyboardMovement(prediction.serverId);
                prediction.stopped = false;
                prediction.expired = true;
                this.keyboardPrediction = prediction;
            }
        }
        for (const [, state] of this.states) {
            const ecsIndex = state.ecsIndex;
            if (!(ecsIndex >= 0)) continue;

            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            if (interactionOrientation !== undefined) {
                const rot = interactionOrientation & 2047;
                this.playerEcs.setTargetRot(ecsIndex, rot);
                state.lastOrientation = rot;
            }

            const isMoving = this.playerEcs.isMoving(ecsIndex);
            if (!isMoving) {
                this.playerEcs.resetMovementDelay?.(ecsIndex);
            }
        }
    }

    // ── Orientation helpers ──────────────────────────────────────────────

    private applyOrientationOnly(state: MovementState, opts: MovementStateOptions): void {
        const ecsIndex = state.ecsIndex;
        if (!(ecsIndex >= 0)) return;

        const resolvedLevel = this.resolveTilePlane
            ? this.resolveTilePlane(state.tileX, state.tileY, opts.level)
            : opts.level;
        state.setTile({ x: state.tileX, y: state.tileY }, opts.subX, opts.subY, resolvedLevel);
        this.playerEcs.setRunning(ecsIndex, !!opts.running);

        const isMoving = this.playerEcs.isMoving(ecsIndex);
        if (!isMoving) {
            state.lastRunning = !!opts.running;
            const interactionOrientation = this.computeInteractionOrientation(ecsIndex);
            const orientation =
                interactionOrientation !== undefined
                    ? interactionOrientation
                    : typeof opts.orientation === "number"
                      ? opts.orientation & 2047
                      : typeof opts.rotation === "number"
                        ? opts.rotation & 2047
                        : undefined;
            if (orientation !== undefined) {
                this.playerEcs.setTargetRot(ecsIndex, orientation);
                state.lastOrientation = orientation;
            }
        }
    }

    private computeInteractionOrientation(ecsIndex: number): number | undefined {
        try {
            const rawIndex = this.playerEcs.getInteractionIndex(ecsIndex);
            if (typeof rawIndex !== "number" || rawIndex < 0) return undefined;
            const decoded = decodeInteractionIndex(rawIndex);
            if (!decoded) return undefined;
            const selfPos = this.samplePlayerVisualPosition(ecsIndex);
            if (!selfPos) return undefined;
            let targetX: number | undefined;
            let targetY: number | undefined;
            if (decoded.type === "player") {
                const targetIdx = this.playerEcs.getIndexForServerId(decoded.id | 0);
                if (targetIdx !== undefined) {
                    const pos = this.samplePlayerVisualPosition(targetIdx);
                    if (pos) {
                        targetX = pos.x;
                        targetY = pos.y;
                    }
                }
            } else if (decoded.type === "npc" && this.npcEcs) {
                const npcIdx = this.npcEcs.getEcsIdForServer(decoded.id | 0);
                if (npcIdx !== undefined) {
                    const mapId = this.npcEcs.getMapId(npcIdx) | 0;
                    const mapX = (mapId >> 8) & 0xff;
                    const mapY = mapId & 0xff;
                    const localX = this.npcEcs.getX(npcIdx) | 0;
                    const localY = this.npcEcs.getY(npcIdx) | 0;
                    targetX = (mapX << 13) + localX;
                    targetY = (mapY << 13) + localY;
                }
            }
            if (targetX === undefined || targetY === undefined) return undefined;
            const across = this.acrossDeckOrientation(ecsIndex, decoded, selfPos, targetX, targetY);
            if (across !== null) return across;
            if ((selfPos.x | 0) === (targetX | 0) && (selfPos.y | 0) === (targetY | 0))
                return undefined;
            return faceAngleRs(selfPos.x | 0, selfPos.y | 0, targetX | 0, targetY | 0);
        } catch {
            return undefined;
        }
    }

    /**
     * Facing a target in another world view from a boat's deck (a sea creature shot from the deck):
     * the player stands in the deck's own scene, so the angle is taken from where they are in the
     * world, and made relative to the deck, which is drawn turned by the boat's orientation. Null
     * when both are in the same world view (the usual case); undefined when it can't be placed.
     */
    private acrossDeckOrientation(
        ecsIndex: number,
        decoded: { type: string; id: number },
        selfPos: { x: number; y: number },
        targetX: number,
        targetY: number,
    ): number | undefined | null {
        const worldView = this.playerEcs.getWorldViewId(ecsIndex) | 0;
        if (worldView < 0 || !this.worldEntities) return null;
        let targetWorldView = -1;
        if (decoded.type === "npc" && this.npcEcs) {
            const npcIdx = this.npcEcs.getEcsIdForServer(decoded.id | 0);
            if (npcIdx !== undefined) targetWorldView = this.npcEcs.getWorldViewId(npcIdx) | 0;
        } else if (decoded.type === "player") {
            const targetIdx = this.playerEcs.getIndexForServerId(decoded.id | 0);
            if (targetIdx !== undefined) targetWorldView = this.playerEcs.getWorldViewId(targetIdx) | 0;
        }
        if (targetWorldView === worldView) return null;
        const self = this.worldEntities.projectDeckToWorld(worldView, selfPos.x | 0, selfPos.y | 0);
        const orientation = this.worldEntities.orientationOf(worldView);
        if (!self || orientation === undefined) return undefined;
        if ((self.x | 0) === (targetX | 0) && (self.y | 0) === (targetY | 0)) return undefined;
        return (faceAngleRs(self.x | 0, self.y | 0, targetX | 0, targetY | 0) - orientation) & 2047;
    }

    private samplePlayerVisualPosition(ecsIndex: number): { x: number; y: number } | undefined {
        const x = this.playerEcs.getX(ecsIndex);
        const y = this.playerEcs.getY(ecsIndex);
        const sampleX = typeof x === "number" ? x | 0 : 0;
        const sampleY = typeof y === "number" ? y | 0 : 0;
        if (!Number.isFinite(sampleX) || !Number.isFinite(sampleY)) return undefined;
        return { x: sampleX | 0, y: sampleY | 0 };
    }

    private buildRunTargetPath(
        from: { x: number; y: number },
        dest: { x: number; y: number },
        plane: number,
    ): MovementPath {
        const steps: MovementStep[] = [];
        let currX = from.x | 0;
        let currY = from.y | 0;

        const count = this.routeFinder.findRouteSize1(
            currX,
            currY,
            dest.x | 0,
            dest.y | 0,
            plane | 0,
            this.getCollisionFlagAt as CollisionFlagAtFn,
            true,
        );

        const intermediateCount = count > 0 ? Math.max(0, (count - 1) | 0) : 0;
        for (let i = 0; i < intermediateCount; i++) {
            const nextX = this.routeFinder.outX[i] | 0;
            const nextY = this.routeFinder.outY[i] | 0;
            const direction = deltaToDirection(
                Math.sign(nextX - currX),
                Math.sign(nextY - currY),
            );
            if (direction === undefined) continue;
            currX = nextX;
            currY = nextY;
            steps.push({
                tile: { x: currX, y: currY },
                direction,
                run: true,
                traversal: 2,
            });
        }

        const finalDirection = deltaToDirection(
            Math.sign((dest.x | 0) - currX),
            Math.sign((dest.y | 0) - currY),
        );
        if (finalDirection !== undefined) {
            steps.push({
                tile: { x: dest.x | 0, y: dest.y | 0 },
                direction: finalDirection,
                run: true,
                traversal: 2,
            });
        }

        return new MovementPath(from, dest, steps, false);
    }

    // ── Public accessors ────────────────────────────────────────────────

    getState(serverId: number): MovementState | undefined {
        return this.states.get(serverId);
    }

    getAllServerIds(): number[] {
        return Array.from(this.states.keys());
    }

    getLastSteps(serverId: number): readonly MovementStep[] {
        const state = this.states.get(serverId);
        return state ? state.getLastSteps() : [];
    }
}
