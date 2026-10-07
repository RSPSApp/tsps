/**
 * String operations: concatenation, comparison, manipulation
 */
import { Opcodes } from "../Opcodes";
import type { HandlerMap } from "./HandlerTypes";

export function registerStringOps(handlers: HandlerMap): void {
    const MONTHS = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ];

    // === Basic string operations ===
    handlers.set(Opcodes.JOIN_STRING, (ctx, intOp) => {
        const count = intOp;
        // PERF: Use array join pattern instead of O(n²) string concatenation
        if (count <= 0) {
            ctx.pushString("");
            return;
        }
        if (count === 1) {
            // Fast path for single string
            ctx.pushString(ctx.stringStack[--ctx.stringStackSize] ?? "");
            return;
        }
        // Collect strings into array (in correct order) then join
        const parts = new Array<string>(count);
        for (let i = count - 1; i >= 0; i--) {
            parts[i] = ctx.stringStack[--ctx.stringStackSize] ?? "";
        }
        ctx.pushString(parts.join(""));
    });

    handlers.set(Opcodes.APPEND, (ctx) => {
        const str2 = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const str1 = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str1 + str2);
    });

    handlers.set(Opcodes.TOSTRING, (ctx) => {
        const val = ctx.intStack[--ctx.intStackSize];
        ctx.pushString(val !== undefined && val !== null ? val.toString() : "0");
    });

    // safeparseint(string)(int, boolean): the value and whether it parsed (rev 241).
    handlers.set(Opcodes.SAFEPARSEINT, (ctx) => {
        const text = String(ctx.stringStack[--ctx.stringStackSize] ?? "").trim();
        const value = /^-?\d+$/.test(text) ? Number(text) : NaN;
        const ok = Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
        ctx.pushInt(ok ? value : 0);
        ctx.pushInt(ok ? 1 : 0);
    });

    handlers.set(Opcodes.COMPARE, (ctx) => {
        const str2 = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const str1 = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushInt(str1 === str2 ? 0 : str1 < str2 ? -1 : 1);
    });

    handlers.set(Opcodes.LOWERCASE, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str.toLowerCase());
    });

    handlers.set(Opcodes.UPPERCASE, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str.toUpperCase());
    });

    // === Append operations ===
    handlers.set(Opcodes.APPEND_NUM, (ctx) => {
        const num = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str + num.toString());
    });

    handlers.set(Opcodes.APPEND_SIGNNUM, (ctx) => {
        const num = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const sign = num >= 0 ? "+" : "";
        ctx.pushString(str + sign + num.toString());
    });

    handlers.set(Opcodes.APPEND_CHAR, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str + String.fromCharCode(chr));
    });

    // === String info ===
    handlers.set(Opcodes.STRING_LENGTH, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushInt(str.length);
    });

    handlers.set(Opcodes.SUBSTRING, (ctx) => {
        const end = ctx.intStack[--ctx.intStackSize] ?? 0;
        const start = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str.substring(start, end));
    });

    handlers.set(Opcodes.STRING_INDEXOF_CHAR, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushInt(str.indexOf(String.fromCharCode(chr)));
    });

    handlers.set(Opcodes.STRING_INDEXOF_STRING, (ctx) => {
        const needle = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const start = ctx.intStack[--ctx.intStackSize] ?? 0;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushInt(str.indexOf(needle, start));
    });

    // === Character tests ===
    handlers.set(Opcodes.CHAR_ISPRINTABLE, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const printable =
            (chr >= 32 && chr <= 126) ||
            (chr >= 160 && chr <= 255) ||
            chr === 0x20ac ||
            chr === 0x152 ||
            chr === 0x2014 ||
            chr === 0x153 ||
            chr === 0x178;
        ctx.pushInt(printable ? 1 : 0);
    });

    handlers.set(Opcodes.CHAR_ISALPHANUMERIC, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const c = String.fromCharCode(chr);
        ctx.pushInt(/^[a-zA-Z0-9]$/.test(c) ? 1 : 0);
    });

    handlers.set(Opcodes.CHAR_ISALPHA, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const c = String.fromCharCode(chr);
        ctx.pushInt(/^[a-zA-Z]$/.test(c) ? 1 : 0);
    });

    handlers.set(Opcodes.CHAR_ISNUMERIC, (ctx) => {
        const chr = ctx.intStack[--ctx.intStackSize] ?? 0;
        const c = String.fromCharCode(chr);
        ctx.pushInt(/^[0-9]$/.test(c) ? 1 : 0);
    });

    // === Text formatting ===
    handlers.set(Opcodes.ESCAPE, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    });

    handlers.set(Opcodes.REMOVETAGS, (ctx) => {
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";
        ctx.pushString(str.replace(/<[^>]+>/g, ""));
    });

    handlers.set(Opcodes.TEXT_GENDER, (ctx) => {
        const first = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const second = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const gender = ctx.getPlayerGender?.();
        ctx.pushString(gender !== undefined && gender !== null && gender !== 0 ? second : first);
    });

    handlers.set(Opcodes.TEXT_GENDER3, (ctx) => {
        // 3-way gender text: pops male, female, neutral strings
        // Returns based on player appearance (0=male, 1=female, 2+=neutral)
        ctx.stringStackSize -= 3;
        const male = ctx.stringStack[ctx.stringStackSize] ?? "";
        const female = ctx.stringStack[ctx.stringStackSize + 1] ?? "";
        const neutral = ctx.stringStack[ctx.stringStackSize + 2] ?? "";
        const gender = ctx.getPlayerGender?.() ?? -1;
        switch (gender) {
            case 0:
                ctx.pushString(male);
                break;
            case 1:
                ctx.pushString(female);
                break;
            default:
                ctx.pushString(neutral);
        }
    });

    // text_gender_get (4124): pushes current appearance gender mode, or -1 when unavailable.
    handlers.set(Opcodes.TEXT_GENDER_MODE, (ctx) => {
        const gender = ctx.getPlayerGender?.();
        ctx.pushInt(gender === undefined || gender === null ? -1 : gender | 0);
    });

    handlers.set(Opcodes.TEXT_SWITCH, (ctx) => {
        const second = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const first = ctx.stringStack[--ctx.stringStackSize] ?? "";
        const selector = ctx.intStack[--ctx.intStackSize];
        ctx.pushString(selector === 1 ? first : second);
    });

    handlers.set(Opcodes.FROMDATE, (ctx) => {
        const days = ctx.intStack[--ctx.intStackSize];
        // date = (11745 + days) * 86400000 and format "d-MMM-yyyy".
        const date = new Date((11745 + days) * 86_400_000);
        const day = date.getDate();
        const month = MONTHS[date.getMonth()] ?? "Jan";
        const year = date.getFullYear();
        ctx.pushString(`${day}-${month}-${year}`);
    });

    // === Paragraph measurement ===
    // OSRS stack order: [..., maxWidth, fontId] with fontId on top, then string on string stack
    // PARAHEIGHT returns LINE COUNT (not pixel height!) - caller multiplies by line height
    // PARAWIDTH returns max line width after word-wrapping

    handlers.set(Opcodes.PARAHEIGHT, (ctx) => {
        // Stack: [maxWidth, fontId] with fontId on top
        const fontId = ctx.intStack[--ctx.intStackSize] ?? 0;
        const maxWidth = ctx.intStack[--ctx.intStackSize] ?? 100;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";

        if (str.length === 0) {
            ctx.pushInt(0);
            return;
        }

        // OSRS returns lineCount(text, maxWidth) - just the number of lines!
        const lines = ctx.splitTextLines(str, fontId, maxWidth);
        ctx.pushInt(Math.max(1, lines.length));
    });

    handlers.set(Opcodes.PARAWIDTH, (ctx) => {
        // Stack: [maxWidth, fontId] with fontId on top
        const fontId = ctx.intStack[--ctx.intStackSize] ?? 0;
        const maxWidth = ctx.intStack[--ctx.intStackSize] ?? 100;
        const str = ctx.stringStack[--ctx.stringStackSize] ?? "";

        if (str.length === 0) {
            ctx.pushInt(0);
            return;
        }

        // OSRS lineWidth: wrap text at maxWidth, return max width of any resulting line
        const lines = ctx.splitTextLines(str, fontId, maxWidth);
        let maxLineWidth = 0;
        for (const line of lines) {
            const w = ctx.getTextWidth(line, fontId);
            if (w > maxLineWidth) maxLineWidth = w;
        }
        ctx.pushInt(maxLineWidth);
    });
}
