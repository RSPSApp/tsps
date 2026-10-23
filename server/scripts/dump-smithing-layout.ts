// Writes the anvil's product layout (plugins/skills/data/smithing-anvil-layout.json) from the
// cache. The smithing interface (312) draws its own products: client script 430 switches on
// the bar (enum 1253 of varbit smithing_bar_type) and, for each slot, calls script 431 with the
// slot's component, its label and the product obj, some behind a quest or members check. No
// enum or table holds that layout, so this reads it out of the script. Levels, bars and
// amounts stay in enums 844-846 and are read by the plugin when it loads.
//
//   yarn dump:smithing           # rewrite the layout
//   yarn dump:smithing --check   # exit 1 when the cache no longer matches the checked-in file
//
// Needs the cache in server/caches - run `yarn ensure-cache` first.
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { SWITCH, hasLongCounts, readScript } from "./cs2-reader";

const LAYOUT_SCRIPT = 430;
const SLOT_SCRIPT = 431;
const BAR_TYPE_ENUM = 1253;
const LEVEL_ENUM = 846;
const OUT = path.resolve(__dirname, "..", "plugins", "skills", "data", "smithing-anvil-layout.json");

/**
 * What the script's checks mean. Script 430 reads the quest varps (and, for keel parts, script
 * 9022's Pandemonium check) to grey a product out or hide it; the plugin asks the quest runtime
 * instead, since tsps quest stages are its own.
 */
const QUEST_BY_VARP: Record<number, string> = { 197: "the_tourist_trap", 314: "death_plateau" };
const QUEST_BY_SCRIPT: Record<number, string> = { 9022: "pandemonium" };

const OPCODES_TS = path.resolve(__dirname, "../../client/rs/cs2/Opcodes.ts");
const OP = new Map<string, number>();
for (const line of fs.readFileSync(OPCODES_TS, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(\d+),/.exec(line);
    if (m) OP.set(m[1].toLowerCase(), Number(m[2]));
}
const op = (name: string) => {
    const id = OP.get(name);
    if (id === undefined) throw new Error(`no opcode ${name}`);
    return id;
};

type Slot = { component: number; item: number; obj: string; label: string; members?: true; quest?: string };

function readLayout(): Map<number, Slot[]> {
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
    const file = index.getFileSmart(LAYOUT_SCRIPT);
    if (!file) throw new Error(`script ${LAYOUT_SCRIPT} is missing`);
    const { header, instructions: code } = readScript(new Int8Array(file.data), hasLongCounts(CachePipeline.getActive().revision));
    const [ICONST, SCONST, ILOAD, INVOKE, JUMP, GET_VARP, ISTORE, MAP_MEMBERS] =
        ["iconst", "sconst", "iload", "invoke", "jump", "get_varp", "istore", "map_members"].map(op);
    const COMPARES = new Set(["if_icmpne", "if_icmpeq", "if_icmplt", "if_icmpgt", "if_icmple", "if_icmpge"].map(op));

    // Each bar's case starts at its switch target; cases run until the next one.
    const switchAt = code.findIndex((ins) => ins.opcode === SWITCH);
    const cases = [...header.switches[Number(code[switchAt].operand)]]
        .map(([bar, offset]) => ({ bar, start: switchAt + 1 + offset }))
        .sort((a, b) => a.start - b.start);

    // A guard is `<value> iconst N if_icmpXX 1 jump K`: the K instructions after the jump only
    // run when the check passes. Local 0 is set by the script's prologue from varp 197.
    const guards: { from: number; to: number; members?: true; quest?: string }[] = [];
    let localZeroQuest: string | undefined;
    for (let i = 0; i + 3 < code.length; i++) {
        const ins = code[i];
        if (ins.opcode === GET_VARP && code[i + 3].opcode === JUMP && code[i + 4]?.opcode === ICONST && code[i + 5]?.opcode === ISTORE) {
            localZeroQuest = QUEST_BY_VARP[Number(ins.operand)]; // prologue: local 0 = varp below N
            continue;
        }
        if (code[i + 3].opcode !== JUMP || !COMPARES.has(code[i + 2].opcode)) continue;
        const from = i + 4;
        const to = from + Number(code[i + 3].operand);
        if (ins.opcode === MAP_MEMBERS) guards.push({ from, to, members: true });
        else if (ins.opcode === GET_VARP && QUEST_BY_VARP[Number(ins.operand)]) guards.push({ from, to, quest: QUEST_BY_VARP[Number(ins.operand)] });
        else if (ins.opcode === INVOKE && QUEST_BY_SCRIPT[Number(ins.operand)]) guards.push({ from, to, quest: QUEST_BY_SCRIPT[Number(ins.operand)] });
    }

    const objNames = CacheDefinitions.getObjNames();
    const layout = new Map<number, Slot[]>();
    for (let i = 0; i < code.length; i++) {
        // iconst <component uid>, sconst <label>, iconst <obj>, iconst 0 | iload 0, iload 1, invoke 431
        if (code[i].opcode !== INVOKE || code[i].operand !== SLOT_SCRIPT) continue;
        const [uid, label, obj, locked] = code.slice(i - 5, i - 1);
        if (uid.opcode !== ICONST || label.opcode !== SCONST || obj.opcode !== ICONST) throw new Error(`unexpected slot call at ${i}`);
        const item = Number(obj.operand);
        if (item < 0) continue;
        const barCase = cases.filter((c) => c.start <= i).pop();
        if (!barCase) continue;
        const slot: Slot = { component: Number(uid.operand) & 0xffff, item, obj: objNames.get(item) ?? String(item), label: String(label.operand) };
        for (const guard of guards) {
            if (i < guard.from || i >= guard.to) continue;
            if (guard.members) slot.members = true;
            if (guard.quest) slot.quest = guard.quest;
        }
        if (locked.opcode === ILOAD && Number(locked.operand) === 0) slot.quest = localZeroQuest;
        if (!layout.has(barCase.bar)) layout.set(barCase.bar, []);
        layout.get(barCase.bar)!.push(slot);
    }
    return layout;
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const layout = readLayout();
    const objNames = CacheDefinitions.getObjNames();
    const levels = CacheDefinitions.getEnumValues(LEVEL_ENUM);
    const problems: string[] = [];
    const bars = [...CacheDefinitions.getEnumValues(BAR_TYPE_ENUM)].map(([barType, bar]) => {
        const slots = layout.get(Number(bar)) ?? [];
        for (const slot of slots) if (!levels.has(slot.item)) problems.push(`${slot.obj} has no level in enum ${LEVEL_ENUM}`);
        return { barType, bar: Number(bar), obj: objNames.get(Number(bar)), slots };
    });
    const json = JSON.stringify({ generatedBy: "yarn dump:smithing", bars }, null, 2) + "\n";

    if (process.argv.includes("--check")) {
        const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
        if (current !== json) problems.push(`${path.relative(process.cwd(), OUT)} is out of date - run yarn dump:smithing`);
    } else {
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, json);
        console.log(`wrote ${bars.reduce((n, b) => n + b.slots.length, 0)} slots for ${bars.length} bars`);
    }
    for (const problem of problems) console.log(`! ${problem}`);
    process.exit(problems.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
