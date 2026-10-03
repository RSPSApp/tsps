import { MenuTargetType, SpellCastMetadata } from "../../rs/MenuEntry";
import { MENU_ACTION_DEPRIORITIZE_OFFSET, MenuAction, inferMenuAction } from "./MenuAction";
import { MenuOpcode } from "./MenuState";

export type SimpleMenuEntry = {
    option: string;
    target?: string;
    onClick?: (gx?: number, gy?: number, ctx?: MenuClickContext) => void;
    action?: MenuAction; // canonical action (optional; inferred if absent)
    menuStateIndex?: number;
    targetType?: MenuTargetType;
    targetId?: number;
    mapX?: number;
    mapY?: number;
    playerServerId?: number;
    npcServerId?: number;
    actionIndex?: number; // 0-based option index for LOC/OBJ/NPC/PLAYER actions
    opcode?: number; // precomputed OSRS client opcode when known
    deprioritized?: boolean; // Whether this entry is deprioritized (sorted below normal entries)
    shiftClick?: boolean; // Whether this entry can be executed via shift-click (bypasses menu)
    forceLeftClick?: boolean; // Forces left-click execution even when the menu would open
    subEntries?: SimpleMenuEntry[]; // Nested submenu entries (rendered as a child menu)
};

export type MenuClickContext = {
    source?: "menu" | "primary";
    // Optional hook to close the active menu after an action is invoked.
    closeMenu?: () => void;
    // When true, handlers should run visual/UX side effects only and avoid re-sending packets.
    worldMenuStateDispatch?: boolean;
};

/**
 * shouldLeftClickOpenMenu
 *
 * Determines if a left-click should open the menu instead of executing the default action.
 *
 * Returns true when:
 * 1) leftClickOpensMenu setting is enabled AND menuOptionsCount > 2
 * 2) OR the top menu entry's opcode (after deprioritization) is CC_OP_LowPriority (1007)
 *
 * AND the top entry is NOT a shift-click action.
 *
 * @param entries - Normalized SimpleMenuEntry array
 * @param leftClickOpensMenu - User setting for left-click opens menu
 * @returns true if left-click should open menu instead of executing default action
 */
export function shouldLeftClickOpenMenu(
    entries: SimpleMenuEntry[],
    leftClickOpensMenu: boolean,
): boolean {
    const menuOptionsCount = entries.length;
    if (menuOptionsCount === 0) return false;

    // Get the top entry (first entry after normalization, which is the default action candidate)
    // In OSRS, the top entry is menuOptionsCount - 1 because entries are stored in reverse,
    // but our normalized array is already in display order where index 0 is the top action.
    const topEntryIndex = 0;
    const topEntry = entries[topEntryIndex];
    if (!topEntry) return false;

    // Check 1: leftClickOpensMenu setting enabled and more than 2 options
    let shouldOpen = leftClickOpensMenu && menuOptionsCount > 2;

    // Check 2: If not already opening, check for CC_OP_LowPriority opcode
    if (!shouldOpen) {
        let opcode = topEntry.opcode ?? 0;

        // Handle deprioritized opcodes (>= 2000)
        if (opcode >= MENU_ACTION_DEPRIORITIZE_OFFSET) {
            opcode -= MENU_ACTION_DEPRIORITIZE_OFFSET;
        }

        // CC_OP_LowPriority (1007) forces menu to open
        if (opcode === MenuOpcode.CC_OP_LowPriority) {
            shouldOpen = true;
        }
    }

    // forceLeftClick on the top entry suppresses menu opening entirely.
    if (shouldOpen && topEntry.forceLeftClick) {
        return false;
    }

    // If the top entry has shiftClick enabled, don't open menu
    // This allows shift-click to execute the action directly
    if (shouldOpen && topEntry.shiftClick) {
        return false;
    }

    return shouldOpen;
}

/**
 * Normalize menu entries:
 * - Preserve duplicates (stacked entities can repeat)
 * - Sort deprioritized entries below normal entries ()
 * - Follow bubble sort + reverse rendering semantics
 */
export function normalizeMenuEntries(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    // bubble sort moves all opcodes >= 1000 below opcodes < 1000,
    // and the menu is then rendered in reverse (last array element is the top option).
    //
    // Given entries in insertion order (OSRS array order, index 0 = first inserted),
    // the resulting display order (top-to-bottom) is:
    //   reverse(<1000 entries) then reverse(>=1000 entries)
    //
    // This preserves OSRS insertion semantics and avoids non-reference heuristics.
    const low: SimpleMenuEntry[] = [];
    const high: SimpleMenuEntry[] = [];

    const inferOpcode = (row: SimpleMenuEntry): number => {
        if (typeof row.opcode === "number") return row.opcode | 0;
        const action = row.action ?? inferMenuAction(row.option, row.targetType);
        const targetType = row.targetType;
        const actionIndex = row.actionIndex;
        // Rows carrying an op slot index are entity ops; their text never
        // selects the opcode (a loc/npc op may be named "Use" or "Cast").
        const isEntityOp = typeof actionIndex === "number" && actionIndex >= 0;

        if (action === MenuAction.WalkHere) return MenuOpcode.WalkHere;
        if (action === MenuAction.Cancel) return MenuOpcode.Cancel;
        if (action === MenuAction.Examine) {
            switch (targetType) {
                case MenuTargetType.NPC:
                    return MenuOpcode.ExamineNpc;
                case MenuTargetType.LOC:
                    return MenuOpcode.ExamineObject;
                case MenuTargetType.OBJ:
                    return MenuOpcode.ExamineGroundItem;
                default:
                    return MenuOpcode.ExamineInventoryItem;
            }
        }
        if (action === MenuAction.Cast && !isEntityOp) {
            switch (targetType) {
                case MenuTargetType.NPC:
                    return MenuOpcode.WidgetTargetOnNpc;
                case MenuTargetType.LOC:
                    return MenuOpcode.WidgetTargetOnGameObject;
                case MenuTargetType.OBJ:
                    return MenuOpcode.WidgetTargetOnGroundItem;
                case MenuTargetType.PLAYER:
                    return MenuOpcode.WidgetTargetOnPlayer;
                default:
                    return MenuOpcode.SpellCast;
            }
        }
        if (action === MenuAction.Use && !isEntityOp) {
            switch (targetType) {
                case MenuTargetType.NPC:
                    return MenuOpcode.ItemUseOnNpc;
                case MenuTargetType.LOC:
                    return MenuOpcode.ItemUseOnGameObject;
                case MenuTargetType.OBJ:
                    return MenuOpcode.ItemUseOnGroundItem;
                case MenuTargetType.PLAYER:
                    return MenuOpcode.ItemUseOnPlayer;
                default:
                    return MenuOpcode.UseItem;
            }
        }
        if (targetType === MenuTargetType.NPC) {
            switch (actionIndex) {
                case 0:
                    return MenuOpcode.NpcFirstOption;
                case 1:
                    return MenuOpcode.NpcSecondOption;
                case 2:
                    return MenuOpcode.NpcThirdOption;
                case 3:
                    return MenuOpcode.NpcFourthOption;
                case 4:
                    return MenuOpcode.NpcFifthOption;
                default:
                    return MenuOpcode.NpcFirstOption;
            }
        }
        if (targetType === MenuTargetType.LOC) {
            switch (actionIndex) {
                case 0:
                    return MenuOpcode.GameObjectFirstOption;
                case 1:
                    return MenuOpcode.GameObjectSecondOption;
                case 2:
                    return MenuOpcode.GameObjectThirdOption;
                case 3:
                    return MenuOpcode.GameObjectFourthOption;
                case 4:
                    return MenuOpcode.GameObjectFifthOption;
                default:
                    return MenuOpcode.GameObjectFirstOption;
            }
        }
        if (targetType === MenuTargetType.OBJ) {
            switch (actionIndex) {
                case 0:
                    return MenuOpcode.GroundItemFirstOption;
                case 1:
                    return MenuOpcode.GroundItemSecondOption;
                case 2:
                    return MenuOpcode.GroundItemThirdOption;
                case 3:
                    return MenuOpcode.GroundItemFourthOption;
                case 4:
                    return MenuOpcode.GroundItemFifthOption;
                default:
                    return MenuOpcode.GroundItemFirstOption;
            }
        }
        if (targetType === MenuTargetType.PLAYER) {
            if (typeof actionIndex === "number" && actionIndex >= 0 && actionIndex <= 7) {
                switch (actionIndex) {
                    case 0:
                        return MenuOpcode.PlayerFirstOption;
                    case 1:
                        return MenuOpcode.PlayerSecondOption;
                    case 2:
                        return MenuOpcode.PlayerThirdOption;
                    case 3:
                        return MenuOpcode.PlayerFourthOption;
                    case 4:
                        return MenuOpcode.PlayerFifthOption;
                    case 5:
                        return MenuOpcode.PlayerSixthOption;
                    case 6:
                        return MenuOpcode.PlayerSeventhOption;
                    case 7:
                        return MenuOpcode.PlayerEighthOption;
                }
            }
            switch (action) {
                case MenuAction.Follow:
                    return MenuOpcode.PlayerThirdOption;
                case MenuAction.TradeWith:
                    return MenuOpcode.PlayerSecondOption;
                case MenuAction.Attack:
                    return MenuOpcode.PlayerFirstOption;
                case MenuAction.TalkTo:
                    return MenuOpcode.PlayerFourthOption;
                default:
                    return MenuOpcode.PlayerFirstOption;
            }
        }
        return MenuOpcode.Custom;
    };

    for (const e of entries) {
        if (!e || !e.option) continue;

        if (!e.action) e.action = inferMenuAction(e.option, e.targetType);

        let opcode = inferOpcode(e);
        // OSRS deprioritization is represented by adding 2000 to the opcode.
        if (e.deprioritized && opcode < MENU_ACTION_DEPRIORITIZE_OFFSET) {
            opcode += MENU_ACTION_DEPRIORITIZE_OFFSET;
        }
        e.opcode = opcode;

        if (opcode < 1000) low.push(e);
        else high.push(e);
    }

    low.reverse();
    high.reverse();
    return low.concat(high);
}

export type DefaultChoiceState = {
    hasSelectedSpell?: boolean;
    hasSelectedItem?: boolean;
    isShiftHeld?: boolean;
    shiftClickActionIndex?: number; // The shift-click action index for the hovered item (0-4)
};

/**
 * Choose the default left-click entry given the current state using OSRS priority:
 * 1) Cast (if a spell is selected and Cast option exists)
 * 2) Use (if an item is selected and Use option exists)
 * 3) If shift is held and shiftClickActionIndex is set, find that action
 * 4) First non-deprioritized actionable entry (excluding Walk here/Examine/Cancel)
 * 5) Walk here (if no other options)
 * 6) First entry as fallback
 *
 * OSRS behavior: deprioritized entries (like Attack when set to right-click) should NOT
 * be the default left-click action.
 */
export function chooseDefaultMenuEntry(
    entries: SimpleMenuEntry[],
    state: DefaultChoiceState = {},
): SimpleMenuEntry | undefined {
    if (!Array.isArray(entries) || entries.length === 0) return undefined;

    // Priority 1: Cast option if spell is selected
    if (state.hasSelectedSpell) {
        const castEntry = entries.find((e) => {
            const action = e.action ?? inferMenuAction(e.option, e.targetType);
            return action === MenuAction.Cast && !e.deprioritized;
        });
        if (castEntry) {
            if (!castEntry.action) castEntry.action = MenuAction.Cast;
            return castEntry;
        }
    }

    // Priority 2: Use option if item is selected
    if (state.hasSelectedItem) {
        const useEntry = entries.find((e) => {
            const lower = String(e.option || "").toLowerCase();
            return lower === "use" && !e.deprioritized;
        });
        if (useEntry) {
            if (!useEntry.action) useEntry.action = inferMenuAction(useEntry.option);
            return useEntry;
        }
    }

    // Shift-click: find the entry matching shiftClickActionIndex
    if (
        state.isShiftHeld &&
        typeof state.shiftClickActionIndex === "number" &&
        state.shiftClickActionIndex >= 0
    ) {
        // Find entry with matching actionIndex
        const shiftEntry = entries.find((e) => e.actionIndex === state.shiftClickActionIndex);
        if (shiftEntry) {
            if (!shiftEntry.action) shiftEntry.action = inferMenuAction(shiftEntry.option);
            return shiftEntry;
        }
        // Fallback: if shiftClickActionIndex is 4 (Drop), try to find Drop action directly
        if (state.shiftClickActionIndex === 4) {
            const dropEntry = entries.find((e) => {
                const lower = String(e.option || "").toLowerCase();
                return lower === "drop" || lower === "destroy" || lower === "release";
            });
            if (dropEntry) {
                if (!dropEntry.action) dropEntry.action = inferMenuAction(dropEntry.option);
                return dropEntry;
            }
        }
    }

    // Priority 4: First non-deprioritized actionable entry (excluding Walk here/Examine/Cancel)
    const skippedOptions = new Set(["walk here", "examine", "cancel"]);
    const actionableEntry = entries.find((e) => {
        const lower = String(e.option || "").toLowerCase();
        const action = e.action ?? inferMenuAction(e.option, e.targetType);
        return !e.deprioritized && !skippedOptions.has(lower) && action !== MenuAction.Examine;
    });
    if (actionableEntry) {
        if (!actionableEntry.action)
            actionableEntry.action = inferMenuAction(actionableEntry.option, actionableEntry.targetType);
        return actionableEntry;
    }

    // Priority 5: Walk here
    const walkEntry = entries.find((e) => {
        const lower = String(e.option || "").toLowerCase();
        return lower === "walk here";
    });
    if (walkEntry) {
        if (!walkEntry.action) walkEntry.action = inferMenuAction(walkEntry.option);
        return walkEntry;
    }

    // Priority 6: Fallback to first entry (may be deprioritized)
    const first = entries[0];
    if (first && !first.action) first.action = inferMenuAction(first.option);
    return first;
}

/**
 * Get the shift-click action index for an item based on ObjType configuration.
 * Returns -1 if no shift-click action is defined.
 */
export function getShiftClickActionIndex(objType: any): number {
    if (!objType) return -1;
    // Check for getShiftClickIndex method (ObjType)
    if (typeof objType.getShiftClickIndex === "function") {
        return objType.getShiftClickIndex();
    }
    // Fallback to shiftClickIndex property
    if (typeof objType.shiftClickIndex === "number") {
        const idx = objType.shiftClickIndex;
        if (idx >= 0 && idx <= 4 && objType.inventoryActions?.[idx]) {
            return idx;
        }
        // Default: check for Drop at index 4
        if (idx === -2 && objType.inventoryActions?.[4]?.toLowerCase() === "drop") {
            return 4;
        }
    }
    return -1;
}

/**
 * Spell validation result
 */
export type SpellValidationResult = {
    canCast: boolean;
    missingRunes?: Array<{ itemId: number; required: number; have: number }>;
    missingLevel?: { required: number; current: number };
    reason?: string;
};

/**
 * Validate if a spell can be cast based on SpellCastMetadata.
 * Checks magic level requirement and rune requirements.
 *
 * @param spell - The spell metadata from the menu entry
 * @param playerLevel - Current player magic level
 * @param inventoryContains - Function to check if inventory contains an item (itemId, quantity) => boolean
 * @returns Validation result indicating if spell can be cast and what's missing
 */
export function validateSpellRequirements(
    spell: SpellCastMetadata | undefined,
    playerLevel: number,
    inventoryContains: (itemId: number, quantity: number) => number, // Returns how many the player has
): SpellValidationResult {
    if (!spell) {
        return { canCast: false, reason: "No spell selected" };
    }

    // Check magic level requirement
    if (typeof spell.spellLevel === "number" && spell.spellLevel > 0) {
        if (playerLevel < spell.spellLevel) {
            return {
                canCast: false,
                missingLevel: { required: spell.spellLevel, current: playerLevel },
                reason: `Requires level ${spell.spellLevel} Magic (you have ${playerLevel})`,
            };
        }
    }

    // Check rune requirements
    if (Array.isArray(spell.runes) && spell.runes.length > 0) {
        const missingRunes: Array<{ itemId: number; required: number; have: number }> = [];

        for (const rune of spell.runes) {
            if (!rune || typeof rune.itemId !== "number" || typeof rune.quantity !== "number") {
                continue;
            }
            const have = inventoryContains(rune.itemId, rune.quantity);
            if (have < rune.quantity) {
                missingRunes.push({
                    itemId: rune.itemId,
                    required: rune.quantity,
                    have,
                });
            }
        }

        if (missingRunes.length > 0) {
            return {
                canCast: false,
                missingRunes,
                reason: "Missing required runes",
            };
        }
    }

    return { canCast: true };
}

/**
 * Check if player has a staff that provides infinite runes of a type.
 * Common staff rune substitutions in OSRS:
 * - Staff of fire/fire battlestaff: Fire runes
 * - Staff of water/water battlestaff: Water runes
 * - Staff of air/air battlestaff: Air runes
 * - Staff of earth/earth battlestaff: Earth runes
 * - Smoke battlestaff: Air + Fire runes
 * - Steam battlestaff: Fire + Water runes
 * - Mud battlestaff: Water + Earth runes
 * - Lava battlestaff: Fire + Earth runes
 * - Mist battlestaff: Air + Water runes
 * - Dust battlestaff: Air + Earth runes
 */
export const STAFF_RUNE_SUBSTITUTIONS: Record<number, number[]> = {
    // Elemental rune IDs
    556: [1381, 1397, 1387, 1401, 11787, 11789, 12795, 11785], // Air rune - air staff variants
    555: [1383, 1395, 1393, 1399, 11789, 12795, 11787, 11791], // Water rune - water staff variants
    554: [1387, 1393, 1401, 1399, 11785, 11787, 11789, 11791], // Fire rune - fire staff variants
    557: [1385, 1395, 1397, 1399, 11785, 11791, 12795, 1401], // Earth rune - earth staff variants
};

/**
 * Get how many of a rune the player effectively has, considering staff substitutions.
 */
export function getEffectiveRuneCount(
    runeId: number,
    inventoryCount: number,
    equippedWeaponId: number | undefined,
): number {
    // Check if equipped weapon provides infinite runes
    const providingStaves = STAFF_RUNE_SUBSTITUTIONS[runeId];
    if (
        providingStaves &&
        typeof equippedWeaponId === "number" &&
        providingStaves.includes(equippedWeaponId)
    ) {
        return Infinity; // Staff provides infinite runes of this type
    }
    return inventoryCount;
}
