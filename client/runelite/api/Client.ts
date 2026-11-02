import type { SkillId } from "../../rs/skill/skills";
import type { GameState } from "./GameState";

/** An absolute tile (RuneLite's `WorldPoint`). */
export interface WorldPoint {
    readonly x: number;
    readonly y: number;
    readonly plane: number;
}

/** An NPC type, as far as ported plugins read it (RuneLite's `NPCComposition`). */
export interface NPCComposition {
    getName(): string;
    getActions(): ReadonlyArray<string | null | undefined>;
}

/**
 * Something a player can be interacting with (RuneLite's `Actor`). The engine reuses actor slots,
 * so a port compares actors by `getInteractionKey()` rather than by reference.
 */
export interface Actor {
    getName(): string | null;
    /** Equal for the same actor slot (the encoded interaction index). */
    getInteractionKey(): number;
}

/** An NPC (RuneLite's `NPC`). */
export interface NPC extends Actor {
    getId(): number;
    getIndex(): number;
    getComposition(): NPCComposition | null;
}

/** The local player, as far as ported plugins read it (RuneLite's `Player`). */
export interface Player {
    getName(): string;
    getCombatLevel(): number;
    /** The action animation, -1 when none (RuneLite's `getAnimation`). */
    getAnimation(): number;
    getWorldLocation(): WorldPoint;
    /** The NPC or player this one is interacting with. */
    getInteracting(): Actor | null;
}

/**
 * RuneLite's `net.runelite.api.Client`, cut down to the methods ported plugins call. Methods we
 * don't implement are absent, so a port that needs one fails to compile
 * (docs/RuneLite_API_shape_implementation.md, §4.4).
 */
export interface Client {
    getGameState(): GameState;
    getLocalPlayer(): Player | null;
    getVarpValue(varpId: number): number;
    getVarbitValue(varbitId: number): number;
    getRealSkillLevel(skill: SkillId): number;
    getBoostedSkillLevel(skill: SkillId): number;
    /** Whether the game is in a resizable layout (not the fixed 765x503 one). */
    isResized(): boolean;
    /** Run energy in hundredths of a percent, 0-10000. */
    getEnergy(): number;
    /** Game ticks since the client started. */
    getTickCount(): number;
    /** Wall-clock time of the last mouse press or tap. */
    getMouseLastPressedMillis(): number;
    /** Client ticks (20 ms) since the last key press. */
    getKeyboardIdleTicks(): number;
    /** Runs a cache client script; its return values are left on the int stack. */
    runScript(scriptId: number, ...args: number[]): void;
    getIntStack(): ArrayLike<number>;
}
