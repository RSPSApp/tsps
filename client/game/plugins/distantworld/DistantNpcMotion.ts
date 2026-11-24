import { CollisionFlag } from "../../../common/CollisionFlag";
import { computeMovementOrientation } from "../../movement/NpcClientTick";
import type { CosmeticNpc } from "../ScenePresentation";
import type { DistantSpawn } from "./DistantWorldState";

export type DistantCollision = (plane: number, x: number, y: number) => number | undefined;
const STEP_MS = 600;
const DIRECTIONS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const MASKS = [CollisionFlag.BLOCK_SOUTH_WEST, CollisionFlag.BLOCK_SOUTH, CollisionFlag.BLOCK_SOUTH_EAST,
    CollisionFlag.BLOCK_WEST, CollisionFlag.BLOCK_EAST, CollisionFlag.BLOCK_NORTH_WEST,
    CollisionFlag.BLOCK_NORTH, CollisionFlag.BLOCK_NORTH_EAST];

/** Checks every footprint tile and both diagonal edges. Missing scenery is never walkable. */
export function canDistantNpcStep(flags: DistantCollision, plane: number, x: number, y: number,
    dx: number, dy: number, size: number): boolean {
    const dir = DIRECTIONS.findIndex(d => d[0] === dx && d[1] === dy);
    if (dir < 0 || size < 1 || size > 8) return false;
    const open = (tx: number, ty: number, mask: number) => {
        const flag = flags(plane, tx, ty);
        return flag !== undefined && !(flag & (mask | CollisionFlag.BLOCK_NPCS));
    };
    for (let sx = 0; sx < size; sx++) for (let sy = 0; sy < size; sy++) {
        const ax = x + sx, ay = y + sy, bx = ax + dx, by = ay + dy;
        if (!open(bx, by, MASKS[dir]) || !open(ax, ay, MASKS[7 - dir])) return false;
        if (dx && dy && (!open(bx, ay, dx < 0 ? CollisionFlag.BLOCK_WEST : CollisionFlag.BLOCK_EAST)
            || !open(ax, by, dy < 0 ? CollisionFlag.BLOCK_SOUTH : CollisionFlag.BLOCK_NORTH))) return false;
    }
    return true;
}

type Motion = {
    x: number; y: number; fromX: number; fromY: number; toX: number; toY: number;
    targetX: number; targetY: number; stepAt: number; stepUntil: number; nextDecision: number;
    rotation: number; fromRotation: number; size: number; random: number; moving: boolean;
};

function seed(key: string): number {
    let value = 2166136261;
    for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619);
    return value >>> 0 || 1;
}
function random(state: Motion): number {
    let value = state.random;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    state.random = value >>> 0;
    return state.random / 4294967296;
}
function position(state: Motion, now: number, output: { x: number; y: number }): void {
    const t = Math.max(0, Math.min(1, (now - state.stepAt) / STEP_MS));
    output.x = state.fromX + (state.toX - state.fromX) * t + state.size / 2;
    output.y = state.fromY + (state.toY - state.fromY) * t + state.size / 2;
}

/** Cosmetic random walks only. No ECS, network packets, combat or authoritative movement. */
export class DistantNpcMotion {
    private readonly states = new Map<string, Motion>();
    clear(): void { this.states.clear(); }
    retain(spawns: readonly DistantSpawn[]): void {
        const keys = new Set(spawns.map(s => s.key));
        for (const key of this.states.keys()) if (!keys.has(key)) this.states.delete(key);
    }
    advance(spawn: DistantSpawn, size: number, canWalk: boolean, now: number, flags: DistantCollision,
        allowed: (x: number, y: number) => boolean = () => true): Motion {
        let state = this.states.get(spawn.key);
        const radius = Math.max(0, Math.min(32, spawn.radius ?? 0));
        if (!state || state.size !== size || Math.max(Math.abs(state.toX - spawn.x), Math.abs(state.toY - spawn.y)) > radius) {
            const rotation = spawn.rotation ?? 0;
            const hash = seed(spawn.key);
            state = { x: spawn.x, y: spawn.y, fromX: spawn.x, fromY: spawn.y, toX: spawn.x, toY: spawn.y,
                targetX: spawn.x, targetY: spawn.y, stepAt: now, stepUntil: now, nextDecision: now + hash % 3000,
                rotation, fromRotation: rotation, size, random: hash, moving: false };
            this.states.set(spawn.key, state);
        }
        if (!canWalk || radius === 0) {
            state.x = state.fromX = state.toX = state.targetX = spawn.x;
            state.y = state.fromY = state.toY = state.targetY = spawn.y;
            state.rotation = state.fromRotation = spawn.rotation ?? state.rotation;
            state.moving = false; return state;
        }
        if (now < state.stepUntil) return state;
        state.x = state.toX; state.y = state.toY; state.moving = false;
        if (state.x === state.targetX && state.y === state.targetY) {
            if (now < state.nextDecision) return state;
            state.nextDecision = now + STEP_MS;
            // Match the viewer's sparse wander decisions, staggered independently for each spawn.
            if (random(state) >= .1) return state;
            state.targetX = spawn.x + Math.floor(random(state) * (2 * radius + 1)) - radius;
            state.targetY = spawn.y + Math.floor(random(state) * (2 * radius + 1)) - radius;
        }
        const dx = Math.sign(state.targetX - state.x), dy = Math.sign(state.targetY - state.y);
        // A bounded local walk, with cardinal alternatives when a diagonal corner is blocked.
        for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) {
            const nx = state.x + sx, ny = state.y + sy;
            if ((!sx && !sy) || Math.max(Math.abs(nx - spawn.x), Math.abs(ny - spawn.y)) > radius
                || !allowed(nx, ny) || !canDistantNpcStep(flags, spawn.plane, state.x, state.y, sx, sy, size)) continue;
            state.fromX = state.x; state.fromY = state.y; state.toX = nx; state.toY = ny;
            state.fromRotation = state.rotation;
            state.rotation = computeMovementOrientation(sx, sy) ?? state.rotation;
            state.stepAt = now; state.stepUntil = now + STEP_MS; state.moving = true;
            return state;
        }
        state.targetX = state.x; state.targetY = state.y; state.nextDecision = now + STEP_MS;
        return state;
    }
    position(key: string, now: number, output: { x: number; y: number }): boolean {
        const state = this.states.get(key);
        if (!state) return false;
        position(state, now, output); return true;
    }
    /** Sample the existing step at render cadence without new paths, poses or allocations. */
    apply(actor: CosmeticNpc, now: number): void {
        const state = this.states.get(actor.key);
        if (!state) return;
        const t = Math.max(0, Math.min(1, (now - state.stepAt) / STEP_MS));
        position(state, now, actor);
        const turn = ((state.rotation - state.fromRotation + 3072) & 2047) - 1024;
        actor.rotation = (Math.round(state.fromRotation + turn * Math.min(1, t * 2)) + 2048) & 2047;
    }
}
