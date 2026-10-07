/**
 * Variable operations: VARP, VARBIT, VARC, arrays
 */
import {
    Cs2ArrayObject,
    createTypedArrayFromCode,
    popTypedValue,
    requireCs2ArrayObject,
} from "../Cs2ArrayObject";
import { Opcodes } from "../Opcodes";
import { javaRandom } from "../JavaRandom";
import type { HandlerMap } from "./HandlerTypes";

export function registerVarOps(handlers: HandlerMap): void {
    // === Player variables (VARP) ===
    handlers.set(Opcodes.GET_VARP, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarp(intOp));
    });

    handlers.set(Opcodes.SET_VARP, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarp(intOp, val);
    });

    // === Variable bits (VARBIT) ===
    handlers.set(Opcodes.GET_VARBIT, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarbit(intOp));
    });

    handlers.set(Opcodes.SET_VARBIT, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarbit(intOp, val);
    });

    // === Client variables (VARC) ===
    handlers.set(Opcodes.GET_VARC_INT, (ctx, intOp) => {
        ctx.pushInt(ctx.varManager.getVarcInt(intOp));
    });

    handlers.set(Opcodes.SET_VARC_INT, (ctx, intOp) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.varManager.setVarcInt(intOp, val);
    });

    handlers.set(Opcodes.GET_VARC_STRING, (ctx, intOp) => {
        ctx.pushString(ctx.varManager.getVarcString(intOp));
    });

    handlers.set(Opcodes.SET_VARC_STRING, (ctx, intOp) => {
        const val = ctx.stringStack[--ctx.stringStackSize];
        ctx.varManager.setVarcString(intOp, val);
    });

    // === Clan variables ===
    // GET_VARCLANSETTING (opcode 74): Retrieves clan settings parameters
    // OSRS: Reads from ClanSettings.parameters (IterableNodeHashTable) via getTitleGroupValue()
    // Returns -1 if the key doesn't exist (matching OSRS behavior)
    handlers.set(Opcodes.GET_VARCLANSETTING, (ctx, intOp) => {
        const value = ctx.clanSettings?.parameters?.get(intOp);
        ctx.pushInt(value ?? -1);
    });

    // GET_VARCLAN (opcode 76): Retrieves clan profile/channel variables
    // Reads from a separate clan profile object
    // We store these in ClanChannel.parameters for architectural simplicity
    // Returns -1 if the key doesn't exist (matching OSRS behavior)
    handlers.set(Opcodes.GET_VARCLAN, (ctx, intOp) => {
        const value = ctx.clanChannel?.parameters?.get(intOp);
        ctx.pushInt(value ?? -1);
    });

    // === Arrays ===
    handlers.set(Opcodes.DEFINE_ARRAY, (ctx, intOp) => {
        const slot = intOp >> 16;
        const typeCode = intOp & 0xffff;
        const length = ctx.intStack[--ctx.intStackSize];
        ctx.setLocalString(slot, createTypedArrayFromCode(typeCode, length, length));
    });

    handlers.set(Opcodes.GET_ARRAY_INT, (ctx, intOp) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const arrayObj = requireCs2ArrayObject(ctx.getLocalString(intOp));
        if (arrayObj.valueType === "int") {
            ctx.pushInt(arrayObj.getInt(index));
        } else {
            ctx.pushString(arrayObj.getObject(index));
        }
    });

    handlers.set(Opcodes.SET_ARRAY_INT, (ctx, intOp) => {
        const arrayObj = requireCs2ArrayObject(ctx.getLocalString(intOp));
        if (arrayObj.valueType === "int") {
            const value = ctx.intStack[--ctx.intStackSize];
            const index = ctx.intStack[--ctx.intStackSize];
            arrayObj.setAt(index, value);
        } else {
            const index = ctx.intStack[--ctx.intStackSize];
            const value = ctx.stringStack[--ctx.stringStackSize];
            arrayObj.setAt(index, value);
        }
    });

    // === Array sort operations ===
    handlers.set(Opcodes.ARRAY_SORT, (ctx) => {
        const secondary = ctx.stringStack[--ctx.stringStackSize];
        const primary = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        if (secondary == null) {
            primary.sortAllWith(null);
            return;
        }
        const secondaryArray = requireCs2ArrayObject(secondary);
        primary.sortAllWith(secondaryArray);
    });

    // array_randomise(array, seed1, seed2): Collections.shuffle with a java.util.Random seeded
    // (seed1 << 32) | seed2; both 0 means an unseeded (random) shuffle.
    handlers.set(Opcodes.ARRAY_RANDOMISE, (ctx) => {
        const seed2 = ctx.intStack[--ctx.intStackSize];
        const seed1 = ctx.intStack[--ctx.intStackSize];
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        const seed =
            seed1 === 0 && seed2 === 0
                ? BigInt(Math.floor(Math.random() * 2 ** 48))
                : (BigInt(seed1) << 32n) | BigInt(seed2 >>> 0);
        arrayObj.shuffle(javaRandom(seed));
    });

    handlers.set(Opcodes.ARRAY_IS_NULL, (ctx) => {
        const value = ctx.stringStack[--ctx.stringStackSize];
        ctx.pushInt(value == null ? 1 : 0);
    });

    handlers.set(Opcodes.ARRAY_LENGTH, (ctx) => {
        const value = ctx.stringStack[--ctx.stringStackSize];
        if (value == null) {
            ctx.pushInt(0);
            return;
        }
        const arrayObj = requireCs2ArrayObject(value);
        ctx.pushInt(arrayObj.length);
    });

    handlers.set(Opcodes.ARRAY_COUNT_MATCHES, (ctx) => {
        const start = ctx.intStack[ctx.intStackSize - 3];
        const end = ctx.intStack[ctx.intStackSize - 2];
        const valueType = ctx.intStack[ctx.intStackSize - 1];
        ctx.intStackSize -= 3;
        const value = popTypedValue(
            valueType,
            () => ctx.intStack[--ctx.intStackSize],
            () => ctx.stringStack[--ctx.stringStackSize],
        );
        const arrayValue = ctx.stringStack[--ctx.stringStackSize];
        if (arrayValue == null) {
            ctx.pushInt(0);
            return;
        }
        const arrayObj = requireCs2ArrayObject(arrayValue);
        ctx.pushInt(arrayObj.countMatches(value, start, end));
    });

    // The cargo hold's grid (script 8872) calls it as (array, 0, -1, -1) to fill a list of slot
    // indices before sorting it by each slot's key; 8871 then draws slot array[i] at position i.
    // array_swap(array, index1, index2) (rev 241).
    handlers.set(Opcodes.ARRAY_SWAP, (ctx) => {
        const second = ctx.intStack[--ctx.intStackSize];
        const first = ctx.intStack[--ctx.intStackSize];
        const array = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        const held = array.getRaw(first);
        array.setAt(first, array.getRaw(second));
        array.setAt(second, held);
    });

    // array_copy(src, dst, src_pos, dst_pos, length) (rev 241); overlapping copies read first.
    handlers.set(Opcodes.ARRAY_COPY, (ctx) => {
        const length = ctx.intStack[--ctx.intStackSize];
        const dstPos = ctx.intStack[--ctx.intStackSize];
        const srcPos = ctx.intStack[--ctx.intStackSize];
        const dst = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        const src = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        if (length < 0) throw new Error("RuntimeException");
        const values = [];
        for (let i = 0; i < length; i++) values.push(src.getRaw(srcPos + i));
        values.forEach((value, i) => dst.setAt(dstPos + i, value));
    });

    handlers.set(Opcodes.ARRAY_FILL_SEQUENCE, (ctx) => {
        const end = ctx.intStack[--ctx.intStackSize];
        const start = ctx.intStack[--ctx.intStackSize];
        const first = ctx.intStack[--ctx.intStackSize];
        requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]).fillSequence(first, start, end);
    });

    handlers.set(Opcodes.ARRAY_MAX_VALUE, (ctx) => {
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        const index = arrayObj.getArgMax();
        if (arrayObj.valueType === "int") {
            ctx.pushInt(index >= 0 ? (arrayObj.getAtOrDefault(index) as number) : -1);
        } else {
            const value = index >= 0 ? arrayObj.getAtOrDefault(index) : "";
            ctx.pushString(typeof value === "string" ? value : value == null ? "" : String(value));
        }
    });

    handlers.set(Opcodes.ARRAY_JOIN, (ctx) => {
        const separator = ctx.stringStack[--ctx.stringStackSize];
        if (typeof separator !== "string") {
            throw new Error("RuntimeException");
        }
        const arrayObj = requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);
        if (arrayObj.valueType === "object") {
            ctx.pushString(arrayObj.join(separator));
            return;
        }
        const parts: string[] = [];
        for (let i = 0; i < arrayObj.length; i++) {
            parts.push(String(arrayObj.getInt(i)));
        }
        ctx.pushString(parts.join(separator));
    });

    // enum_getinputs(type $inputtype, enum)(array): every key of the enum, in order.
    handlers.set(Opcodes.ENUM_GETINPUTS, (ctx) => {
        const enumId = ctx.intStack[--ctx.intStackSize];
        const inputType = ctx.intStack[--ctx.intStackSize];
        const keys = ctx.enumTypeLoader?.load(enumId)?.keys ?? [];
        const array = createTypedArrayFromCode(inputType, keys.length);
        keys.forEach((key, index) => array.setAt(index, key));
        ctx.pushString(array);
    });

    handlers.set(Opcodes.ARRAY_NEW, (ctx) => {
        const capacityCandidate = ctx.intStack[ctx.intStackSize - 1];
        const length = ctx.intStack[ctx.intStackSize - 2];
        const typeCode = ctx.intStack[ctx.intStackSize - 3];
        ctx.intStackSize -= 3;
        const capacity = capacityCandidate < length ? length : capacityCandidate;
        ctx.pushString(createTypedArrayFromCode(typeCode, length, capacity));
    });

    const popValue = (ctx: any, valueType: number) =>
        popTypedValue(valueType, () => ctx.intStack[--ctx.intStackSize], () => ctx.stringStack[--ctx.stringStackSize]);
    const popArray = (ctx: any) => requireCs2ArrayObject(ctx.stringStack[--ctx.stringStackSize]);

    // array_push(array, value, type) (osrs-cache 8024).
    handlers.set(Opcodes.ARRAY_PUSH, (ctx) => {
        const value = popValue(ctx, ctx.intStack[--ctx.intStackSize]);
        popArray(ctx).push(value);
    });

    // array_insert(array, value, index, type) (8025).
    handlers.set(Opcodes.ARRAY_INSERT, (ctx) => {
        const valueType = ctx.intStack[--ctx.intStackSize];
        const index = ctx.intStack[--ctx.intStackSize];
        const value = popValue(ctx, valueType);
        popArray(ctx).insertAt(index, value);
    });

    // array_indexof / array_fill(array, value, start, end, type) (8005 / 8010).
    handlers.set(Opcodes.ARRAY_INDEXOF, (ctx) => {
        const valueType = ctx.intStack[--ctx.intStackSize];
        const end = ctx.intStack[--ctx.intStackSize];
        const start = ctx.intStack[--ctx.intStackSize];
        const value = popValue(ctx, valueType);
        ctx.pushInt(popArray(ctx).indexOf(value, start, end));
    });
    handlers.set(Opcodes.ARRAY_FILL, (ctx) => {
        const valueType = ctx.intStack[--ctx.intStackSize];
        const end = ctx.intStack[--ctx.intStackSize];
        const start = ctx.intStack[--ctx.intStackSize];
        const value = popValue(ctx, valueType);
        popArray(ctx).fill(value, start, end);
    });

    handlers.set(Opcodes.ARRAY_REVERSE, (ctx) => {
        popArray(ctx).reverse();
    });

    // array_resize(array, size) (8023).
    handlers.set(Opcodes.ARRAY_RESIZE, (ctx) => {
        const size = ctx.intStack[--ctx.intStackSize];
        popArray(ctx).resize(size);
    });

    // array_delete(array, index)(value) (8026).
    handlers.set(Opcodes.ARRAY_DELETE, (ctx) => {
        const index = ctx.intStack[--ctx.intStackSize];
        const array = popArray(ctx);
        const removed = array.deleteAt(index);
        if (array.valueType === "int") ctx.pushInt(removed | 0);
        else ctx.pushString(removed);
    });

    // array_pushall(array, other) (8027).
    handlers.set(Opcodes.ARRAY_PUSHALL, (ctx) => {
        const other = popArray(ctx);
        const array = popArray(ctx);
        const values = [];
        for (let i = 0; i < other.length; i++) values.push(other.getRaw(i));
        for (const value of values) array.push(value);
    });

    // string_split(string, separator)(stringarray) (8018).
    handlers.set(Opcodes.STRING_SPLIT, (ctx) => {
        const separator = String(ctx.stringStack[--ctx.stringStackSize] ?? "");
        const text = String(ctx.stringStack[--ctx.stringStackSize] ?? "");
        const parts = separator === "" ? [text] : text.split(separator);
        const array = new Cs2ArrayObject("object", "", parts.length, parts.length);
        parts.forEach((part, i) => array.setAt(i, part));
        ctx.pushString(array);
    });
}
