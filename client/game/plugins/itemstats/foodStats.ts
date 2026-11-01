export interface FoodDefinition {
    name: string;
    heal?: number | { min?: number; max?: number; [key: string]: unknown };
    boost?: Record<string, number>;
    restore?: Record<string, number>;
    runEnergy?: number;
    stamina?: boolean;
    poisonImmunity?: number;
    curePoison?: boolean;
    cureVenom?: boolean;
    then?: Record<string, unknown>;
    special?: string;
    [key: string]: unknown;
}

export interface FoodStats {
    name: string;
    heal?: number | { min?: number; max?: number };
    boost?: Record<string, number>;
    restore?: Record<string, number>;
    runEnergy?: number;
    stamina?: boolean;
    poisonImmunity?: number;
    curePoison?: boolean;
    cureVenom?: boolean;
    followUp?: Record<string, unknown>;
    special?: string;
    requiresContext: boolean;
}

/** Finds a food record by its canonical cache item name, ignoring case and outer whitespace. */
export function findFoodDefinition(name: string, definitions: readonly FoodDefinition[]): FoodDefinition | undefined {
    const key = normalizeName(name);
    return definitions.find((definition) => normalizeName(definition.name) === key);
}

/** Returns known food effects without inventing values for effects that need player context. */
export function readFoodStats(definition: FoodDefinition | undefined): FoodStats | undefined {
    if (!definition) return undefined;
    const heal = typeof definition.heal === "number"
        ? definition.heal
        : isHealRange(definition.heal)
            ? { min: definition.heal.min, max: definition.heal.max }
            : undefined;
    const knownEffects = Boolean(
        heal !== undefined || definition.boost || definition.restore || definition.runEnergy !== undefined
        || definition.stamina || definition.poisonImmunity !== undefined || definition.curePoison
        || definition.cureVenom || definition.then || definition.special,
    );
    return {
        name: definition.name,
        ...(heal !== undefined ? { heal } : {}),
        ...(definition.boost ? { boost: { ...definition.boost } } : {}),
        ...(definition.restore ? { restore: { ...definition.restore } } : {}),
        ...(typeof definition.runEnergy === "number" ? { runEnergy: definition.runEnergy } : {}),
        ...(typeof definition.stamina === "boolean" ? { stamina: definition.stamina } : {}),
        ...(typeof definition.poisonImmunity === "number" ? { poisonImmunity: definition.poisonImmunity } : {}),
        ...(typeof definition.curePoison === "boolean" ? { curePoison: definition.curePoison } : {}),
        ...(typeof definition.cureVenom === "boolean" ? { cureVenom: definition.cureVenom } : {}),
        ...(definition.then ? { followUp: { ...definition.then } } : {}),
        ...(definition.special ? { special: definition.special } : {}),
        requiresContext: !knownEffects || typeof definition.heal === "object" || Boolean(definition.then || definition.special),
    };
}

function isHealRange(value: FoodDefinition["heal"]): value is { min?: number; max?: number } {
    return typeof value === "object" && value !== null
        && typeof value.min === "number" && typeof value.max === "number";
}

function normalizeName(name: string): string {
    return name.trim().toLocaleLowerCase("en");
}
