import type { SkillId } from "../../rs/skill/skills";
import type { Inventory } from "../../rs/inventory/Inventory";
import type { EnumComposition } from "./EnumComposition";
import type { GameState } from "./GameState";
import type { ItemContainer } from "./Item";
import type { ItemComposition } from "./ItemComposition";
import type { ObjectComposition } from "./ObjectComposition";
import type { Point } from "./Point";
import type { Widget } from "./widgets/Widget";
import { WorldPoint } from "./coords/WorldPoint";

export { WorldPoint };
export type { Point };

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
    /** The server's NPC index (RuneLite's getIndex). */
    getIndex(): number;
    getComposition(): NPCComposition | null;
    getWorldLocation(): WorldPoint;
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
    /** The loaded component `(group << 16) | child`, or null. */
    getWidget(componentId: number): Widget | null;
    /** The backpack (93), worn equipment (94) or bank (95), or null for any other id. */
    getItemContainer(id: number): ItemContainer | null;
    getItemDefinition(id: number): ItemComposition | null;
    getEnum(id: number): EnumComposition | null;
    getObjectDefinition(id: number): ObjectComposition | null;
    /** An NPC type by id, after the player's var transforms (RuneLite's getNpcDefinition + transform). */
    getNpcDefinition(id: number): NPCComposition | null;
    /** Every server NPC in the scene, one wrapper each, in store order. */
    getNpcs(): NPC[];
    /** The NPC with a server index (RuneLite's getCachedNPCs()[index]), or null when none is in the scene. */
    getNpcByIndex(index: number): NPC | null;
    /** The plane the player is on, 0-3. */
    getPlane(): number;
    /** The mouse on the canvas in pixels, or (-1, -1) when unknown. */
    getMouseCanvasPosition(): Point;
    setHintArrow(target: NPC | WorldPoint): void;
    clearHintArrow(): void;
    /** The NPC the hint arrow points at, or null when the hint is not on an NPC. */
    getHintArrowNpc(): NPC | null;
}

/** The engine stores a container id maps to (used by `getItemContainer`). */
export type ContainerStores = { inventory?: Inventory; equipment?: Inventory; bankInventory?: Inventory };
