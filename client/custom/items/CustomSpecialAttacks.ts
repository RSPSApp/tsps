import { CustomItemRegistry } from "./CustomItemRegistry";

/**
 * The cache's special attack weapons: item id -> energy cost in tenths of a percent (500 = 50%).
 * The combat tab's script (187) hides the special attack bar for a weapon with no entry.
 */
export const SPECIAL_ATTACK_ENUM = 906;

/**
 * Enum 906's value for a custom weapon with a `specialAttack` (custom-items.json): its own
 * `energy`, else the cost of the weapon it borrows the special from (`baseCost(from)`).
 * Undefined for anything else (and for a `from` without a cache cost), which the cache answers.
 */
export function customSpecialAttackCost(
    itemId: number,
    baseCost: (fromItemId: number) => number | undefined,
): number | undefined {
    const special = CustomItemRegistry.get(itemId)?.definition.specialAttack;
    if (!special) return undefined;
    if (Number.isInteger(special.energy)) return special.energy! * 10;
    return Number.isInteger(special.from) ? baseCost(special.from!) : undefined;
}
