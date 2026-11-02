import type { ItemStats } from "./itemStats";

export type ItemStatsRow = { label: string; value: string; delta?: number; inverse?: boolean; baseValue?: string; changeValue?: string };
export type ItemStatsGroup = { title: string; rows: ItemStatsRow[] };

const ATTACK_KEYS = ["attackStab", "attackSlash", "attackCrush", "attackMagic", "attackRanged"] as const;
const DEFENCE_KEYS = ["defenceStab", "defenceSlash", "defenceCrush", "defenceMagic", "defenceRanged"] as const;
const OTHER_KEYS = ["strength", "rangedStrength", "magicDamage", "prayer"] as const;
const LABELS: Record<keyof ItemStats, string> = {
    attackStab: "Stab", attackSlash: "Slash", attackCrush: "Crush", attackMagic: "Magic", attackRanged: "Ranged",
    defenceStab: "Stab", defenceSlash: "Slash", defenceCrush: "Crush", defenceMagic: "Magic", defenceRanged: "Ranged",
    strength: "Melee Str", rangedStrength: "Range Str", magicDamage: "Magic Dmg", prayer: "Prayer",
};

export function buildCombatStatGroups(stats: ItemStats, delta?: ItemStats, showBase = false): ItemStatsGroup[] {
    const makeRows = (keys: readonly (keyof ItemStats)[]): ItemStatsRow[] => keys
        .filter((key) => delta === undefined || showBase ? stats[key] !== 0 || (delta?.[key] ?? 0) !== 0 : delta[key] !== 0)
        .map((key) => {
            const rawDifference = delta?.[key] ?? 0;
            const difference = key === "magicDamage" ? Math.round(rawDifference * 10) / 10 : rawDifference;
            const displayedStat = key === "magicDamage" ? Math.round(stats[key] * 10) / 10 : stats[key];
            // RuneLite shows the replacement delta alone unless base stats are enabled.
            const change = `${difference > 0 ? "+" : ""}${difference}${key === "magicDamage" ? "%" : ""}`;
            const base = `${displayedStat}${key === "magicDamage" ? "%" : ""}`;
            const value = delta === undefined ? base
                : showBase ? difference === 0 ? base : `${base} (${change})` : change;
            return { label: LABELS[key], value, delta: difference,
                ...(delta !== undefined && showBase ? { baseValue: base,
                    ...(difference !== 0 ? { changeValue: change } : {}) } : {}) };
        });
    return [
        { title: "", rows: makeRows(OTHER_KEYS) },
        { title: "Attack Bonus", rows: makeRows(ATTACK_KEYS) },
        { title: "Defence Bonus", rows: makeRows(DEFENCE_KEYS) },
    ].filter(({ rows }) => rows.length > 0);
}

/** Format an inline stat row while keeping labels and base values white. */
export function formatItemStatsRow(
    row: ItemStatsRow,
    fit: (text: string) => string,
): string {
    const prefix = `${row.label}: `;
    const plainValue = row.baseValue !== undefined
        ? row.changeValue !== undefined ? `${row.baseValue} (${row.changeValue})` : row.baseValue
        : row.value;
    const fitted = fit(`${prefix}${plainValue}`);
    if (row.baseValue !== undefined && row.changeValue !== undefined) {
        const baseMarker = `${prefix}${row.baseValue} (`;
        const at = fitted.indexOf(baseMarker);
        if (at >= 0) {
            const changeStart = at + baseMarker.length;
            const close = fitted.indexOf(")", changeStart);
            const change = fitted.slice(changeStart, close < 0 ? undefined : close);
            const better = row.inverse ? (row.delta ?? 0) < 0 : (row.delta ?? 0) > 0;
            const worse = row.inverse ? (row.delta ?? 0) > 0 : (row.delta ?? 0) < 0;
            const tint = better ? "33ee33" : worse ? "ee3333" : "ffffff";
            return `<col=ffffff>${fitted.slice(0, changeStart)}</col><col=${tint}>${change}</col><col=ffffff>${close < 0 ? "" : ")"}</col>`;
        }
    }
    if (row.delta === undefined || row.delta === 0 || row.baseValue !== undefined) return `<col=ffffff>${fitted}</col>`;
    const labelAt = fitted.indexOf(prefix);
    if (labelAt < 0) return `<col=ffffff>${fitted}</col>`;
    const valueStart = labelAt + prefix.length;
    const better = row.inverse ? row.delta < 0 : row.delta > 0;
    const tint = better ? "33ee33" : "ee3333";
    return `<col=ffffff>${fitted.slice(0, valueStart)}</col><col=${tint}>${fitted.slice(valueStart)}</col>`;
}

export function shouldShowWeightRow(weightKg: number, changeKg: number | undefined, showBase: boolean): boolean {
    return showBase ? weightKg !== 0 || (changeKg !== undefined && changeKg !== 0) : weightKg !== 0;
}

export function shouldShowSpeedRow(speed: number | undefined, change: number | undefined, showBase: boolean): boolean {
    const base = speed ?? 0;
    return change === undefined ? base !== 0 : showBase ? base !== 0 || change !== 0 : change !== 0;
}
