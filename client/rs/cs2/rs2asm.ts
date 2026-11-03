import { Opcodes } from "./Opcodes";
import { Script } from "./Script";

/**
 * A small assembler for RuneLite's `.rs2asm` client scripts (runelite-client/src/main/scripts):
 * `.id`/`.*_arg_count` headers, `LABEL:` lines, `op [operand]` lines and `;` comments.
 * Operands are an integer, a "quoted string" or, for a jump, a label. An op is its name or its
 * number (`5025`, for ops RuneLite's assembler has no name for). A `switch` is followed by its
 * table, one `key: LABEL` line per case.
 *
 * Like RuneLite's assembler, the local counts are the highest local index used, plus one, and at
 * least the argument counts.
 */
export function assembleRs2asm(source: string): Script {
    const script = new Script();
    const instructions: number[] = [];
    const intOperands: number[] = [];
    const stringOperands: (string | null)[] = [];
    const labels = new Map<string, number>();
    const jumps: { pc: number; label: string }[] = [];
    const switches: Map<number, number>[] = [];
    const cases: { table: Map<number, number>; key: number; pc: number; label: string }[] = [];

    for (const rawLine of source.split(/\r?\n/)) {
        const line = stripComment(rawLine).trim();
        if (!line) continue;
        if (line.startsWith(".")) {
            const [directive, value] = line.split(/\s+/);
            const n = parseInt(value, 10);
            switch (directive) {
                case ".id": script.id = n; break;
                case ".int_arg_count": script.intArgCount = n; break;
                case ".obj_arg_count": script.objArgCount = n; break;
                case ".long_arg_count": script.longArgCount = n; break;
                default: throw new Error(`rs2asm: unsupported directive ${directive}`);
            }
            continue;
        }
        const label = /^([A-Za-z_][A-Za-z0-9_]*):$/.exec(line);
        if (label) {
            labels.set(label[1], instructions.length);
            continue;
        }
        const switchCase = /^(-?\d+):\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
        if (switchCase) {
            const pc = instructions.length - 1;
            if (instructions[pc] !== Opcodes.SWITCH) throw new Error(`rs2asm: case outside a switch "${line}"`);
            cases.push({ table: switches[intOperands[pc]], key: parseInt(switchCase[1], 10), pc, label: switchCase[2] });
            continue;
        }
        const match = /^([a-z_0-9]+)(?:\s+(.*))?$/.exec(line);
        if (!match) throw new Error(`rs2asm: can't read "${line}"`);
        const opcode = /^\d+$/.test(match[1])
            ? parseInt(match[1], 10)
            : (Opcodes as unknown as Record<string, number>)[match[1].toUpperCase()];
        if (typeof opcode !== "number") throw new Error(`rs2asm: unknown opcode ${match[1]}`);
        const operand = match[2]?.trim() ?? "";
        const pc = instructions.length;
        instructions.push(opcode);
        if (opcode === Opcodes.SWITCH) {
            intOperands.push(switches.length);
            stringOperands.push(null);
            switches.push(new Map());
        } else if (operand.startsWith('"')) {
            intOperands.push(0);
            stringOperands.push(JSON.parse(operand) as string);
        } else if (/^-?\d+$/.test(operand) || operand === "") {
            intOperands.push(operand === "" ? 0 : parseInt(operand, 10));
            stringOperands.push(null);
        } else {
            intOperands.push(0);
            stringOperands.push(null);
            jumps.push({ pc, label: operand });
        }
    }

    for (const { pc, label } of jumps) {
        const target = labels.get(label);
        if (target === undefined) throw new Error(`rs2asm: unknown label ${label}`);
        // A jump at pc goes to pc + offset + 1.
        intOperands[pc] = target - pc - 1;
    }
    for (const { table, key, pc, label } of cases) {
        const target = labels.get(label);
        if (target === undefined) throw new Error(`rs2asm: unknown label ${label}`);
        // Like a jump, the switch at pc goes to pc + offset + 1.
        table.set(key, target - pc - 1);
    }

    script.instructions = Int32Array.from(instructions);
    script.intOperands = Int32Array.from(intOperands);
    script.stringOperands = stringOperands;
    script.longOperands = new BigInt64Array(instructions.length);
    if (switches.length > 0) script.switches = switches;
    script.localIntCount = Math.max(script.intArgCount, highestLocal(instructions, intOperands, Opcodes.ILOAD, Opcodes.ISTORE) + 1);
    script.localObjCount = Math.max(script.objArgCount, highestLocal(instructions, intOperands, Opcodes.OLOAD, Opcodes.OSTORE) + 1);
    script.localLongCount = Math.max(script.longArgCount, highestLocal(instructions, intOperands, Opcodes.LLOAD, Opcodes.LSTORE) + 1);
    return script;
}

/** The line before its `;` comment, ignoring a `;` inside a string. */
function stripComment(line: string): string {
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"' && line[i - 1] !== "\\") quoted = !quoted;
        else if (c === ";" && !quoted) return line.slice(0, i);
    }
    return line;
}

function highestLocal(instructions: number[], operands: number[], load: number, store: number): number {
    let highest = -1;
    instructions.forEach((op, pc) => {
        if (op === load || op === store) highest = Math.max(highest, operands[pc]);
    });
    return highest;
}
