// Refreshes data/definitions/item-combat-styles.json from cache dbtable 78
// (combat styles). The cache is the source of truth for the slot (varp 43
// value), style and attack type; animation, sound, rapid and interface
// metadata are server-owned and preserved.
//
//   yarn dump:item-combat-styles [--check]
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { readCacheStyles } from "./combat-style-table";
import type {
    CombatStyleAttackType,
    CombatStyleDefinitions,
    CombatStyleKind,
} from "../src/main/typescript/elvarg/game/content/combat/CombatStyleDefinitions";

const ATTACK_TYPE_BY_TOKEN: Record<string, CombatStyleAttackType> = {
    Stab: "STAB",
    Slash: "SLASH",
    Crush: "CRUSH",
    Magic: "MAGIC",
};

function tokens(desc: string): string[] {
    return [...String(desc).matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
}

function deriveStyle(desc: string, fallback: CombatStyleKind): CombatStyleKind {
    const t = tokens(desc);
    if (t.includes("Shared XP")) return "CONTROLLED";
    if (t.includes("Strength XP")) return "AGGRESSIVE";
    if (t.includes("Attack XP")) return "ACCURATE";
    if (t.includes("Defence XP")) return "DEFENSIVE";
    return fallback;
}

function deriveAttackType(desc: string, fallback: CombatStyleAttackType): CombatStyleAttackType {
    const t = tokens(desc);
    for (const token of t) {
        if (ATTACK_TYPE_BY_TOKEN[token]) return ATTACK_TYPE_BY_TOKEN[token];
    }
    if (t.includes("Ranged XP")) return "RANGE";
    if (t.includes("Magic XP")) return "MAGIC";
    return fallback;
}

function slug(name: string): string {
    return String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** One line per entry so cache bumps diff cleanly. */
function serialize(data: CombatStyleDefinitions): string {
    const lines: string[] = ["{"];
    lines.push(`  "$comment": ${JSON.stringify(data.$comment ?? "")},`);
    lines.push(`  "cache": ${JSON.stringify(data.cache ?? null)},`);
    const section = (name: string, entries: Record<string, unknown>, last: boolean) => {
        lines.push(`  ${JSON.stringify(name)}: {`);
        const keys = Object.keys(entries);
        keys.forEach((key, index) => {
            const suffix = index === keys.length - 1 ? "" : ",";
            lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(entries[key])}${suffix}`);
        });
        lines.push(`  }${last ? "" : ","}`);
    };
    section("fightTypes", data.fightTypes, false);
    section("weaponInterfaces", data.weaponInterfaces, true);
    lines.push("}");
    return lines.join("\n") + "\n";
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
    const cacheStyles = readCacheStyles(configs);

    const outPath = path.resolve(__dirname, "..", "data", "definitions", "item-combat-styles.json");
    if (!fs.existsSync(outPath)) {
        throw new Error(`Missing ${outPath}; restore it from git before dumping.`);
    }
    const data = JSON.parse(fs.readFileSync(outPath, "utf8")) as CombatStyleDefinitions;
    const warnings: string[] = [];
    const writtenBy = new Map<string, { category: number; style: string; attackType: string }>();

    for (const [interfaceName, weapon] of Object.entries(data.weaponInterfaces)) {
        const styles = cacheStyles.get(weapon.category) ?? [];
        if (styles.length === 0) warnings.push(`${interfaceName}: no cache styles for category ${weapon.category}`);
        const list: string[] = [];
        for (const style of styles) {
            const existingKey = weapon.fightTypes.find(
                (key) => data.fightTypes[key]?.childId === style.slot,
            );
            const key = existingKey ?? `${interfaceName}_${slug(style.name)}`;
            const existing = data.fightTypes[key];
            if (!existing) warnings.push(`${interfaceName}: adding ${key} (slot ${style.slot}); animation/sound need review`);
            const styleKind = deriveStyle(style.desc, existing?.style ?? "ACCURATE");
            const attackType = deriveAttackType(style.desc, existing?.attackType ?? "CRUSH");
            const previous = writtenBy.get(key);
            if (previous && (previous.style !== styleKind || previous.attackType !== attackType)) {
                warnings.push(
                    `${key}: shared by category ${previous.category} (${previous.style}/${previous.attackType}) ` +
                        `and ${weapon.category} (${styleKind}/${attackType})`,
                );
            }
            data.fightTypes[key] = {
                ...(existing ?? { animation: 0, sound: "WEAPON" }),
                name: style.name,
                childId: style.slot,
                style: styleKind,
                attackType,
            };
            writtenBy.set(key, { category: weapon.category, style: styleKind, attackType });
            list.push(key);
        }
        for (const key of weapon.fightTypes) {
            if (!styles.some((style) => style.slot === data.fightTypes[key]?.childId)) {
                warnings.push(`${interfaceName}: dropping stale fight type ${key}`);
            }
        }
        weapon.fightTypes = list;
    }

    const referenced = new Set(Object.values(data.weaponInterfaces).flatMap((weapon) => weapon.fightTypes));
    for (const key of Object.keys(data.fightTypes)) {
        if (!referenced.has(key)) {
            warnings.push(`dropping unreferenced fight type ${key}; remove any FightType.${key} reference`);
            delete data.fightTypes[key];
        }
    }

    const output: CombatStyleDefinitions = {
        ...data,
        $comment:
            "Generated by server/scripts/dump-item-combat-styles.ts from cache dbtable 78. " +
            "Cache-derived fields (name, childId, style, attackType) refresh from the cache; " +
            "animation, sound, rapid and interface metadata are preserved by the dump.",
        cache: (CachePipeline as any).getActive?.()?.name ?? data.cache,
    };
    const serialized = serialize(output);
    if (process.argv.includes("--check")) {
        if (fs.readFileSync(outPath, "utf8") !== serialized) {
            throw new Error(`${outPath} is out of date; run yarn dump:item-combat-styles`);
        }
    } else {
        fs.writeFileSync(outPath, serialized);
    }
    console.log(
        `${process.argv.includes("--check") ? "checked" : "wrote"} ${outPath}: ${Object.keys(output.fightTypes).length} fight types, ` +
            `${Object.keys(output.weaponInterfaces).length} interfaces`,
    );
    for (const warning of warnings) console.warn(`WARN ${warning}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
