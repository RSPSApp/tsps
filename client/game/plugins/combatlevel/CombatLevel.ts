/** Combat-level calculations adapted from RuneLite's BSD-2-licensed Combat Level plugin. */
export type CombatLevels = { attack: number; strength: number; defence: number; hitpoints: number; ranged: number; prayer: number; magic: number };
const keys = ["attack", "strength", "defence", "hitpoints", "ranged", "prayer", "magic"] as const;
export type NextCombatLevels = Partial<Record<"melee" | "defenceHitpoints" | "ranged" | "magic" | "prayer", number>>;
function level(value: number): number { return Math.max(1, Math.min(99, Number.isFinite(value) ? Math.floor(value) : 1)); }

/** Unrounded combat level. Skill inputs must be real, not boosted, levels. */
export function preciseCombatLevel(skills: CombatLevels): number {
    const base = 0.25 * (level(skills.defence) + level(skills.hitpoints) + Math.floor(level(skills.prayer) / 2));
    const melee = 0.325 * (level(skills.attack) + level(skills.strength));
    const ranged = 0.325 * (level(skills.ranged) + Math.floor(level(skills.ranged) / 2));
    const magic = 0.325 * (level(skills.magic) + Math.floor(level(skills.magic) / 2));
    return base + Math.max(melee, ranged, magic);
}

export function combatLevel(skills: CombatLevels): number { return Math.max(3, Math.floor(preciseCombatLevel(skills))); }

export function wildernessCombatRange(combat: number, wildernessLevel: number): { min: number; max: number } {
    const w = Math.max(0, Math.floor(Number.isFinite(wildernessLevel) ? wildernessLevel : 0));
    return { min: Math.max(3, Math.floor(combat) - w), max: Math.min(126, Math.floor(combat) + w) };
}

/** RuneLite's grouped skill-level increments for reaching the next combat level. */
export function nextCombatLevels(skills: CombatLevels): NextCombatLevels {
    const { attack, strength, defence, hitpoints, magic, ranged, prayer } = Object.fromEntries(
        keys.map((key) => [key, level(skills[key])]),
    ) as CombatLevels;
    const next = combatLevel({ attack, strength, defence, hitpoints, magic, ranged, prayer }) + 1;
    const type = Math.max(0.325 * (attack + strength), 0.325 * (ranged + Math.floor(ranged / 2)), 0.325 * (magic + Math.floor(magic / 2)));
    const until = {
        melee: Math.ceil((-10 / 13) * (defence + hitpoints + Math.floor(prayer / 2) - 4 * next)) - strength - attack,
        defenceHitpoints: Math.ceil(4 * next - Math.floor(prayer / 2) - 4 * type) - hitpoints - defence,
        ranged: Math.ceil((2 / 3) * Math.ceil((-10 / 13) * (hitpoints + defence - 4 * next + Math.floor(prayer / 2)))) - ranged,
        magic: Math.ceil((2 / 3) * Math.ceil((-10 / 13) * (hitpoints + defence - 4 * next + Math.floor(prayer / 2)))) - magic,
        prayer: 2 * Math.ceil(-hitpoints - defence + 4 * next - 4 * type) - prayer,
    };
    const result: Partial<Record<keyof typeof until, number>> = {};
    if (attack + strength < 198) result.melee = until.melee;
    if (defence + hitpoints < 198) result.defenceHitpoints = until.defenceHitpoints;
    if (ranged < 99) result.ranged = until.ranged;
    if (magic < 99) result.magic = until.magic;
    if (prayer < 99) result.prayer = until.prayer;
    return result;
}

export function formatPreciseCombatLevel(value: number): string {
    return value.toFixed(3).replace(/\.?0+$/, "");
}
