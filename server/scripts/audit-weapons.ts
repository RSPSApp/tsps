// Audits every weapon in the cache against the OSRS Wiki's equipment stats table (the
// `infobox_bonuses` bucket): the 14 equipment bonuses, attack speed, attack range, the
// two-handed slot and the combat style that picks the weapon type.
//
//   yarn audit:weapons --wiki wiki.json --names AnimationID.java --out ../docs/audits/weapon-census.csv
//
// `wiki.json` is `{ "bonuses": [...], "items": [...] }` from the Wiki's bucket API (see
// docs/audits/weapons.md for the query). `--names` is RuneLite's gameval AnimationID.java,
// which names the cache's sequences (the Wiki does not publish attack animation ids).
import * as fs from "fs";
import path = require("path");

import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { ConfigType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/ConfigType";
import { ItemDefinition } from "../src/main/typescript/elvarg/game/definition/ItemDefinition";
import { FightType } from "../src/main/typescript/elvarg/game/content/combat/FightType";
import { WeaponInterfaces } from "../src/main/typescript/elvarg/game/content/combat/WeaponInterfaces";
import { WeaponProfiles } from "../src/main/typescript/elvarg/game/content/combat/WeaponProfile";
import { readCategoryNumbers } from "./combat-style-table";

const WEAPON_SLOT = 3;

/** The Wiki's stat column -> index in ItemDefinition.getBonuses(). */
const STAT_COLUMNS: Array<[string, number]> = [
    ["stab_attack_bonus", 0], ["slash_attack_bonus", 1], ["crush_attack_bonus", 2],
    ["magic_attack_bonus", 3], ["range_attack_bonus", 4],
    ["stab_defence_bonus", 5], ["slash_defence_bonus", 6], ["crush_defence_bonus", 7],
    ["magic_defence_bonus", 8], ["range_defence_bonus", 9],
    ["strength_bonus", 10], ["ranged_strength_bonus", 11],
    ["magic_damage_bonus", 12], ["prayer_bonus", 13],
];

const STAT_NAMES = ["stab", "slash", "crush", "magic", "range", "dstab", "dslash", "dcrush", "dmagic", "drange", "str", "rstr", "mdmg", "prayer"];

/** Wiki combat style -> the cache weapon category its type must be in (sync-weapon-types.ts). */
const WIKI_STYLE_CATEGORY: Record<string, string> = {
    "unarmed": "unarmed", "axe": "axe", "blunt": "blunt", "bludgeon": "blunt_bludgeon", "bow": "bow",
    "claw": "claw", "crossbow": "crossbow", "salamander": "flamer", "chinchompas": "grenade",
    "gun": "gun", "blaster": "gun", "slash sword": "hacksword", "slash": "hacksword",
    "2h sword": "heavysword", "pickaxe": "pickaxe", "polearm": "polearm", "polestaff": "polestaff",
    "scythe": "scythe", "spear": "spear", "banner": "banner", "spiked": "spiked",
    "stab sword": "stabsword", "staff": "staff", "bladed staff": "staff_bladed", "thrown": "thrown",
    "whip": "whip", "powered staff": "staff_selfpowering", "powered wand": "wand_selfpowering",
    "bulwark": "bulwark", "partisan": "partisan", "multi-style": "tribrid", "multi-melee": "multi_melee",
    "flail": "slashflail", "extending chain mace": "extending_chainmace",
};

type Wiki = { bonuses: any[]; items: any[] };
type ItemRow = Record<string, any> & { id: number; name: string };

function argValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

/** RuneLite's gameval AnimationID: `public static final int HUMAN_SWORD_SLASH = 390;`. */
function loadSeqNames(file: string | undefined): Map<number, string> {
    const names = new Map<number, string>();
    if (!file) return names;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const match = /int\s+([A-Z0-9_]+)\s*=\s*(\d+)\s*;/.exec(line);
        if (match && !names.has(Number(match[2]))) names.set(Number(match[2]), match[1]);
    }
    return names;
}

/** Item id -> the Wiki's `infobox_bonuses` row for it, joined through `infobox_item`'s ids. */
function wikiRows(wiki: Wiki): Map<number, any> {
    const bySub = new Map<string, any>();
    const byPage = new Map<string, any[]>();
    for (const row of wiki.bonuses) {
        bySub.set(row.page_name_sub ?? row.page_name, row);
        if (!byPage.has(row.page_name)) byPage.set(row.page_name, []);
        byPage.get(row.page_name)!.push(row);
    }
    const rows = new Map<number, any>();
    for (const item of wiki.items) {
        const row = bySub.get(item.page_name_sub ?? item.page_name)
            ?? (byPage.get(item.page_name)?.length === 1 ? byPage.get(item.page_name)![0] : undefined);
        if (!row) continue;
        for (const id of item.item_id ?? []) {
            const itemId = Number(id);
            if (Number.isInteger(itemId) && !rows.has(itemId)) rows.set(itemId, row);
        }
    }
    return rows;
}

function weaponSlotItems(): ItemRow[] {
    const items: ItemRow[] = [];
    for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
        const item = CacheDefinitions.getItem(id);
        if (!item?.name || item.name.toLowerCase() === "null" || item.wearPos !== WEAPON_SLOT) continue;
        if (item.noteTemplate !== -1 || item.placeholderTemplate !== -1) continue;
        items.push(item as unknown as ItemRow);
    }
    return items;
}

function cacheWeapons(): ItemRow[] {
    return weaponSlotItems().filter((item) => item.params?.get(ItemDefinition.ATTACK_SPEED_PARAM) !== undefined);
}

/** What the server asks a weapon for: its item, its type and the chosen style. */
function wielding(itemId: number, weaponInterface: WeaponInterfaces | undefined, fightType: FightType | null) {
    const items: any[] = [];
    items[3] = { getId: () => itemId, getDefinition: () => ItemDefinition.forId(itemId) };
    return { getEquipment: () => ({ getItems: () => items }), getWeapon: () => weaponInterface, getFightType: () => fightType } as any;
}

function csv(value: unknown): string {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
    const wikiFile = argValue("--wiki");
    if (!wikiFile) throw new Error("usage: audit-weapons --wiki <wiki.json> [--names <AnimationID.java>] [--out <csv>]");
    const names = loadSeqNames(argValue("--names"));
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    // The loader overlays data/definitions/item-gameplay.json on the cache (weapon type, attack
    // animation, requirements); it is what the running server uses.
    require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });

    const definitions = path.resolve(__dirname, "..", "data", "definitions");
    const styles = JSON.parse(fs.readFileSync(path.join(definitions, "item-combat-styles.json"), "utf8"));
    const fightTypeNames = new Map<FightType, string>();
    for (const key of Object.keys(styles.fightTypes)) fightTypeNames.set((FightType as any)[key], key);
    const configs = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore());
    const categoryNumbers = readCategoryNumbers(configs);
    const seqIds = new Set<number>();
    for (const file of configs.getArchive(ConfigType.DAT2.seqs).files) seqIds.add(file.id);

    const wiki = JSON.parse(fs.readFileSync(wikiFile, "utf8")) as Wiki;
    const wikiById = wikiRows(wiki);

    const header = ["id", "name", "type", "wiki_style", "wiki_page", "bonuses", "wiki_bonuses", "cache_bonuses",
        "speed", "cache_speed", "wiki_speed", "range", "cache_range", "wiki_range", "two_handed", "wiki_two_handed",
        "animations", "flags"];
    const lines: string[] = [];
    const findings: string[][] = [];
    const counts = { weaponSlotItems: 0, weapons: 0, untyped: 0, noWiki: 0, stats: 0, cacheStats: 0, speed: 0, speedOverride: 0, range: 0, twoHanded: 0, style: 0, noAnimation: 0, animationNotInCache: 0, animationOverrides: 0 };
    counts.weaponSlotItems = weaponSlotItems().length;

    for (const item of cacheWeapons()) {
        counts.weapons += 1;
        const def = ItemDefinition.forId(item.id);
        const type: string | undefined = (def.getWeaponInterface() as any)?.getName?.();
        if (!type) counts.untyped += 1;
        const weapon: any = type ? (WeaponInterfaces as any)[type] : undefined;
        const wikiRow = wikiById.get(item.id);
        const fightTypes: FightType[] = weapon?.getFightType() ?? [];

        const first = fightTypes[0] ?? null;
        const fake = wielding(item.id, weapon, first);
        const bonuses: number[] = def.getBonuses() ?? [];
        const speed = WeaponProfiles.attackSpeed(fake, weapon?.getSpeed() ?? -1);
        // Ranged reaches with attackDistance; melee with meleeAttackDistance (halberds 2, the
        // rest 1). Magic weapons cast spells, whose 10-tile reach is not the item's.
        const bonusTypes = fightTypes.map((fightType) => fightType.getBonusType());
        const ranged = bonusTypes.includes(4);
        const magic = ranged ? false : bonusTypes.includes(3);
        const range = ranged ? WeaponProfiles.attackDistance(fake, 6) : WeaponProfiles.meleeAttackDistance(fake, 1);
        const twoHanded = def.isDoubleHanded();

        const anims: string[] = [];
        const deviations: string[] = [];
        for (const fightType of fightTypes) {
            const player = wielding(item.id, weapon, fightType);
            const playerAnim = WeaponProfiles.attackAnimation(player, fightType.getAnimationAgainst(false), false);
            const npcAnim = WeaponProfiles.attackAnimation(player, fightType.getAnimationAgainst(true), true);
            const name = (id: number) => names.get(id) ?? `seq_${id}`;
            anims.push(`${fightTypeNames.get(fightType) ?? "?"}=${playerAnim}:${name(playerAnim)}`
                + (npcAnim !== playerAnim ? `|npc=${npcAnim}:${name(npcAnim)}` : ""));
            if (!(playerAnim > 0)) counts.noAnimation += 1;
            else if (!seqIds.has(playerAnim)) counts.animationNotInCache += 1;
            if (playerAnim > 0 && playerAnim !== fightType.getAnimationAgainst(false)) {
                deviations.push(`${fightTypeNames.get(fightType) ?? "?"}=${playerAnim}:${name(playerAnim)}`);
            }
        }
        if (deviations.length > 0) counts.animationOverrides += 1;

        const flags: string[] = [];
        if (deviations.length > 0) flags.push(`anim=${deviations.join(", ")}`);
        let wikiSpeed: number | undefined;
        let wikiRange: number | undefined;
        let wikiTwoHanded: boolean | undefined;
        let wikiStyle = "";

        if (!wikiRow) {
            counts.noWiki += 1;
            flags.push("no-wiki-stats");
        } else {
            wikiStyle = String(wikiRow.combat_style ?? "");
            const diffs: string[] = [];
            for (const [column, index] of STAT_COLUMNS) {
                const expected = Number(wikiRow[column] ?? 0);
                const actual = Number(bonuses[index] ?? 0);
                if (expected !== actual) diffs.push(`${STAT_NAMES[index]}=${actual} (wiki ${expected})`);
            }
            if (diffs.length > 0) {
                counts.stats += 1;
                if (def.hasCacheBonuses()) counts.cacheStats += 1;
            }
            wikiSpeed = wikiRow.weapon_attack_speed === undefined ? undefined : Number(wikiRow.weapon_attack_speed);
            if (wikiSpeed !== undefined && wikiSpeed !== speed) {
                counts.speed += 1;
                if (def.getAttackSpeed() !== speed) counts.speedOverride += 1;
                flags.push(`speed=${speed} (cache ${def.getAttackSpeed()}, wiki ${wikiSpeed})`);
            }
            wikiRange = wikiRow.weapon_attack_range === undefined ? undefined : Number(wikiRow.weapon_attack_range);
            if (wikiRange !== undefined && !magic && wikiRange !== range && !(wikiRange === 0 && !ranged)) {
                counts.range += 1;
                flags.push(`range=${range} (cache ${def.getAttackRange()}, wiki ${wikiRange})`);
            }
            const slot = String(wikiRow.equipment_slot ?? "").toLowerCase();
            wikiTwoHanded = slot === "2h" ? true : slot === "weapon" ? false : undefined;
            if (wikiTwoHanded !== undefined && wikiTwoHanded !== twoHanded) {
                counts.twoHanded += 1;
                flags.push(`two-handed=${twoHanded} (wiki ${slot})`);
            }
            const categoryName = WIKI_STYLE_CATEGORY[wikiStyle.trim().toLowerCase()];
            const actualCategory = weapon?.getCategory();
            const expectedCategory = categoryName ? categoryNumbers.get(categoryName) : undefined;
            if (expectedCategory !== undefined && actualCategory !== undefined && expectedCategory !== actualCategory) {
                counts.style += 1;
                flags.push(`type=${type} (wiki ${wikiStyle})`);
            }
            const diffText = diffs.length > 0 ? `stats: ${diffs.join(", ")}${def.hasCacheBonuses() ? " [cache]" : " [item-gameplay.json]"}` : "";
            if (diffText) flags.unshift(diffText);
        }

        const row = [
            item.id, item.name, type ?? "", wikiStyle, wikiRow?.page_name_sub ?? wikiRow?.page_name ?? "",
            bonuses.join(","), wikiRow ? STAT_COLUMNS.map(([column]) => Number(wikiRow[column] ?? 0)).join(",") : "",
            def.hasCacheBonuses() ? "cache" : "item-gameplay.json",
            String(speed), def.getAttackSpeed(), wikiSpeed ?? "", String(range), def.getAttackRange(), wikiRange ?? "",
            String(twoHanded), wikiTwoHanded ?? "",
            anims.join(";"), flags.join("; "),
        ];
        lines.push(row.map(csv).join(","));
        if (flags.length > 0) findings.push(row);
    }

    const out = argValue("--out");
    if (out) {
        const file = path.resolve(out);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, [header.join(","), ...lines].join("\n") + "\n");
        fs.writeFileSync(file.replace(/\.csv$/, "-findings.csv"),
            [header.join(","), ...findings.map((row) => row.map(csv).join(","))].join("\n") + "\n");
    }
    const byFlag = new Map<string, number>();
    for (const row of findings) {
        for (const flag of String(row[row.length - 1]).split("; ")) {
            const key = flag.split("=")[0].split(":")[0].trim();
            byFlag.set(key, (byFlag.get(key) ?? 0) + 1);
        }
    }
    console.log(JSON.stringify(counts));
    console.log("finding totals:", Object.fromEntries([...byFlag].sort((a, b) => b[1] - a[1])));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
