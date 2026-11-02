import foodData from "../../../../server/plugins/items/data/food.json";
import { findFoodDefinition, readFoodStats, type FoodDefinition, type FoodStats } from "./foodStats";

/** Food effects maintained by the server's item-consumption plugin. */
export const FOOD_DEFINITIONS = foodData.foods as FoodDefinition[];

export interface SkillBoost {
    flat: number;
    percent: number;
}

export interface PotionStats {
    name: string;
    skillBoosts?: Partial<Record<"attack" | "strength" | "defence" | "ranged" | "magic", SkillBoost>>;
    runEnergy?: number;
    stamina?: {
        durationMs: number;
        energyPerMovementTick: number;
    };
    unsupportedReason?: string;
}

const POTION_STATS: Record<string, PotionStats["skillBoosts"]> = {
    "attack potion": { attack: { flat: 3, percent: 0.1 } },
    "strength potion": { strength: { flat: 3, percent: 0.1 } },
    "defence potion": { defence: { flat: 3, percent: 0.1 } },
    "combat potion": { attack: { flat: 3, percent: 0.1 }, strength: { flat: 3, percent: 0.1 } },
    "super attack": { attack: { flat: 5, percent: 0.15 } },
    "super strength": { strength: { flat: 5, percent: 0.15 } },
    "super defence": { defence: { flat: 5, percent: 0.15 } },
    "super combat potion": {
        attack: { flat: 5, percent: 0.15 },
        strength: { flat: 5, percent: 0.15 },
        defence: { flat: 5, percent: 0.15 },
    },
    "ranging potion": { ranged: { flat: 4, percent: 0.1 } },
    "super ranging": { ranged: { flat: 5, percent: 0.15 } },
    "magic potion": { magic: { flat: 4, percent: 0 } },
    "super magic potion": { magic: { flat: 5, percent: 0.15 } },
};

const POTION_EFFECTS: Record<string, Pick<PotionStats, "runEnergy" | "stamina">> = {
    "energy potion": { runEnergy: 10 },
    "super energy": { runEnergy: 20 },
    "stamina potion": {
        runEnergy: 20,
        stamina: { durationMs: 2 * 60 * 1000, energyPerMovementTick: 0.7 },
    },
};

const ELEMENTAL_RUNES = new Set(["air", "water", "earth", "fire"]);

export interface RuneStats {
    name: string;
    rune: string;
    runeType: "elemental" | "catalytic";
    providesElement: boolean;
}

/** Looks up a food's recorded effects by the cache definition's item name. */
export function foodStatsForName(name: string): FoodStats | undefined {
    return readFoodStats(findFoodDefinition(name, FOOD_DEFINITIONS));
}

/** Returns recorded boosts for the potions implemented in the server potion plugin. */
export function potionStatsForName(name: string): PotionStats | undefined {
    const normalized = normalizeName(name).replace(/\s*\(\d\)$/, "");
    const effect = POTION_EFFECTS[normalized];
    const boosts = POTION_STATS[normalized];
    if (!effect && !boosts && !normalized.includes("potion") && !normalized.includes("mix")) return undefined;
    return boosts
        ? {
            name,
            skillBoosts: Object.fromEntries(Object.entries(boosts).map(([skill, boost]) => [skill, { ...boost }])),
            ...copyPotionEffects(effect),
        }
        : effect
            ? { name, ...copyPotionEffects(effect) }
        : { name, unsupportedReason: "This potion has effects that this stats model does not describe." };
}

/** Describes standard rune items; it does not infer spell charge capacity or spell bonuses. */
export function runeStatsForName(name: string): RuneStats | undefined {
    const match = normalizeName(name).match(/^(.+) rune$/);
    if (!match) return undefined;
    const rune = match[1];
    const providesElement = ELEMENTAL_RUNES.has(rune);
    return { name, rune, runeType: providesElement ? "elemental" : "catalytic", providesElement };
}

function normalizeName(name: string): string {
    return name.trim().toLocaleLowerCase("en");
}

function copyPotionEffects(effect: Pick<PotionStats, "runEnergy" | "stamina"> | undefined): Pick<PotionStats, "runEnergy" | "stamina"> {
    return {
        ...(effect?.runEnergy !== undefined ? { runEnergy: effect.runEnergy } : {}),
        ...(effect?.stamina ? { stamina: { ...effect.stamina } } : {}),
    };
}
