/** RuneLite item-stat parameter ids used by the OSRS cache. */
export const ITEM_STAT_PARAMS = {
    attackStab: 0,
    attackSlash: 1,
    attackCrush: 2,
    attackMagic: 3,
    attackRanged: 4,
    defenceStab: 5,
    defenceSlash: 6,
    defenceCrush: 7,
    defenceMagic: 8,
    defenceRanged: 9,
    strength: 10,
    prayer: 11,
    rangedStrength: 189,
    magicDamage: 299,
} as const;

export type ItemStat = keyof typeof ITEM_STAT_PARAMS;
export type ItemStats = Record<ItemStat, number>;

export interface ItemStatSource {
    params?: { get(key: number): unknown };
    wearPos?: number;
    wearPos2?: number;
    wearPos3?: number;
    attackSpeed?: number;
}

export interface WornItem {
    itemId: number;
    slot: number;
}

export const ITEM_EQUIP_SLOT_PARAM = 1564;
export const ITEM_RANGED_STRENGTH_AMMO_PARAM = 12;
export const ITEM_ATTACK_SPEED_PARAM = 14;
export const ITEM_TWO_HANDED_OFFHAND_SLOT = 5;

const ITEM_STAT_KEYS = Object.keys(ITEM_STAT_PARAMS) as ItemStat[];

export function readItemStats(item: ItemStatSource | undefined): ItemStats {
    const stats = emptyItemStats();
    if (!item?.params) return stats;

    for (const key of ITEM_STAT_KEYS) {
        if (key === "rangedStrength") {
            stats.rangedStrength = readNumber(item.params.get(ITEM_RANGED_STRENGTH_AMMO_PARAM))
                + readNumber(item.params.get(ITEM_STAT_PARAMS.rangedStrength));
            continue;
        }
        const value = readNumber(item.params.get(ITEM_STAT_PARAMS[key]));
        stats[key] = key === "magicDamage" ? value / 10 : value;
    }
    return stats;
}

export function emptyItemStats(): ItemStats {
    return {
        attackStab: 0,
        attackSlash: 0,
        attackCrush: 0,
        attackMagic: 0,
        attackRanged: 0,
        defenceStab: 0,
        defenceSlash: 0,
        defenceCrush: 0,
        defenceMagic: 0,
        defenceRanged: 0,
        strength: 0,
        rangedStrength: 0,
        magicDamage: 0,
        prayer: 0,
    };
}

/** Returns the OSRS player-composition slot id stored in an item's cache params. */
export function itemEquipSlot(item: ItemStatSource | undefined): number | undefined {
    const value = item?.params?.get(ITEM_EQUIP_SLOT_PARAM) ?? item?.wearPos;
    return typeof value === "number" && Number.isInteger(value) && EQUIP_SLOTS.has(value)
        ? value
        : undefined;
}

/**
 * Add the candidate item to the worn totals, replacing the worn item in its cache-defined slot.
 * Returns undefined when the candidate has no recognized equipment slot.
 */
export function compareWornGear(
    candidate: ItemStatSource | undefined,
    wornItems: readonly WornItem[],
    loadItem: (id: number) => ItemStatSource | undefined,
): { current: ItemStats; after: ItemStats; delta: ItemStats; slot: number } | undefined {
    const slot = itemEquipSlot(candidate);
    if (slot === undefined) return undefined;

    const current = emptyItemStats();
    const replacementSlots = itemEquipSlots(candidate);
    const replaced = emptyItemStats();
    for (const worn of wornItems) {
        if (worn.itemId < 0) continue;
        const stats = readItemStats(loadItem(worn.itemId));
        addStats(current, stats);
        if (replacementSlots.has(worn.slot)) addStats(replaced, stats);
    }

    const after = { ...current };
    subtractStats(after, replaced);
    addStats(after, readItemStats(candidate));
    const delta = emptyItemStats();
    for (const key of ITEM_STAT_KEYS) delta[key] = after[key] - current[key];
    return { current, after, delta, slot };
}

/** Returns every worn slot occupied by an item according to its cache wear positions. */
export function itemEquipSlots(item: ItemStatSource | undefined): Set<number> {
    const slots = new Set<number>();
    const primary = itemEquipSlot(item);
    if (primary !== undefined) slots.add(primary);
    for (const value of [item?.wearPos2, item?.wearPos3]) {
        if (typeof value === "number" && Number.isInteger(value) && EQUIP_SLOTS.has(value)) slots.add(value);
    }
    return slots;
}

/** Returns an item's cache attack speed in ticks when the definition has one. */
export function itemAttackSpeed(item: ItemStatSource | undefined): number | undefined {
    const value = item?.params?.get(ITEM_ATTACK_SPEED_PARAM) ?? item?.attackSpeed;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export const ITEM_STAT_LABELS: Record<ItemStat, string> = {
    attackStab: "Stab attack",
    attackSlash: "Slash attack",
    attackCrush: "Crush attack",
    attackMagic: "Magic attack",
    attackRanged: "Ranged attack",
    defenceStab: "Stab defence",
    defenceSlash: "Slash defence",
    defenceCrush: "Crush defence",
    defenceMagic: "Magic defence",
    defenceRanged: "Ranged defence",
    strength: "Melee strength",
    rangedStrength: "Ranged strength",
    magicDamage: "Magic damage",
    prayer: "Prayer",
};

const EQUIP_SLOTS = new Set([0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13]);

function readNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addStats(target: ItemStats, add: ItemStats): void {
    for (const key of ITEM_STAT_KEYS) target[key] += add[key];
}

function subtractStats(target: ItemStats, subtract: ItemStats): void {
    for (const key of ITEM_STAT_KEYS) target[key] -= subtract[key];
}
