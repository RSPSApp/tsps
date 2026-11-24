/**
 * Math operations: arithmetic, bitwise, random
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

/** A floating-point result as Java's (int) cast gives it: truncated, clamped to the int range, NaN as 0. */
export function doubleToInt(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value >= 2147483647) return 2147483647;
    if (value <= -2147483648) return -2147483648;
    return Math.trunc(value);
}

/** -1 unless the whole text is a base-10 int. */
export function parseStrictInt(text: string | null | undefined): number {
    if (typeof text !== "string" || !/^[+-]?[0-9]+$/.test(text)) return -1;
    const value = Number(text);
    return value > 2147483647 || value < -2147483648 ? -1 : value | 0;
}

/** Whether a bit index names one of an int's 32 bits. */
function isIntBit(bit: number): boolean {
    return bit >= 0 && bit <= 31;
}

/**
 * The mask of a low..high bit range, before it is shifted into place: `high - low + 1` ones
 * (all 32 for a full range). A range that ends more than one bit before it starts is an error.
 */
function bitRangeMask(low: number, high: number): number {
    const count = high - low + 1;
    if (count < 0) throw new Error("RuntimeException");
    return count >= 32 ? -1 : ((1 << count) - 1) | 0;
}

/**
 * sin / cos of a 14-bit angle scaled by 16384. OSRS keeps a table at four times the scale,
 * cut towards zero, and shifts the entry down two bits: a negative value so rounds away from
 * zero when the dropped bits are set.
 */
export function osrsSin(angle: number): number {
    return Math.trunc(65536 * Math.sin((angle & 0x3fff) * 3.834951969714103e-4)) >> 2;
}

export function osrsCos(angle: number): number {
    return Math.trunc(65536 * Math.cos((angle & 0x3fff) * 3.834951969714103e-4)) >> 2;
}

export function registerMathOps(handlers: HandlerMap): void {
    // === Basic arithmetic ===
    handlers.set(Opcodes.ADD, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a + b);
    });

    handlers.set(Opcodes.SUB, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a - b);
    });

    handlers.set(Opcodes.MULTIPLY, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.imul(a, b));
    });

    handlers.set(Opcodes.DIV, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt((a / b) | 0);
    });

    handlers.set(Opcodes.MOD, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        ctx.pushInt(a % b);
    });

    handlers.set(Opcodes.POW, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        // OSRS: a base of 0 gives 0 (even to the power 0), and a result outside the int range
        // stops at its end instead of wrapping.
        ctx.pushInt(a === 0 ? 0 : doubleToInt(Math.pow(a, b)));
    });

    handlers.set(Opcodes.INVPOW, (ctx) => {
        const exp = ctx.intStack[--ctx.intStackSize];
        const base = ctx.intStack[--ctx.intStackSize];
        // Inverse power: base^(1/exp) -- integer root
        // Match OSRS exactly: if base is 0, return 0
        if (base === 0) {
            ctx.pushInt(0);
            return;
        }
        switch (exp) {
            case 0:
                ctx.pushInt(2147483647); // Integer.MAX_VALUE
                break;
            case 1:
                ctx.pushInt(base);
                break;
            case 2:
                ctx.pushInt(Math.sqrt(base) | 0);
                break;
            case 3:
                ctx.pushInt(Math.cbrt(base) | 0);
                break;
            case 4:
                ctx.pushInt(Math.sqrt(Math.sqrt(base)) | 0);
                break;
            default:
                ctx.pushInt(Math.pow(base, 1 / exp) | 0);
        }
    });

    // === Bitwise operations ===
    handlers.set(Opcodes.AND, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a & b);
    });

    handlers.set(Opcodes.OR, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(a | b);
    });

    handlers.set(Opcodes.SETBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        // A bit index outside 0-31 leaves the value as it is.
        ctx.pushInt(isIntBit(bit) ? value | (1 << bit) : value);
    });

    handlers.set(Opcodes.CLEARBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(isIntBit(bit) ? value & ~(1 << bit) : value);
    });

    handlers.set(Opcodes.TESTBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(isIntBit(bit) && (value & (1 << bit)) !== 0 ? 1 : 0);
    });

    handlers.set(Opcodes.TOGGLEBIT, (ctx) => {
        const bit = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(value ^ (1 << bit));
    });

    handlers.set(Opcodes.BITCOUNT, (ctx) => {
        let value = ctx.intStack[--ctx.intStackSize];
        // Popcount
        value = value - ((value >> 1) & 0x55555555);
        value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
        value = (((value + (value >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
        ctx.pushInt(value & 0xff);
    });

    handlers.set(Opcodes.SETBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        // A bound outside 0-31 leaves the value as it is (for all the range instructions).
        if (!isIntBit(low) || !isIntBit(high)) {
            ctx.pushInt(value);
            return;
        }
        ctx.pushInt(value | (bitRangeMask(low, high) << low));
    });

    handlers.set(Opcodes.CLEARBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        if (!isIntBit(low) || !isIntBit(high)) {
            ctx.pushInt(value);
            return;
        }
        ctx.pushInt(value & ~(bitRangeMask(low, high) << low));
    });

    handlers.set(Opcodes.GETBIT_RANGE, (ctx) => {
        const high = ctx.intStack[--ctx.intStackSize];
        const low = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        if (!isIntBit(low) || !isIntBit(high)) {
            ctx.pushInt(value);
            return;
        }
        // The bits above `high` are shifted out, then the range is brought down unsigned, so
        // a full 0-31 range gives the value back.
        const drop = 31 - high;
        ctx.pushInt(((value << drop) >>> (low + drop)) | 0);
    });

    // === Min/Max ===
    handlers.set(Opcodes.MIN, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.min(a, b));
    });

    handlers.set(Opcodes.MAX, (ctx) => {
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt(Math.max(a, b));
    });

    // === Random ===
    handlers.set(Opcodes.RANDOM, (ctx) => {
        const max = ctx.intStack[--ctx.intStackSize];
        ctx.pushInt((Math.random() * max) | 0);
    });

    handlers.set(Opcodes.RANDOMINC, (ctx) => {
        const max = ctx.intStack[--ctx.intStackSize];
        const bound = (max + 1) | 0;
        ctx.pushInt((Math.random() * bound) | 0);
    });

    // === Scale/Interpolate ===
    handlers.set(Opcodes.SCALE, (ctx) => {
        // OSRS original: (c * a) / b using 64-bit arithmetic
        // Stack order: a (bottom), b, c (top)
        const c = ctx.intStack[--ctx.intStackSize];
        const b = ctx.intStack[--ctx.intStackSize];
        const a = ctx.intStack[--ctx.intStackSize];
        if (b === 0) {
            throw new Error("RuntimeException");
        }
        // Use BigInt for 64-bit precision like OSRS uses long
        const result = Number((BigInt(c) * BigInt(a)) / BigInt(b));
        ctx.pushInt(result | 0);
    });

    handlers.set(Opcodes.INTERPOLATE, (ctx) => {
        // ScriptOpcodes.INTERPOLATE (4006)
        // Stack order (bottom -> top): a, b, c, d, e
        // Java: a + (b - a) * (e - c) / (d - c)
        ctx.intStackSize -= 5;
        const a = ctx.intStack[ctx.intStackSize] | 0;
        const b = ctx.intStack[ctx.intStackSize + 1] | 0;
        const c = ctx.intStack[ctx.intStackSize + 2] | 0;
        const d = ctx.intStack[ctx.intStackSize + 3] | 0;
        const e = ctx.intStack[ctx.intStackSize + 4] | 0;

        const denom = (d - c) | 0;
        if (denom === 0) {
            // Match Java's ArithmeticException behavior (divide by zero).
            throw new Error("INTERPOLATE divide by zero");
        }

        // Preserve 32-bit int overflow/truncation semantics.
        const mul = (((b - a) | 0) * ((e - c) | 0)) | 0;
        const div = (mul / denom) | 0;
        ctx.pushInt((a + div) | 0);
    });

    handlers.set(Opcodes.ADDPERCENT, (ctx) => {
        const percent = ctx.intStack[--ctx.intStackSize];
        const value = ctx.intStack[--ctx.intStackSize];
        // Int arithmetic: the product wraps, and its hundredth is cut towards zero before it is
        // added (10 less 15% is 10 + (-150 / 100) = 9, not 8).
        ctx.pushInt((value + ((Math.imul(value, percent) / 100) | 0)) | 0);
    });

    // === Trigonometry (OSRS fixed-point: 16384 units = 360°, values scaled by 16384) ===
    const OSRS_ANGLE_SCALE = 16384;
    const RAD_TO_OSRS_ANGLE = OSRS_ANGLE_SCALE / (2 * Math.PI);

    handlers.set(Opcodes.SIN, (ctx) => {
        ctx.intStack[ctx.intStackSize - 1] = osrsSin(ctx.intStack[ctx.intStackSize - 1]);
    });

    handlers.set(Opcodes.COS, (ctx) => {
        ctx.intStack[ctx.intStackSize - 1] = osrsCos(ctx.intStack[ctx.intStackSize - 1]);
    });

    handlers.set(Opcodes.ATAN2, (ctx) => {
        // Pops y, x and returns angle in OSRS units (0-16383)
        ctx.intStackSize -= 2;
        const y = ctx.intStack[ctx.intStackSize];
        const x = ctx.intStack[ctx.intStackSize + 1];
        const radians = Math.atan2(y, x);
        ctx.pushInt(Math.round(radians * RAD_TO_OSRS_ANGLE) & 0x3fff);
    });

    // === Additional math operations ===
    handlers.set(Opcodes.ABS, (ctx) => {
        ctx.intStack[ctx.intStackSize - 1] = Math.abs(ctx.intStack[ctx.intStackSize - 1]);
    });

    handlers.set(Opcodes.STRING_TO_INT, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize];
        // The whole string must be an int (an optional sign, then digits, in range); else -1.
        ctx.pushInt(parseStrictInt(str));
    });

    handlers.set(Opcodes.SETBIT_RANGE_VALUE, (ctx) => {
        // Pops: value, newBits, lowBit, highBit
        // Clears bits in range, then sets newBits shifted to that position
        ctx.intStackSize -= 4;
        const value = ctx.intStack[ctx.intStackSize];
        const newBits = ctx.intStack[ctx.intStackSize + 1];
        const lowBit = ctx.intStack[ctx.intStackSize + 2];
        const highBit = ctx.intStack[ctx.intStackSize + 3];
        if (!isIntBit(lowBit) || !isIntBit(highBit)) {
            ctx.pushInt(value);
            return;
        }
        // The range is cleared, then the new bits go in, capped at the range's largest value.
        // The cap is a signed int, so over all 32 bits it is -1: any value from 0 up stores -1.
        const maxValue = bitRangeMask(lowBit, highBit);
        const clampedBits = newBits > maxValue ? maxValue : newBits;
        ctx.pushInt((value & ~(maxValue << lowBit)) | (clampedBits << lowBit));
    });
}
