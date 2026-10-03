/**
 * NpcClientTick - Helper functions for NPC client-side tick updates.
 *
 * This module extracts pure logic from WebGLOsrsRenderer._ecsUpdateNpcClient
 * for better testability and maintainability.
 *
 * NPCs are updated each client tick (20ms) with:
 * - Position interpolation toward target
 * - Rotation interpolation toward target orientation
 * - Combat facing toward interaction target
 * - Animation frame advancement
 */
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import { deltaToDirection, directionToOrientation } from "../../common/Direction";
import { computeFacingRotation } from "../utils/rotation";

/**
 * Compute movement orientation from step direction.
 * Returns RS angle units (0-2047) or undefined if no movement.
 */
export function computeMovementOrientation(stepX: number, stepY: number): number | undefined {
    const direction = deltaToDirection(Math.sign(stepX), Math.sign(stepY));
    return direction !== undefined ? directionToOrientation(direction) : undefined;
}

// computeFacingRotation imported from ../utils/rotation

/**
 * Interpolate rotation toward target with given speed.
 * Handles wraparound and exact 180-degree snapping.
 *
 * @param currentRot Current rotation (0-2047)
 * @param targetRot Target rotation (0-2047)
 * @param speed Max rotation per tick
 * @returns New rotation value
 */
export function interpolateRotation(currentRot: number, targetRot: number, speed: number): number {
    const delta = (targetRot - currentRot) & 2047;
    if (delta === 0 || speed <= 0) return currentRot;

    // Determine shortest rotation direction
    // When delta === 1024 (exactly 180°), pick counterclockwise (dir = -1) as tie-breaker
    // to ensure smooth rotation instead of snapping
    const dir = delta >= 1024 ? -1 : 1;
    let newRot = (currentRot + dir * speed) & 2047;

    // Check if we've passed the target
    const newDelta = (targetRot - newRot) & 2047;
    const minDelta = Math.min(delta, 2048 - delta);
    if (newDelta > 2048 - speed || minDelta <= speed) {
        newRot = targetRot;
    }

    return newRot;
}

/**
 * Movement step result from interpolating toward target.
 */
export interface MovementStepResult {
    newX: number;
    newY: number;
    reachedTarget: boolean;
    stepX: number;
    stepY: number;
}

/**
 * Compute one step of movement interpolation toward target.
 *
 * @param cx Current X position (sub-tile units)
 * @param cy Current Y position (sub-tile units)
 * @param tx Target X position (sub-tile units)
 * @param ty Target Y position (sub-tile units)
 * @param speed Movement speed (sub-tile units per tick)
 * @param epsilon Distance threshold for "arrived"
 */
export function computeMovementStep(
    cx: number,
    cy: number,
    tx: number,
    ty: number,
    speed: number,
    epsilon: number = 2,
): MovementStepResult {
    const dx = tx - cx;
    const dy = ty - cy;
    const dist2 = dx * dx + dy * dy;

    // Already at target
    if (dist2 <= epsilon * epsilon) {
        return { newX: tx, newY: ty, reachedTarget: true, stepX: 0, stepY: 0 };
    }

    const dist = Math.hypot(dx, dy);
    let stepX = 0;
    let stepY = 0;

    if (dist > 0) {
        stepX = Math.round((dx / dist) * speed);
        stepY = Math.round((dy / dist) * speed);
    }

    // Ensure at least 1 unit of movement
    if (stepX === 0 && stepY === 0) {
        if (Math.abs(dx) >= Math.abs(dy)) {
            stepX = Math.sign(dx);
        } else {
            stepY = Math.sign(dy);
        }
    }

    return {
        newX: (cx + stepX) | 0,
        newY: (cy + stepY) | 0,
        reachedTarget: false,
        stepX,
        stepY,
    };
}

/**
 * Animation tick result.
 */
export interface AnimTickResult {
    newFrameIndex: number;
    newTick: number;
    frameAdvanced: boolean;
}

/**
 * Advance animation by one tick.
 *
 * @param currentFrameIndex Current frame index
 * @param currentTick Current tick within frame
 * @param frameCount Total frames in animation
 * @param frameLengths Frame duration array (ticks per frame)
 */
export function advanceAnimation(
    currentFrameIndex: number,
    currentTick: number,
    frameCount: number,
    frameLengths?: number[],
): AnimTickResult {
    const safeFrameCount = Math.max(1, frameCount | 0);
    let fi = currentFrameIndex | 0;
    if (fi >= safeFrameCount) fi = 0;

    const tick = (currentTick + 1) | 0;
    const frameLen = frameLengths?.[fi];
    const currLen = (typeof frameLen === "number" ? frameLen : 0) | 0;

    // sequenceFrameCycle > frameLengths[sequenceFrame] (uses >, not >=)
    // and resets to 1, not 0.
    if (tick > currLen) {
        return {
            newFrameIndex: (fi + 1) % safeFrameCount,
            newTick: 1,
            frameAdvanced: true,
        };
    }

    return {
        newFrameIndex: fi,
        newTick: tick,
        frameAdvanced: false,
    };
}

/**
 * Interaction target info for combat facing.
 */
export interface InteractionTarget {
    type: "player" | "npc";
    id: number;
}

/**
 * Parse interaction index to get target info.
 * Returns null if no valid interaction.
 */
export function parseInteractionTarget(
    interactionIndex: number | undefined,
): InteractionTarget | null {
    if (typeof interactionIndex !== "number" || interactionIndex < 0) {
        return null;
    }

    const decoded = decodeInteractionIndex(interactionIndex);
    if (!decoded) return null;

    if (decoded.type === "player" || decoded.type === "npc") {
        return { type: decoded.type, id: decoded.id | 0 };
    }

    return null;
}

/**
 * NPC tick update context - all data needed for one NPC update.
 */
export interface NpcTickContext {
    ecsId: number;
    mapBaseX: number;
    mapBaseY: number;

    // Current state
    x: number;
    y: number;
    level: number;
    rotation: number;
    targetRot: number;
    rotationSpeed: number;
    isWalking: boolean;
    frameIndex: number;
    animTick: number;
    seqId: number;
    seqTicksLeft: number;

    // Target/path
    targetX: number;
    targetY: number;
    stepSpeed: number;
    hasActiveStep: boolean;

    // Interaction
    interactionIndex?: number;
}

/**
 * NPC tick update result.
 */
export interface NpcTickResult {
    newX: number;
    newY: number;
    newRotation: number;
    newTargetRot: number;
    newIsWalking: boolean;
    newFrameIndex: number;
    newAnimTick: number;
    newSeqTicksLeft: number;
    clearSeq: boolean;
    movementOrientation?: number;
    frameAdvanced: boolean;
    completedStep: boolean;
}

/**
 * Process one tick for an NPC.
 * This is the main entry point for NPC tick updates.
 *
 * @param ctx Current NPC state and context
 * @param getPlayerPosition Function to get player position for combat facing
 * @param getNpcPosition Function to get other NPC position for combat facing
 */
export function processNpcTick(
    ctx: NpcTickContext,
    getPlayerPosition?: (serverId: number) => { x: number; y: number } | undefined,
    getNpcPosition?: (
        serverId: number,
    ) => { x: number; y: number; mapX: number; mapY: number } | undefined,
): NpcTickResult {
    let newX = ctx.x;
    let newY = ctx.y;
    let newRotation = ctx.rotation;
    let newTargetRot = ctx.targetRot;
    let newIsWalking = ctx.isWalking;
    let movementOrientation: number | undefined;
    let completedStep = false;

    // 1. Movement interpolation
    if (ctx.hasActiveStep) {
        const step = computeMovementStep(ctx.x, ctx.y, ctx.targetX, ctx.targetY, ctx.stepSpeed);
        newX = step.newX;
        newY = step.newY;
        completedStep = step.reachedTarget;
        movementOrientation = computeMovementOrientation(step.stepX, step.stepY);
    }

    // 2. Combat facing
    const npcWorldX = newX + ctx.mapBaseX;
    const npcWorldY = newY + ctx.mapBaseY;
    let desiredFacing = movementOrientation;

    const interaction = parseInteractionTarget(ctx.interactionIndex);
    if (interaction) {
        if (interaction.type === "player" && getPlayerPosition) {
            const target = getPlayerPosition(interaction.id);
            if (target) {
                const facing = computeFacingRotation(npcWorldX - target.x, npcWorldY - target.y);
                if (facing !== undefined) {
                    desiredFacing = facing;
                }
            }
        } else if (interaction.type === "npc" && getNpcPosition) {
            const target = getNpcPosition(interaction.id);
            if (target) {
                const targetWorldX = (target.mapX << 13) + target.x;
                const targetWorldY = (target.mapY << 13) + target.y;
                const facing = computeFacingRotation(
                    npcWorldX - targetWorldX,
                    npcWorldY - targetWorldY,
                );
                if (facing !== undefined) {
                    desiredFacing = facing;
                }
            }
        }
    }

    if (desiredFacing !== undefined) {
        newTargetRot = desiredFacing;
    }

    // 3. Rotation interpolation
    newRotation = interpolateRotation(ctx.rotation, newTargetRot, ctx.rotationSpeed);

    // 4. Sequence tick countdown
    let newSeqTicksLeft = ctx.seqTicksLeft;
    let clearSeq = false;
    if (ctx.seqId >= 0 && newSeqTicksLeft > 0) {
        newSeqTicksLeft = Math.max(0, newSeqTicksLeft - 1);
        if (newSeqTicksLeft === 0) {
            clearSeq = true;
        }
    }

    // Note: Animation advancement handled separately as it needs animation frame data
    // that's stored in the map, not the ECS

    return {
        newX,
        newY,
        newRotation,
        newTargetRot,
        newIsWalking,
        newFrameIndex: ctx.frameIndex,
        newAnimTick: ctx.animTick,
        newSeqTicksLeft,
        clearSeq,
        movementOrientation,
        frameAdvanced: false,
        completedStep,
    };
}
