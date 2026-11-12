/**
 * The general seed table is a set of subtables, not one pool. The Wiki (Drop table, "General seed
 * drop table"): `CombatCalculation = CombatLevel * 10`, then `random(CombatCalculation)` is rolled
 * and "less than 485" rolls the first subtable, "485 or greater, and less than 728" the second,
 * and so on. The dump carries them as `categories: [{ minimum, maximum_exclusive?, entries }]` with
 * `combat_level_multiplier: 10` (osrsreboxed-db `export_shared_subtables`).
 */

/** The structure this module accepts; anything else is ignored so the flat rows keep rolling. */
function validCategories(table) {
    const categories = table?.categories;
    if (!Array.isArray(categories) || categories.length === 0) return false;
    if (!Number.isSafeInteger(table.combat_level_multiplier) || table.combat_level_multiplier < 1) return false;
    let minimum = 0;
    for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        const last = i === categories.length - 1;
        if (!Array.isArray(category?.entries) || category.minimum !== minimum) return false;
        if (last) return category.maximum_exclusive === undefined;
        if (!Number.isSafeInteger(category.maximum_exclusive) || category.maximum_exclusive <= minimum) return false;
        minimum = category.maximum_exclusive;
    }
    return false;
}

/**
 * The category a kill by an NPC of `combatLevel` rolls. A level that is not a positive integer
 * (an NPC with no definition) rolls the first, lowest-level category rather than guessing a rarer one.
 * `randomInt(bound)` returns an integer in [0, bound).
 */
function select(categories, multiplier, combatLevel, randomInt) {
    if (!Number.isSafeInteger(combatLevel) || combatLevel < 1) return categories[0];
    const roll = randomInt(combatLevel * multiplier);
    for (const category of categories) {
        if (category.maximum_exclusive === undefined || roll < category.maximum_exclusive) return category;
    }
    return categories[categories.length - 1];
}

module.exports = { validCategories, select };
