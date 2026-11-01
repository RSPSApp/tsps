import type { ItemStats } from "./itemStats";

export type ItemStatsRow = { label: string; value: string; delta?: number };
export type ItemStatsGroup = { title: string; rows: ItemStatsRow[] };

const ATTACK_KEYS = ["attackStab", "attackSlash", "attackCrush", "attackMagic", "attackRanged"] as const;
const DEFENCE_KEYS = ["defenceStab", "defenceSlash", "defenceCrush", "defenceMagic", "defenceRanged"] as const;
const OTHER_KEYS = ["strength", "rangedStrength", "magicDamage", "prayer"] as const;
const LABELS: Record<keyof ItemStats, string> = {
    attackStab: "Stab", attackSlash: "Slash", attackCrush: "Crush", attackMagic: "Magic", attackRanged: "Ranged",
    defenceStab: "Stab", defenceSlash: "Slash", defenceCrush: "Crush", defenceMagic: "Magic", defenceRanged: "Ranged",
    strength: "Melee strength", rangedStrength: "Ranged strength", magicDamage: "Magic damage", prayer: "Prayer",
};

export function buildCombatStatGroups(stats: ItemStats, delta?: ItemStats): ItemStatsGroup[] {
    const makeRows = (keys: readonly (keyof ItemStats)[]): ItemStatsRow[] => keys
        .filter((key) => stats[key] !== 0 || (delta?.[key] ?? 0) !== 0)
        .map((key) => {
            const difference = delta?.[key] ?? 0;
            const value = `${stats[key]}${difference === 0 ? "" : ` (${difference > 0 ? "+" : ""}${difference})`}`;
            return { label: LABELS[key], value, delta: difference };
        });
    return [
        { title: "Attack bonuses", rows: makeRows(ATTACK_KEYS) },
        { title: "Defence bonuses", rows: makeRows(DEFENCE_KEYS) },
        { title: "Other bonuses", rows: makeRows(OTHER_KEYS) },
    ].filter(({ rows }) => rows.length > 0);
}
