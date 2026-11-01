export interface FoodDefinition {
    name: string;
    heal?: number | { min?: number; max?: number; [key: string]: unknown };
    boost?: Record<string, number>;
    restore?: Record<string, number | RestoreFormula>;
    runEnergy?: number;
    stamina?: boolean;
    poisonImmunity?: number;
    curePoison?: boolean;
    cureVenom?: boolean;
    then?: Record<string, unknown>;
    special?: string;
    [key: string]: unknown;
}

export interface RestoreFormula {
    flat?: number;
    percent?: number;
}

export function formatRestore(value: number | RestoreFormula): string {
    if (typeof value === "number") return signed(value);
    const parts: string[] = [];
    if (typeof value.flat === "number") parts.push(signed(value.flat));
    if (typeof value.percent === "number") parts.push(`${Math.round(value.percent * 100)}% of base`);
    return parts.join(" + ") || "Not recorded";
}

export function formatPoisonImmunity(seconds: number): string {
    if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60} min`;
    return `${seconds} sec`;
}

function signed(value: number): string {
    return `${value > 0 ? "+" : ""}${value}`;
}

export interface FoodStats {
    name: string;
    heal?: number | { min?: number; max?: number };
    boost?: Record<string, number>;
    restore?: Record<string, number | RestoreFormula>;
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
    return definitions.find((definition) => normalizeName(definition.name) === key
        || (Array.isArray(definition.bites) && definition.bites.some((bite) => typeof bite === "string" && normalizeName(bite) === key)));
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
        ...(definition.restore ? { restore: normalizeRestore(definition.restore) } : {}),
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

function normalizeRestore(restore: FoodDefinition["restore"]): FoodStats["restore"] {
    if (!restore || typeof restore !== "object" || Array.isArray(restore)) return undefined;
    const normalized: NonNullable<FoodStats["restore"]> = {};
    for (const [skill, value] of Object.entries(restore)) {
        if (typeof value === "number" && Number.isFinite(value)) normalized[skill] = value;
        else if (value && typeof value === "object" && !Array.isArray(value)) {
            const formula: RestoreFormula = {};
            if (typeof value.flat === "number" && Number.isFinite(value.flat)) formula.flat = value.flat;
            if (typeof value.percent === "number" && Number.isFinite(value.percent)) formula.percent = value.percent;
            if (formula.flat !== undefined || formula.percent !== undefined) normalized[skill] = formula;
        }
    }
    return Object.keys(normalized).length ? normalized : undefined;
}

function isHealRange(value: FoodDefinition["heal"]): value is { min?: number; max?: number } {
    return typeof value === "object" && value !== null
        && typeof value.min === "number" && typeof value.max === "number";
}

function normalizeName(name: string): string {
    return name.trim().toLocaleLowerCase("en");
}
