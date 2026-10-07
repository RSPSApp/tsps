// Disassembles clientscripts straight out of the active cache.
// Usage: TS_NODE_COMPILER_OPTIONS='{"target":"es2020"}' ts-node ./scripts/dump-cs2.ts <scriptId...>
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { SCONST, SWITCH, hasLongCounts, readScript } from "./cs2-reader";

const OPCODES_TS = path.resolve(__dirname, "../../client/rs/cs2/Opcodes.ts");
const opNames = new Map<number, string>();
for (const line of fs.readFileSync(OPCODES_TS, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(\d+),/.exec(line);
    if (m) opNames.set(Number(m[2]), m[1].toLowerCase());
}

function disassemble(id: number, data: Int8Array, longCounts: boolean): string {
    const { header, instructions } = readScript(data, longCounts);
    const out: string[] = [
        `; script ${id} name=${header.name} ops=${header.opcodes} localInt=${header.localInts} localObj=${header.localObjs} localLong=${header.localLongs} intArgs=${header.intArgs} objArgs=${header.objArgs} longArgs=${header.longArgs}`,
    ];
    instructions.forEach(({ opcode, operand }, i) => {
        const shown = typeof operand === "string" && opcode === SCONST ? JSON.stringify(operand) : String(operand);
        let line = `${String(i).padStart(5)}  ${(opNames.get(opcode) ?? `op${opcode}`).padEnd(24)} ${shown}`;
        if (opcode === SWITCH) {
            const table = header.switches[Number(operand)];
            if (table) line += `  { ${[...table].map(([k, v]) => `${k} -> ${i + 1 + v}`).join(", ")} }`;
        }
        out.push(line);
    });
    return out.join("\n");
}

async function main() {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
    for (const arg of process.argv.slice(2)) {
        const id = Number(arg);
        const file = index.getFileSmart(id);
        if (!file) {
            console.log(`; script ${id} MISSING`);
            continue;
        }
        console.log(disassemble(id, new Int8Array(file.data), hasLongCounts(CachePipeline.getActive().revision)));
        console.log("");
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
