import assert from "node:assert/strict";
import { test } from "node:test";

import { buildLocMenuEntries, locSubMenuRows } from "../game/menu/WorldMenuBuilder";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import { clientEncoder } from "../network/packet/ClientBinaryEncoder";

// OSRS: a loc's option can carry cache sub-ops shown as a nested menu. A fairy ring's
// "Favourites" is one row per saved slot, named by the slot's varbit (fairyring_fave_1..10);
// picking one teleports straight there.

const RING_ID = 29495;
/** fairyring_fave_1..10 hold 64 + the code's index, 0 when the slot is empty. */
const FAVOURITE_SLOT_1 = 20240;
const FAVOURITE_SLOT_3 = 20242;
const AIR = 64 + 2;
const AJR = 64 + 14;

const vars = (varbits: Record<number, number>) => ({
    getVarp: () => 0,
    getVarbit: (id: number) => varbits[id] ?? 0,
});

function fairyRing(): any {
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    return createCacheVm().vm.context.locTypeLoader.load(RING_ID);
}

const ctx = (varbits: Record<number, number>) => ({
    activeSpell: null,
    selectedItem: null,
    debugId: false,
    npcAttackOption: 0,
    localPlayerCombatLevel: 126,
    followerOpsLowPriority: false,
    vars: vars(varbits),
});

function callbacks(picked: any[]) {
    return {
        onExamine() {},
        onUseItemOn() {},
        onTakeGroundItem() {},
        onExamineGroundItem() {},
        onAttackNpc() {},
        onInteractNpc() {},
        onFollowPlayer() {},
        onTradePlayer() {},
        closeMenu() {},
        onLocSubOption: (row: any) => picked.push(row),
    };
}

test("a fairy ring's Favourites rows are its saved codes, empty slots left out", () => {
    const loc = fairyRing();
    const saved = vars({ [FAVOURITE_SLOT_1]: AIR, [FAVOURITE_SLOT_3]: AJR });
    assert.equal(loc.actions[3], "Favourites", "the cache's fourth option");
    assert.deepEqual(locSubMenuRows(loc, 3, saved), [
        { subOp: 1, name: "AIR" },
        { subOp: 3, name: "AJR" },
    ]);
    assert.deepEqual(locSubMenuRows(loc, 3, vars({})), [], "no favourites: no rows");
    assert.deepEqual(locSubMenuRows(loc, 1, saved), [], "only Favourites has rows");
});

test("the Favourites option carries one sub-menu row per saved favourite, in slot order", () => {
    const loc = fairyRing();
    const picked: any[] = [];
    const saved = { [FAVOURITE_SLOT_1]: AIR, [FAVOURITE_SLOT_3]: AJR };
    const { actions } = buildLocMenuEntries(loc, 4, 5, ctx(saved) as any, callbacks(picked));

    const favourites: any = actions.find((entry) => entry.option === "Favourites");
    assert.ok(favourites, "the option is in the menu");
    assert.deepEqual(favourites.subEntries.map((entry: any) => entry.option), ["AIR", "AJR"]);

    favourites.subEntries[1].onClick();
    assert.deepEqual(picked, [
        { locId: RING_ID, mapX: 4, mapY: 5, opNum: 4, subOp: 3, name: "AJR" },
    ]);
});

test("world menus keep the nested rows and run the row that was picked", () => {
    const loc = fairyRing();
    const picked: any[] = [];
    const saved = { [FAVOURITE_SLOT_1]: AIR, [FAVOURITE_SLOT_3]: AJR };
    const { actions } = buildLocMenuEntries(loc, 4, 5, ctx(saved) as any, callbacks(picked));

    const simple = worldEntriesToSimple(actions, {});
    const favourites = simple.find((entry) => entry.option === "Favourites")!;
    assert.deepEqual(favourites.subEntries!.map((entry) => entry.option), ["AIR", "AJR"]);

    favourites.subEntries![1].onClick!();
    assert.equal(picked[0].name, "AJR");
});

test("a picked row goes as LOC_INTERACT with its option and 1-based row", () => {
    const bytes = Array.from(clientEncoder.encodeLocInteract(RING_ID, { x: 3129, y: 3496 }, 0, "AJR", 4, 3));
    assert.deepEqual(bytes, [
        231, 13, // LOC_INTERACT, byte length
        0x73, 0x37, // object id 29495
        0x0c, 0x39, // x 3129
        0x0d, 0xa8, // y 3496
        0, // plane
        0x41, 0x4a, 0x52, 0, // "AJR"
        4, // the option it sits under
        3, // the 1-based sub-menu row
    ]);
});
