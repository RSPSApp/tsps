/**
 * 64-bit operations added in rev 241: long client/player variables, long maths and long
 * formatting. Names and signatures from zwyz/osrs-cache (data/commands).
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

const LOW_32 = 0xffffffffn;
const LONG_MIN = -(1n << 63n);
const LONG_MAX = (1n << 63n) - 1n;

/** Digits grouped in threes with `separator` ("1,234,567"), keeping a leading minus. */
export function spacedLong(value: bigint, separator: string): string {
    const negative = value < 0n;
    const digits = (negative ? -value : value).toString();
    let out = "";
    for (let i = 0; i < digits.length; i++) {
        if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
        out += digits[i];
    }
    return negative ? `-${out}` : out;
}

export function registerLongOps(handlers: HandlerMap): void {
    // === Variables (int operand: the var id) ===
    handlers.set(Opcodes.PUSH_VARC_LONG, (ctx, intOp) => {
        // A client variable never set as a long reads as its int value if it has one, else -1.
        const value = ctx.varManager.varcLongs.get(intOp);
        if (value !== undefined) {
            ctx.pushLong(value);
            return;
        }
        const asInt = ctx.varManager.varcInts?.get(intOp);
        ctx.pushLong(asInt !== undefined ? BigInt(asInt | 0) : -1n);
    });
    handlers.set(Opcodes.POP_VARC_LONG, (ctx, intOp) => {
        ctx.varManager.varcLongs.set(intOp, ctx.popLong());
    });
    handlers.set(Opcodes.PUSH_VAR_LONG, (ctx, intOp) => {
        ctx.pushLong(ctx.varManager.varpLongs.get(intOp) ?? 0n);
    });
    handlers.set(Opcodes.POP_VAR_LONG, (ctx, intOp) => {
        ctx.varManager.varpLongs.set(intOp, ctx.popLong());
    });

    // === Maths: (long $x1, long $x2)(long), x2 on top ===
    const binary = (op: (a: bigint, b: bigint) => bigint) => (ctx: any) => {
        const b = ctx.popLong();
        const a = ctx.popLong();
        ctx.pushLong(op(a, b));
    };
    const nonZero = (b: bigint) => {
        if (b === 0n) throw new Error("RuntimeException");
        return b;
    };
    // A sum, difference, product or scale that leaves the 64-bit range is a script error, not
    // a wrapped value. The one exception OSRS's own check lets through is the smallest long
    // times -1 (in that order), which stays the smallest long.
    const inRange = (value: bigint) => {
        if (value < LONG_MIN || value > LONG_MAX) throw new Error("RuntimeException");
        return value;
    };
    handlers.set(Opcodes.LONG_ADD, binary((a, b) => inRange(a + b)));
    handlers.set(Opcodes.LONG_SUB, binary((a, b) => inRange(a - b)));
    handlers.set(Opcodes.LONG_MULTIPLY, binary((a, b) => (a === LONG_MIN && b === -1n ? LONG_MIN : inRange(a * b))));
    handlers.set(Opcodes.LONG_DIVIDE, binary((a, b) => a / nonZero(b)));
    handlers.set(Opcodes.LONG_MODULO, binary((a, b) => a % nonZero(b)));
    handlers.set(Opcodes.LONG_MIN, binary((a, b) => (a < b ? a : b)));
    handlers.set(Opcodes.LONG_MAX, binary((a, b) => (a > b ? a : b)));
    // long_scale(x1, x2, x3): x3 * x1 / x2, as the int scale (4018) does.
    handlers.set(Opcodes.LONG_SCALE, (ctx) => {
        const c = ctx.popLong();
        const b = nonZero(ctx.popLong());
        const a = ctx.popLong();
        ctx.pushLong(inRange((c * a) / b));
    });

    // === Conversions ===
    handlers.set(Opcodes.INT_TO_LONG, (ctx) => {
        ctx.pushLong(BigInt(ctx.popInt() | 0));
    });
    // long_pack(int $high, int $low) / long_unpack(long)(int $high, int $low) / long_low(long)(int).
    handlers.set(Opcodes.LONG_PACK, (ctx) => {
        const low = ctx.popInt();
        const high = ctx.popInt();
        ctx.pushLong((BigInt(high | 0) << 32n) | (BigInt(low >>> 0) & LOW_32));
    });
    handlers.set(Opcodes.LONG_UNPACK, (ctx) => {
        const value = ctx.popLong();
        ctx.pushInt(Number(BigInt.asIntN(32, value >> 32n)));
        ctx.pushInt(Number(BigInt.asIntN(32, value)));
    });
    handlers.set(Opcodes.LONG_LOW, (ctx) => {
        ctx.pushInt(Number(BigInt.asIntN(32, ctx.popLong())));
    });

    // === Strings ===
    handlers.set(Opcodes.TOSTRING_LONG, (ctx) => {
        ctx.pushString(ctx.popLong().toString());
    });
    handlers.set(Opcodes.TOSTRING_SPACER_LONG, (ctx) => {
        const separator = String(ctx.popString() ?? "");
        ctx.pushString(spacedLong(ctx.popLong(), separator));
    });
}
