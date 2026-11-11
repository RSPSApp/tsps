import { MenuTargetType, type OsrsMenuEntry } from "../../rs/MenuEntry";

/**
 * The minimenu block slots the cache's scripts set with minimenu_setblockmode (script 7468 at
 * login, 7461 on a click of an Interfaces > Minimenu filters row): mode 0 leaves that kind of
 * entry out of the menu, 1 keeps it. A slot never set keeps its entries.
 */
export const MINIMENU_BLOCK_ENTITY = 2; // "Disable entity options" (settings_minimenu_filter_entity)
export const MINIMENU_BLOCK_PLAYER = 6; // "Disable player options" (settings_minimenu_filter_player)
export const MINIMENU_BLOCK_EXAMINE = 9; // "Disable examine" (settings_minimenu_filter_examine)

const ENTITY_TARGETS = new Set([MenuTargetType.NPC, MenuTargetType.LOC, MenuTargetType.OBJ]);

function blocked(blockModes: readonly number[] | undefined, slot: number): boolean {
    return blockModes?.[slot] === 0;
}

/** The block slot a world menu entry falls under, or -1. Use and Cast have filters of their own. */
function blockSlotOf(entry: OsrsMenuEntry): number {
    if (entry.spellCast || entry.option === "Use") return -1;
    if (entry.option === "Examine" && ENTITY_TARGETS.has(entry.targetType)) return MINIMENU_BLOCK_EXAMINE;
    if (ENTITY_TARGETS.has(entry.targetType)) return MINIMENU_BLOCK_ENTITY;
    if (entry.targetType === MenuTargetType.PLAYER) return MINIMENU_BLOCK_PLAYER;
    return -1;
}

/** The world menu without the entries the Minimenu filters settings leave out. */
export function filterMinimenuEntries(
    entries: OsrsMenuEntry[],
    blockModes: readonly number[] | undefined,
): OsrsMenuEntry[] {
    if (!blockModes?.length) return entries;
    return entries.filter((entry) => {
        const slot = blockSlotOf(entry);
        return slot < 0 || !blocked(blockModes, slot);
    });
}
