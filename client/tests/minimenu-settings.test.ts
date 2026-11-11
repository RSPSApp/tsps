import assert from "node:assert/strict";
import { MenuTargetType, type OsrsMenuEntry } from "../rs/MenuEntry";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import {
    MINIMENU_BLOCK_ENTITY,
    MINIMENU_BLOCK_EXAMINE,
    MINIMENU_BLOCK_PLAYER,
} from "../ui/menu/minimenuFilters";
import {
    drawChooseOptionMenu,
    getChooseOptionMenuRect,
    readChooseOptionMenuLayout,
    setChooseOptionMenuLayout,
} from "../widgets/gl/choose-option";

// All Settings > Interfaces > Minimenu filters: the cache's scripts set block modes in the client
// (minimenu_setblockmode, mode 0 = left out), and the world menu leaves those entries out.
const entry = (option: string, targetType: MenuTargetType, extra: Partial<OsrsMenuEntry> = {}): OsrsMenuEntry =>
    ({ option, targetType, targetId: 1, targetName: "Thing", targetLevel: 0, ...extra }) as OsrsMenuEntry;
const world = [
    entry("Walk here", MenuTargetType.NONE),
    entry("Talk-to", MenuTargetType.NPC),
    entry("Examine", MenuTargetType.NPC),
    entry("Chop down", MenuTargetType.LOC),
    entry("Take", MenuTargetType.OBJ),
    entry("Examine", MenuTargetType.OBJ),
    entry("Use", MenuTargetType.NPC, { targetName: "Bones -> Thing" }),
    entry("Follow", MenuTargetType.PLAYER),
    entry("Trade with", MenuTargetType.PLAYER),
];
const options = (blockModes?: number[]) =>
    worldEntriesToSimple(world, { blockModes }).map((e) => `${e.option}${e.targetType === MenuTargetType.PLAYER ? " (player)" : ""}`);
const modes = (...blocked: number[]) => {
    const all = Array.from({ length: 10 }, () => 1);
    for (const slot of blocked) all[slot] = 0;
    return all;
};

assert.deepEqual(options(), options(modes()), "no block modes set keeps everything, as every mode at 1 does");
const all = options(modes());
assert.ok(all.includes("Talk-to") && all.includes("Follow (player)"));

const noEntity = options(modes(MINIMENU_BLOCK_ENTITY));
for (const gone of ["Talk-to", "Chop down", "Take"]) assert.ok(!noEntity.includes(gone), `${gone} is an entity option`);
assert.equal(noEntity.filter((o) => o === "Examine").length, 2, "examine has a filter of its own");
assert.ok(noEntity.includes("Use"), "Use has a filter of its own");
assert.ok(noEntity.includes("Walk here") && noEntity.includes("Follow (player)"));

const noPlayer = options(modes(MINIMENU_BLOCK_PLAYER));
assert.ok(!noPlayer.includes("Follow (player)") && !noPlayer.includes("Trade with (player)"));
assert.ok(noPlayer.includes("Talk-to"));

const noExamine = options(modes(MINIMENU_BLOCK_EXAMINE));
assert.ok(!noExamine.includes("Examine"));
assert.ok(noExamine.includes("Talk-to") && noExamine.includes("Take"));

// Minimenu options: the start entry and spacing are game options 13 and 14 (scripts 7458-7460),
// the scrollbar the client's scroll flag (script 728).
const layout = readChooseOptionMenuLayout({ gameOptions: new Map([[13, 3], [14, 250]]), minimenuScrollEnabled: true });
assert.deepEqual(layout, { startEntry: 3, spacing: 100, scrollbar: true }, "spacing is capped as script 7460 caps it");
assert.deepEqual(readChooseOptionMenuLayout(undefined), { startEntry: 0, spacing: 0, scrollbar: false });

// Menu text is measured on a canvas.
(globalThis as any).document = {
    createElement: () => ({ getContext: () => ({ font: "", measureText: () => ({ width: 40 }) }) }),
};
const fontLoader = () => ({ measure: () => 40 }) as any;
const menu = { open: true, x: 200, y: 200, entries: Array.from({ length: 5 }, (_, i) => ({ option: `Option ${i}` })) };
setChooseOptionMenuLayout(undefined);
const plain = getChooseOptionMenuRect(fontLoader, menu, 800, 600)!;
assert.deepEqual([plain.y, plain.h], [200, 5 * 15 + 22], "by default the menu opens with its title at the mouse");

setChooseOptionMenuLayout({ startEntry: 0, spacing: 10, scrollbar: false });
assert.equal(getChooseOptionMenuRect(fontLoader, menu, 800, 600)!.h, 5 * 25 + 22, "spacing adds to every row");

setChooseOptionMenuLayout({ startEntry: 3, spacing: 0, scrollbar: false });
const third = getChooseOptionMenuRect(fontLoader, menu, 800, 600)!;
const thirdMiddle = third.y + 31 + 2 * 15 - 5;
assert.equal(thirdMiddle, 200, "the third entry opens under the mouse");
setChooseOptionMenuLayout({ startEntry: 8, spacing: 0, scrollbar: false });
assert.equal(getChooseOptionMenuRect(fontLoader, menu, 800, 600)!.y + 31 + 4 * 15 - 5, 200, "a shorter menu opens on its last entry");
setChooseOptionMenuLayout(undefined);

// The scrollbar shows only on a menu taller than the screen, and only with the setting on.
const thumbColour = (rgba: number[]) => Math.round(rgba[0] * 255) === 0x9e && Math.round(rgba[1] * 255) === 0x95;
const drawTall = (scrollEnabled: boolean): number => {
    let thumbs = 0;
    const ui: any = {
        menu: { open: true, follow: true, x: 100, y: 0, entries: Array.from({ length: 60 }, (_, i) => ({ option: `Option ${i}` })) },
    };
    const canvas: any = { __ui: ui, __osrsClient: { minimenuScrollEnabled: scrollEnabled, gameOptions: new Map() },
        clientWidth: 800, offsetWidth: 800, clientHeight: 600, offsetHeight: 600 };
    drawChooseOptionMenu(
        { canvas, width: 800, height: 600, drawRect: (_x: number, _y: number, _w: number, _h: number, c: number[]) => { if (thumbColour(c)) thumbs++; } } as any,
        { fontLoader: () => undefined, requestRender: () => undefined },
    );
    return thumbs;
};
assert.equal(drawTall(false), 0, "no scrollbar with the setting off");
assert.equal(drawTall(true), 1, "the scrollbar shows on an oversized menu");
const tall = { open: true, x: 100, y: 0, entries: Array.from({ length: 60 }, (_, i) => ({ option: `Option ${i}` })) };
setChooseOptionMenuLayout({ startEntry: 0, spacing: 0, scrollbar: false });
const narrow = getChooseOptionMenuRect(fontLoader, tall, 800, 600)!.w;
setChooseOptionMenuLayout({ startEntry: 0, spacing: 0, scrollbar: true });
assert.equal(getChooseOptionMenuRect(fontLoader, tall, 800, 600)!.w, narrow + 3, "the scrollbar gets its own column");
assert.equal(getChooseOptionMenuRect(fontLoader, menu, 800, 600)!.w, plain.w, "a menu that fits needs none");
setChooseOptionMenuLayout(undefined);

console.log("minimenu settings tests passed");
