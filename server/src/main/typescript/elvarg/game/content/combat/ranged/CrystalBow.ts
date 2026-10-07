import { ItemIdentifiers } from "../../../../util/ItemIdentifiers";

const CRYSTAL_BOW_STAGE_ORDER: number[][] = [
    [ItemIdentifiers.CRYSTAL_BOW_FULL, ItemIdentifiers.CRYSTAL_BOW_FULL_I_],
    [ItemIdentifiers.CRYSTAL_BOW_9_10, ItemIdentifiers.CRYSTAL_BOW_9_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_8_10, ItemIdentifiers.CRYSTAL_BOW_8_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_7_10, ItemIdentifiers.CRYSTAL_BOW_7_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_6_10, ItemIdentifiers.CRYSTAL_BOW_6_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_5_10, ItemIdentifiers.CRYSTAL_BOW_5_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_4_10, ItemIdentifiers.CRYSTAL_BOW_4_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_3_10, ItemIdentifiers.CRYSTAL_BOW_3_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_2_10, ItemIdentifiers.CRYSTAL_BOW_2_10_I_],
    [ItemIdentifiers.CRYSTAL_BOW_1_10, ItemIdentifiers.CRYSTAL_BOW_1_10_I_],
];

const CRYSTAL_BOW_ATTACK_BONUSES = [100, 100, 96, 92, 88, 84, 80, 76, 72, 68];
const CRYSTAL_BOW_RANGED_STRENGTHS = [78, 78, 76, 74, 72, 70, 68, 66, 64, 62];
const STATIC_CRYSTAL_BOW_IDS = new Set<number>([
    ItemIdentifiers.CRYSTAL_BOW,
    ItemIdentifiers.CRYSTAL_BOW_3,
]);
const EMPTY_CRYSTAL_BOW_IDS = new Set<number>([
    ItemIdentifiers.NEW_CRYSTAL_BOW,
    ItemIdentifiers.NEW_CRYSTAL_BOW_I_,
    ItemIdentifiers.CRYSTAL_BOW_INACTIVE_,
]);

const STAGE_INDEX_BY_ITEM_ID = new Map<number, number>();
for (let stageIndex = 0; stageIndex < CRYSTAL_BOW_STAGE_ORDER.length; stageIndex++) {
    for (const itemId of CRYSTAL_BOW_STAGE_ORDER[stageIndex]) {
        STAGE_INDEX_BY_ITEM_ID.set(itemId, stageIndex);
    }
}

export const CRYSTAL_BOW_ALL_WEAPON_IDS: number[] = [
    ...EMPTY_CRYSTAL_BOW_IDS,
    ...CRYSTAL_BOW_STAGE_ORDER.flat(),
    ...STATIC_CRYSTAL_BOW_IDS,
];

export const CRYSTAL_BOW_SHOTS_PER_STAGE = 250;

/**
 * Bows of Faerdhinen fire their own crystal arrows, each version its own colour
 * (RuneLite SpotanimID SP_ATTACK_ARROW_TRAVEL/LAUNCH_FAERDHINEN_*).
 */
export const BOW_OF_FAERDHINEN_ARROWS: { bow: number; travel: number; launch: number }[] = [
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN, travel: 1887, launch: 1888 },
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__18, travel: 1887, launch: 1888 }, // Bounty Hunter
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C_, travel: 1922, launch: 1923 }, // infinite
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__4, travel: 1924, launch: 1925 }, // Ithell
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__6, travel: 1926, launch: 1927 }, // Iorwerth
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__8, travel: 1928, launch: 1929 }, // Trahaearn
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__10, travel: 1930, launch: 1931 }, // Cadarn
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__12, travel: 1932, launch: 1933 }, // Crwys
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__14, travel: 1922, launch: 1923 }, // Meilyr: no arrow of its own
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__16, travel: 1934, launch: 1935 }, // Amlodd
    { bow: ItemIdentifiers.BOW_OF_FAERDHINEN_C__19, travel: 1922, launch: 1923 }, // Deadman
];
export const BOW_OF_FAERDHINEN_IDS: number[] = BOW_OF_FAERDHINEN_ARROWS.map(({ bow }) => bow);
export const CRYSTAL_BOW_PROJECTILE_ID = 249; // SP_ATTACK_GLOW_ARROW_TRAVEL

export function isCrystalBow(itemId: number): boolean {
    return STAGE_INDEX_BY_ITEM_ID.has(itemId) || STATIC_CRYSTAL_BOW_IDS.has(itemId) || EMPTY_CRYSTAL_BOW_IDS.has(itemId);
}

export function isChargedCrystalBow(itemId: number): boolean {
    return STAGE_INDEX_BY_ITEM_ID.has(itemId) || STATIC_CRYSTAL_BOW_IDS.has(itemId);
}

export function isEmptyCrystalBow(itemId: number): boolean {
    return EMPTY_CRYSTAL_BOW_IDS.has(itemId);
}

export function getCrystalBowAttackBonus(itemId: number): number | null {
    const stageIndex = STAGE_INDEX_BY_ITEM_ID.get(itemId);
    return stageIndex == null ? null : CRYSTAL_BOW_ATTACK_BONUSES[stageIndex] ?? null;
}

export function getCrystalBowRangedStrength(itemId: number): number | null {
    const stageIndex = STAGE_INDEX_BY_ITEM_ID.get(itemId);
    return stageIndex == null ? null : CRYSTAL_BOW_RANGED_STRENGTHS[stageIndex] ?? null;
}

export function getNextCrystalBowItemId(itemId: number): number | null {
    const stageIndex = STAGE_INDEX_BY_ITEM_ID.get(itemId);
    if (stageIndex == null) {
        return null;
    }
    const isImbued = itemId >= ItemIdentifiers.CRYSTAL_BOW_FULL_I_;
    if (stageIndex >= CRYSTAL_BOW_STAGE_ORDER.length - 1) {
        return isImbued ? ItemIdentifiers.NEW_CRYSTAL_BOW_I_ : ItemIdentifiers.NEW_CRYSTAL_BOW;
    }
    const nextStage = CRYSTAL_BOW_STAGE_ORDER[stageIndex + 1];
    return nextStage?.[isImbued ? 1 : 0] ?? null;
}
