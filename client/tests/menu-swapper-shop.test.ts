import { strict as assert } from "node:assert";

import { applyMenuSwaps, SWAP_SHIFT_CLICK, type SaveSwap } from "../game/plugins/menuswapper/menuSwaps";
import type { MenuSwapperPluginConfig } from "../game/plugins/menuswapper/types";
import { MenuTargetType } from "../rs/MenuEntry";
import { SHOPSIDE } from "../runelite/api/gameval/InterfaceID";
import { setMenuTransform, type MenuTransformContext } from "../ui/menu/menuTransforms";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { transformWidgetMenuEntries } from "../widgets/menu/utils";

const itemId = 882;
const shopWidgetId = (SHOPSIDE << 16) | 4;
const shopItem = { uid: shopWidgetId, childIndex: 4, itemId, name: "Bronze arrow" };
const sellOptions: SimpleMenuEntry[] = [
    { option: "Sell 1", opIndex: 1 },
    { option: "Sell 5", opIndex: 2 },
    { option: "Sell 10", opIndex: 3 },
    { option: "Sell 50", opIndex: 4 },
    { option: "Value", opIndex: 5 },
    { option: "Examine", opIndex: 6 },
];
const defaults = (): MenuSwapperPluginConfig => ({
    enabled: true,
    presets: { bank: false, trade: false, pickpocket: false, shiftDrop: false },
    swaps: {},
    shiftSwaps: {},
});
const noSave: SaveSwap = () => {};

function transformShopMenu(menu: boolean, config: MenuSwapperPluginConfig) {
    let context: MenuTransformContext | undefined;
    let result: SimpleMenuEntry[] | undefined;
    setMenuTransform((entries, nextContext) => {
        context = nextContext;
        return applyMenuSwaps(entries, { ...nextContext, isShiftHeld: true }, config, noSave);
    });
    try {
        result = transformWidgetMenuEntries<SimpleMenuEntry>(shopItem, sellOptions, menu);
    } finally {
        setMenuTransform(undefined);
    }
    assert.ok(context, "shop sell menus should reach the client menu plugins");
    assert.ok(result, "shop sell menus should return transformed entries");
    return { context, entries: result };
}

const configure = transformShopMenu(true, defaults());
assert.equal(configure.context.surface, "inventory");
assert.equal(configure.context.menu, true);
if (configure.context.surface === "inventory") {
    assert.equal(configure.context.target.type, MenuTargetType.ITEM);
    assert.equal(configure.context.target.id, itemId);
    assert.equal(configure.context.widgetId, shopWidgetId);
}
const shiftSubmenu = configure.entries.find((entry) => entry.option === SWAP_SHIFT_CLICK);
assert.ok(shiftSubmenu, "Shift-right-clicking a shop item should offer a shift-click swap");
assert.deepEqual(
    shiftSubmenu.subEntries?.map((entry) => entry.option),
    ["Sell 1", "Sell 5", "Sell 10", "Sell 50", "Value", "Reset"],
);

const selected = transformShopMenu(false, {
    ...defaults(),
    shiftSwaps: { [`item:${itemId}`]: { option: "Sell 50", name: "Bronze arrow" } },
});
assert.equal(selected.context.surface, "inventory");
assert.equal(selected.context.menu, false);
assert.equal(selected.entries[0].option, "Sell 50");
assert.equal(selected.entries[0].swapPinned, true);

console.log("shop sell shift-click menu tests passed");
