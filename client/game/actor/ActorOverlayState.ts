/**
 * ActorOverlayState - Type definitions and factory functions for actor overlay state.
 *
 * Each actor has:
 * - a hitsplat list (Actor.hitsplatList in the r241 client): parallel arrays that grow one
 *   slot at a time, up to the per-hit limit the server sends (8 on live)
 * - healthBars: linked list of HealthBar
 * - overheadText: String, overheadTextCyclesRemaining: int
 */

/**
 * The most hitsplat slots an actor can hold: one per HitsplatLayout offset (100 in r241). The
 * server's per-hit limit decides how many are used; live sends 8.
 */
export { HITSPLAT_LAYOUT_SLOTS as MAX_HITSPLAT_SLOTS } from "./HitsplatLayout";

/**
 * Per-actor hitsplat list (r241 Actor.hitsplatList), one entry per slot. A slot keeps its
 * index for as long as it exists, and its index picks its HitsplatLayout offset.
 *
 * - hitSplatCycles stores the END cycle in CLIENT CYCLES (20ms each)
 * - Start visibility is calculated at render time: hitSplatCycles - displayCycles
 * - displayCycles is loaded from HitSplatDefinition at render time
 */
export interface ActorHitsplatState {
    hitSplatTypes: number[];
    hitSplatValues: number[];
    /** Secondary splat type; r241 sends none, so always -1. */
    hitSplatTypes2: number[];
    hitSplatValues2: number[];
    /** Expiry cycle per slot, in CLIENT CYCLES. */
    hitSplatCycles: number[];
}

/**
 * Health bar update state (matches OSRS HealthBarUpdate)
 */
export interface HealthBarUpdateState {
    cycle: number;
    health: number;
    health2: number;
    cycleOffset: number;
}

/**
 * Health bar definition state (matches OSRS HealthBarDefinition)
 */
export interface HealthBarDefinitionState {
    defId: number;
    int1: number;
    int2: number;
    int3: number;
    stepIncrement: number;
    int5: number;
    width: number;
    widthPadding: number;
}

/**
 * Single health bar state
 */
export interface HealthBarBarState {
    def: HealthBarDefinitionState;
    updates: HealthBarUpdateState[];
}

/**
 * Per-actor health bar collection
 */
export interface ActorHealthBarsState {
    bars: HealthBarBarState[];
}

/** A new actor's hitsplat list: empty (r241 Actor: new ArrayList(4)). */
export function createActorHitsplatState(): ActorHitsplatState {
    return {
        hitSplatTypes: [],
        hitSplatValues: [],
        hitSplatTypes2: [],
        hitSplatValues2: [],
        hitSplatCycles: [],
    };
}

/**
 * Create a new empty health bars state for an actor
 */
export function createActorHealthBarsState(): ActorHealthBarsState {
    return {
        bars: [],
    };
}
