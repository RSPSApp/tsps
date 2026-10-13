export type InteractionTargetType = "player" | "npc";

export const NO_INTERACTION = -1;
/**
 * A player is its index plus this, an NPC its index (as OSRS: NPC indices run to 65534, so the
 * marker sits above them). Must match the server's PlayerSession.PLAYER_INTERACTION_OFFSET.
 */
export const PLAYER_INDEX_OFFSET = 0x10000; // 65536

export type InteractionIndex = number;

export function encodeInteractionIndex(
    targetType: InteractionTargetType,
    targetId: number,
): InteractionIndex {
    const normalizedId = targetId | 0;
    if (normalizedId < 0) {
        return NO_INTERACTION;
    }
    if (targetType === "npc") {
        return normalizedId;
    }
    return PLAYER_INDEX_OFFSET + normalizedId;
}

export function encodeInteractionTarget(
    target: { type: InteractionTargetType; id: number } | null | undefined,
): InteractionIndex {
    if (!target) {
        return NO_INTERACTION;
    }
    return encodeInteractionIndex(target.type, target.id);
}

export function decodeInteractionIndex(
    index: InteractionIndex,
): { type: InteractionTargetType; id: number } | null {
    if (!isValidInteractionIndex(index)) {
        return null;
    }
    if (isNpcInteractionIndex(index)) {
        return { type: "npc", id: index };
    }
    return { type: "player", id: index - PLAYER_INDEX_OFFSET };
}

export function decodeInteractionTarget(
    index: InteractionIndex,
): { type: InteractionTargetType; id: number } | undefined {
    const decoded = decodeInteractionIndex(index);
    return decoded ?? undefined;
}

export function isValidInteractionIndex(index: InteractionIndex): boolean {
    return Number.isInteger(index) && index >= 0;
}

export function isNpcInteractionIndex(index: InteractionIndex): boolean {
    return index >= 0 && index < PLAYER_INDEX_OFFSET;
}

export function isPlayerInteractionIndex(index: InteractionIndex): boolean {
    return index >= PLAYER_INDEX_OFFSET;
}

export function clampInteractionIndex(
    index: InteractionIndex | null | undefined,
): InteractionIndex {
    if (typeof index !== "number") {
        return NO_INTERACTION;
    }
    if (index < NO_INTERACTION) {
        return NO_INTERACTION;
    }
    return index | 0;
}

export function resolveInteractionTargetId(index: InteractionIndex): number | undefined {
    if (!isValidInteractionIndex(index)) {
        return undefined;
    }
    if (isNpcInteractionIndex(index)) {
        return index;
    }
    return index - PLAYER_INDEX_OFFSET;
}
