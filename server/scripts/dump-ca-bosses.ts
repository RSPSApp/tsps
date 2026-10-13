// Writes plugins/combatachievements/data/bosses.json: for each Combat Achievements monster (enum
// 3970), the kill-count varps the boss pages show (script 4778, summed where it adds several) and
// the varbit holding how many of its tasks are done (script 4780). Both scripts are one switch on
// the monster key; the cache gives no other way to read the pairing.
// Usage: TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' ts-node ./scripts/dump-ca-bosses.ts
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { GamevalKind, Gamevals } from "../src/main/typescript/elvarg/game/cache/Gamevals";
import { SWITCH, hasLongCounts, readScript } from "./cs2-reader";

const MONSTER_ENUM = 3970;
const KILL_COUNT_SCRIPT = 4778;
const TASK_COUNT_SCRIPT = 4780;
const GET_VARP = 1;
const GET_VARBIT = 25;
const ISTORE = 34;
const OUT = path.resolve(__dirname, "../plugins/combatachievements/data/bosses.json");

/** Monster key -> the vars one case of the script's switch reads before storing its result. */
function switchReads(scriptId: number, opcode: number): Map<number, number[]> {
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
    const file = index.getFileSmart(scriptId);
    if (!file) throw new Error(`script ${scriptId} is missing`);
    const { header, instructions } = readScript(new Int8Array(file.data), hasLongCounts(CachePipeline.getActive().revision));
    const at = instructions.findIndex((instruction) => instruction.opcode === SWITCH);
    const reads = new Map<number, number[]>();
    for (const [key, offset] of header.switches[Number(instructions[at].operand)]) {
        const vars: number[] = [];
        for (let i = at + 1 + offset; i < instructions.length && instructions[i].opcode !== ISTORE; i++) {
            if (instructions[i].opcode === opcode) vars.push(Number(instructions[i].operand));
        }
        reads.set(key, vars);
    }
    return reads;
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const gamevals = new Gamevals();
    const varps = gamevals.namesOf(GamevalKind.VARP);
    const varbits = gamevals.namesOf(GamevalKind.VARBIT);
    const kills = switchReads(KILL_COUNT_SCRIPT, GET_VARP);
    const tasks = switchReads(TASK_COUNT_SCRIPT, GET_VARBIT);
    const bosses = [];
    for (const [key, name] of CacheDefinitions.getEnumValues(MONSTER_ENUM)) {
        if (Number(key) <= 0) continue;
        const killVarps = kills.get(Number(key)) ?? [];
        const tasksVarbit = tasks.get(Number(key))?.[0] ?? null;
        bosses.push({
            key: Number(key),
            name: String(name),
            killVarps: killVarps.map((id) => ({ id, name: varps.get(id) ?? null })),
            tasksVarbit: tasksVarbit === null ? null : { id: tasksVarbit, name: varbits.get(tasksVarbit) ?? null },
        });
    }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(bosses, null, 2)}\n`);
    console.log(`${bosses.length} monsters -> ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
