import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { breakTextLines, type LineBreakMetrics } from "../rs/font/breakTextLines";

// paraheight / parawidth (4108 / 4109) count and measure the lines OSRS breaks text into. The
// expected lines were produced by running the client's own procedure with this toy font:
// "i" and a space are 1 wide, everything else 2, an icon 5, and no kerning.
const font: LineBreakMetrics = {
    advance: (ch) => (ch === 105 || ch === 32 ? 1 : 2),
    kerning: () => 0,
    iconWidth: (id) => (id >= 0 && id <= 3 ? 5 : undefined),
};
const lines = (text: string, width: number) => breakTextLines(text, width, font);

test("<br> and <n> end a line, and a trailing one adds no empty line", () => {
    assert.deepEqual(lines("a<br>", 8), ["a<br>"]);
    assert.deepEqual(lines("a<br>b", 8), ["a<br>", "b"]);
    assert.deepEqual(lines("a<br><br>b", 8), ["a<br>", "<br>", "b"]);
    assert.deepEqual(lines("<br>", 8), ["<br>"]);
    assert.deepEqual(lines("aa<n>bb", 100), ["aa<n>", "bb"]);
    assert.deepEqual(lines("aa <br> bb", 8), ["aa <br>", " bb"]);
    assert.deepEqual(lines("", 8), []);
});

test("lines break after a space or after a hyphen", () => {
    assert.deepEqual(lines("aa bb cc", 8), ["aa", "bb", "cc"]);
    assert.deepEqual(lines("aa bb cc", 100), ["aa bb cc"]);
    assert.deepEqual(lines("a b c d e f g", 8), ["a b c", "d e f", "g"]);
    assert.deepEqual(lines("a b c d e f g", 6), ["a b", "c d", "e f", "g"]);
    assert.deepEqual(lines("aaaa-bbbb-cc", 8), ["aaaa-", "bbbb-", "cc"]);
    assert.deepEqual(lines("aa-bb cc-dd", 8), ["aa-", "bb", "cc-", "dd"]);
    assert.deepEqual(lines("aa-bb cc-dd", 100), ["aa-bb cc-dd"]);
    assert.deepEqual(lines("aaaaaaaaaa bb", 8), ["aaaaaaaaaa", "bb"], "a word with no place to break stays whole");
    assert.deepEqual(lines("x-<nbh>yy zz", 8), ["x-", "<nbh>yy", "zz"], "<nbh> is a hyphen that does not break");
});

test("spaces are kept: only the one a line breaks at is dropped", () => {
    assert.deepEqual(lines("aa  bb  cc", 8), ["aa ", "bb ", "cc"]);
    assert.deepEqual(lines("aa  bb  cc", 100), ["aa  bb  cc"]);
    assert.deepEqual(lines("  aa bb", 8), ["  aa", "bb"]);
    assert.deepEqual(lines("aa bb ", 8), ["aa", "bb "]);
});

test("tags take no width, except the characters and icons they draw", () => {
    assert.deepEqual(lines("<col=ff0000>aa bb</col> cc", 8), ["<col=ff0000>aa", "bb</col>", "cc"]);
    assert.deepEqual(lines("<col=ff0000>aa bb</col> cc", 100), ["<col=ff0000>aa bb</col> cc"]);
    assert.deepEqual(lines("aa<lt>bb cc", 8), ["aa<lt>bb", "cc"]);
    assert.deepEqual(lines("ab<img=1>cd ef", 8), ["ab<img=1>cd", "ef"]);
    assert.deepEqual(lines("a<b", 8), ["a"], "an unclosed < hides the rest");
    assert.deepEqual(lines("ab>cd ef", 8), ["ab>cd", "ef"]);
});

test("paraheight is the line count and parawidth the widest line", () => {
    const handlers = createHandlerMap();
    const width = (text: string) => [...text.replace(/<[^>]*>/g, "")].reduce((sum, ch) => sum + font.advance(ch.charCodeAt(0)), 0);
    const run = (opcode: number, text: string, maxWidth: number) => {
        const out: number[] = [];
        handlers.get(opcode)!({
            intStack: [maxWidth, 495], intStackSize: 2, stringStack: [text], stringStackSize: 1,
            pushInt: (v: number) => out.push(v),
            splitTextLines: (s: string, _font: number, w: number) => breakTextLines(s, w, font),
            getTextWidth: (s: string) => width(s),
        } as any, 0, null as any);
        return out[0];
    };
    assert.equal(run(Opcodes.PARAHEIGHT, "aa bb cc<br>", 8), 3, "no extra line for the trailing <br>");
    assert.equal(run(Opcodes.PARAHEIGHT, "aa bb cc<br>dd", 100), 2);
    assert.equal(run(Opcodes.PARAHEIGHT, "aaaa-bbbb-cc", 8), 3);
    assert.equal(run(Opcodes.PARAHEIGHT, "", 8), 0);
    assert.equal(run(Opcodes.PARAWIDTH, "aaaa-bbbb-cc", 8), 10);
    assert.equal(run(Opcodes.PARAWIDTH, "a b c d e f g", 6), 5);
});
