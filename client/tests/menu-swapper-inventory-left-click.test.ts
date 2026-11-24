import assert from "node:assert/strict";
import { test } from "node:test";

import { ClientState } from "../game/ClientState";
import { applyMenuSwaps, swapKey } from "../game/plugins/menuswapper/menuSwaps";
import type { MenuSwapperPluginConfig } from "../game/plugins/menuswapper/types";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { MenuTargetType } from "../rs/MenuEntry";
import { setMenuTransform } from "../ui/menu/menuTransforms";

// #6735: an inventory item's Drop is a low-priority op (opcode 1007), and since #6729 a 1007 top
// entry makes the left click open the menu. A Menu Swapper "Swap left click" (or shift-click)
// to Drop puts that op on top as the left click, so the click must drop, not open the menu.

const SHARK = 385;
const sharkKey = swapKey(MenuTargetType.ITEM, SHARK)!;
const shark = { uid: 149 << 16, parentUid: 149 << 16, fileId: -1, childIndex: 3, itemId: SHARK, name: "Shark",
    actions: [null, "Eat", null, null, null, null, "Drop"], targetVerb: "Use" };
const manager: any = { getWidgetFlags: () => ~1, getWidgetOpMask: () => 0, getWidgetByUid: () => undefined };
const primary = createPrimaryWidgetActionResolver(
    { getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }), getLeftClickOpensMenu: () => false } as any,
    {} as any, manager, {} as any);

function withSwaps(config: Partial<MenuSwapperPluginConfig>, shift: boolean, run: () => void) {
    const full: MenuSwapperPluginConfig = { enabled: true,
        presets: { bank: false, trade: false, pickpocket: false, shiftDrop: false }, swaps: {}, shiftSwaps: {}, ...config };
    setMenuTransform((entries, context) =>
        context.surface === "widget" ? entries : applyMenuSwaps(entries, { ...context, isShiftHeld: shift }, full, () => {}));
    try {
        run();
    } finally {
        setMenuTransform(undefined);
    }
}

test("a left-click swap to Drop drops on left click", () => {
    withSwaps({ swaps: { [sharkKey]: { option: "Drop", name: "Shark" } } }, false, () => {
        const action = primary(shark);
        assert.deepEqual([action.option, action.opIndex], ["Drop", 7]);
        assert.equal(action.opensMenu, undefined);
    });
});

test("a shift-click swap to Drop drops with Shift held", () => {
    withSwaps({ shiftSwaps: { [sharkKey]: { option: "Drop", name: "Shark" } } }, true, () => {
        const action = primary(shark);
        assert.deepEqual([action.option, action.opIndex], ["Drop", 7]);
        assert.equal(action.opensMenu, undefined);
    });
});

test("the shift-drop preset drops with Shift held", () => {
    withSwaps({ presets: { bank: false, trade: false, pickpocket: false, shiftDrop: true } }, true, () => {
        const action = primary(shark);
        assert.equal(action.option, "Drop");
        assert.equal(action.opensMenu, undefined);
    });
});

test("a swap to an op that is already on top leaves it low priority, as RuneLite", () => {
    withSwaps({ swaps: { [sharkKey]: { option: "Drop", name: "Shark" } } }, false, () => {
        const onlyDrop = { ...shark, targetVerb: undefined, actions: [null, null, null, null, null, null, "Drop"] };
        assert.equal(primary(onlyDrop).opensMenu, true);
    });
});

test("without a swap the item's normal left click is unchanged", () => {
    withSwaps({}, false, () => {
        const action = primary(shark);
        assert.equal(action.option, "Eat");
        assert.equal(action.opensMenu, undefined);
    });
});

test("a low-priority op that is top without a swap still opens the menu", () => {
    withSwaps({}, false, () => {
        const onlyDrop = { ...shark, targetVerb: undefined, actions: [null, null, null, null, null, null, "Drop"] };
        assert.equal(primary(onlyDrop).opensMenu, true);
    });
});

ClientState.clearItemSelection();
