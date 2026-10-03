// Refreshes data/definitions/item-combat-styles.json from cache dbtable 78
// (combat styles). The cache is the source of truth for the slot (varp 43
// value), style and attack type; animation, sound, rapid and interface
// metadata are server-owned and preserved.
//
//   yarn dump:item-combat-styles
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";
import type {
    CombatStyleAttackType,
    CombatStyleDefinitions,
    CombatStyleKind,
} from "../src/main/typescript/elvarg/game/content/combat/CombatStyleDefinitions";

const COMBAT_STYLE_TABLE_ID = 78;
const STRING_TYPES = new Set([36, 42]);
const ATTACK_TYPE_BY_TOKEN: Record<string, CombatStyleAttackType> = {
    Stab: "STAB",
    Slash: "SLASH",
    Crush: "CRUSH",
    Magic: "MAGIC",
};

type CacheStyle = { slot: number; name: string; desc: string; graphic: number };

function decodeFields(buf: ByteBuffer, types: number[]): any[] {
    const fieldCount = buf.readUnsignedShortSmart();
    const out: any[] = new Array(fieldCount * types.length);
    for (let field = 0; field < fieldCount; field++) {
        for (let i = 0; i < types.length; i++) {
            const idx = field * types.length + i;
            out[idx] = STRING_TYPES.has(types[i]) ? buf.readString() : buf.readInt();
        }
    }
    return out;
}

function decodeRow(buf: ByteBuffer): { tableId: number; columns: Map<number, any[]> } {
    const columns = new Map<number, any[]>();
    let tableId = -1;
    while (buf.remaining > 0) {
        const opcode = buf.readUnsignedByte();
        if (opcode === 0) break;
        if (opcode === 4) {
            tableId = buf.readVarInt2();
        } else if (opcode === 3) {
            buf.readUnsignedByte();
            for (let columnId = buf.readUnsignedByte(); columnId !== 255; columnId = buf.readUnsignedByte()) {
                const typeCount = buf.readUnsignedByte();
                const types: number[] = [];
                for (let i = 0; i < typeCount; i++) types.push(buf.readUnsignedShortSmart());
                columns.set(columnId, decodeFields(buf, types));
            }
        } else {
            buf.offset = buf.length;
        }
    }
    return { tableId, columns };
}

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

function readCacheStyles(configs: CacheIndexDat2): Map<number, CacheStyle[]> {
    const byCategory = new Map<number, CacheStyle[]>();
    // Load the whole dbrow archive once: per-file getFile() re-reads the archive.
    const rows = configs.getArchive(38);
    for (const fileId of rows.fileIds) {
        const file = rows.getFile(fileId);
        if (!file) continue;
        const row = decodeRow(new ByteBuffer(new Int8Array(file.data)));
        if (row.tableId !== COMBAT_STYLE_TABLE_ID) continue;
        const category = (row.columns.get(0) ?? [])[0];
        const values = row.columns.get(1) ?? [];
        const styles: CacheStyle[] = [];
        for (let i = 0; i + 3 < values.length; i += 4) {
            styles.push({ slot: values[i], name: values[i + 1], desc: values[i + 2], graphic: values[i + 3] });
        }
        byCategory.set(category, styles);
    }
    return byCategory;
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
    fs.writeFileSync(outPath, serialize(output));
    console.log(
        `wrote ${outPath}: ${Object.keys(output.fightTypes).length} fight types, ` +
            `${Object.keys(output.weaponInterfaces).length} interfaces`,
    );
    for (const warning of warnings) console.warn(`WARN ${warning}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
