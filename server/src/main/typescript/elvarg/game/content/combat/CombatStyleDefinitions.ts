import * as fs from "fs";
import * as path from "path";

export type CombatStyleAttackType = "STAB" | "SLASH" | "CRUSH" | "MAGIC" | "RANGE";
export type CombatStyleKind = "ACCURATE" | "AGGRESSIVE" | "DEFENSIVE" | "CONTROLLED";

export interface FightTypeDefinition {
    name: string;
    animation: number;
    childId: number;
    attackType: CombatStyleAttackType;
    style: CombatStyleKind;
    sound: string;
    rapid?: boolean;
}

export interface WeaponInterfaceDefinition {
    interfaceId: number;
    nameLineId: number;
    speed: number;
    category: number;
    specialBar?: number;
    specialMeter?: number;
    fightTypes: string[];
}

export interface CombatStyleDefinitions {
    $comment?: string;
    cache?: string;
    fightTypes: Record<string, FightTypeDefinition>;
    weaponInterfaces: Record<string, WeaponInterfaceDefinition>;
}

export const COMBAT_STYLES_FILE = "data/definitions/item-combat-styles.json";

let cached: CombatStyleDefinitions | undefined;

export function loadCombatStyleDefinitions(): CombatStyleDefinitions {
    if (cached) {
        return cached;
    }
    const file = path.resolve(COMBAT_STYLES_FILE);
    if (!fs.existsSync(file)) {
        throw new Error(`Missing combat style definitions: ${file}`);
    }
    cached = JSON.parse(fs.readFileSync(file, "utf8")) as CombatStyleDefinitions;
    return cached;
}
