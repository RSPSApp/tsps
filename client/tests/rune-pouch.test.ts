import { strict as assert } from "node:assert";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { TooltipManager } from "@runelite/client/ui/overlay/tooltip/TooltipManager";
import { RunePouchPlugin } from "../game/plugins/runepouch/RunePouchPlugin";
import { RunePouchOverlayMode } from "../game/plugins/runepouch/RunePouchConfig";
import {
    RUNE_AMOUNT_VARBITS, RUNE_TYPE_VARBITS, barFor, formatAmount, layoutPouch, pouchContents, tooltipText,
} from "../game/plugins/runepouch/runePouch";

// --- Counts and bars, as RuneLite draws them ----------------------------------------------
assert.equal(formatAmount(999), "999");
assert.equal(formatAmount(1000), "1K");
assert.equal(formatAmount(16_384), "16K");
assert.deepEqual(barFor(450), { height: 4, color: "red" }, "under 1000: red, in hundreds");
assert.deepEqual(barFor(3500), { height: 3, color: "green" }, "from 1000: green, in thousands");
assert.deepEqual(barFor(25_000), { height: 10, color: "green" }, "full from 10,000");

// --- The pouch's slots, from its varbits ------------------------------------------------------
const vars = new Map<number, number>();
const setPouch = (slots: [number, number][]) => {
    vars.clear();
    slots.forEach(([type, amount], i) => {
        vars.set(RUNE_TYPE_VARBITS[i], type);
        vars.set(RUNE_AMOUNT_VARBITS[i], amount);
    });
};
setPouch([[1, 500], [0, 0], [10, 2000]]);
assert.deepEqual(pouchContents((id) => vars.get(id) ?? 0), [{ type: 1, amount: 500 }, { type: 10, amount: 2000 }], "empty slots left out");

// --- Layout: a list under four runes, a grid with bars from four ---------------------------
let layout = layoutPouch([{ type: 1, amount: 500 }, { type: 2, amount: 2000 }]);
assert.deepEqual(layout.texts, [{ text: "500", x: 11, baseline: 12 }, { text: "2K", x: 11, baseline: 23 }]);
assert.deepEqual(layout.icons.map((i) => [i.x, i.y]), [[-1, -1], [-1, 11]]);
assert.equal(layout.bars.length, 0);
layout = layoutPouch([1, 2, 3, 4].map((type) => ({ type, amount: 1500 })));
assert.equal(layout.texts.length, 0, "the grid has no counts");
assert.deepEqual(layout.icons.map((i) => [i.x, i.y]), [[2, 5], [17, 5], [2, 18], [17, 18]]);
assert.deepEqual(layout.bars[0], { x: 13, y: 15, w: 2, h: 1, color: "green" });
layout = layoutPouch([1, 2, 3, 4, 5].map((type) => ({ type, amount: 100 })));
assert.deepEqual(layout.icons.map((i) => i.y), [-1, -1, 10, 10, 21], "more than four: three rows");

// --- Tooltip text -----------------------------------------------------------------------------
assert.equal(tooltipText([{ type: 1, amount: 50 }], () => "Air rune"), "50 <col=ffff00>Air rune</col></br>");

// --- The plugin against a fake client ---------------------------------------------------------
const AIR = 556, NATURE = 561;
const pouchWidget = { uid: (149 << 16) | 0, itemId: 12791, itemQuantity: 1, parentUid: -1, _absX: 100, _absY: 200, _absWidth: 36, _absHeight: 32 };
const client: any = {
    gameState: GameState.LOGGED_IN,
    menuOpen: false,
    inputManager: { mouseX: 110, mouseY: 210 },
    varManager: { getVarbit: (id: number) => vars.get(id) ?? 0 },
    loaderFactory: { getEnumTypeLoader: () => ({ load: () => ({ keys: [1, 10], intValues: [AIR, NATURE] }) }) },
    objTypeLoader: { load: (id: number) => ({ name: id === AIR ? "Air rune" : "Nature rune" }) },
    widgetManager: {
        getWidgetsForGroup: (group: number) => (group === 149 ? [pouchWidget] : []),
        isEffectivelyHidden: () => false,
    },
};

async function pluginChecks(): Promise<void> {
    const config = inject(ConfigManager);
    const tooltips = new TooltipManager();
    const plugin = new RunePouchPlugin(client, tooltips);
    await plugin.start();
    setPouch([[1, 500], [10, 2000]]);

    assert.deepEqual(plugin.pouches().map(({ x, y }) => [x, y]), [[100, 200]], "the pouch in the inventory");
    assert.deepEqual(tooltips.getTooltips().map((t) => t.text), ["500 <col=ffff00>Air rune</col></br>2000 <col=ffff00>Nature rune</col></br>"],
        "hovering the pouch shows its runes (Both, the default)");
    client.inputManager.mouseX = 10;
    assert.equal(tooltips.getTooltips().length, 0, "no tooltip off the pouch");
    client.inputManager.mouseX = 110;

    const drawn = () => {
        const calls: string[] = [];
        const renderer: any = {
            canvas: { width: 800, height: 600 },
            getTexture: () => undefined,
            createTextureFromCanvas: () => undefined,
            drawTexture: () => calls.push("icon"),
            drawRect: () => calls.push("bar"),
            deleteTexture: () => true,
        };
        const rects = plugin.widgetOverlay.draw({ renderer, fontLoader: () => undefined } as any);
        return { calls, rects };
    };
    assert.deepEqual(drawn().rects, [{ x: 100, y: 200, w: 36, h: 32 }], "drawn over the pouch");
    assert.notEqual(plugin.widgetOverlay.signature(), "");

    config.setConfiguration("runepouch", "runePouchOverlayMode", RunePouchOverlayMode.INVENTORY);
    assert.equal(tooltips.getTooltips().length, 0, "Inventory mode: no tooltip");
    config.setConfiguration("runepouch", "runePouchOverlayMode", RunePouchOverlayMode.MOUSE_HOVER);
    assert.equal(plugin.widgetOverlay.signature(), "", "Mouse hover mode: nothing on the pouch");
    assert.deepEqual(drawn().rects, []);
    assert.equal(tooltips.getTooltips().length, 1, "Mouse hover mode: the tooltip");
    config.unsetConfiguration("runepouch", "runePouchOverlayMode");

    setPouch([]);
    assert.equal(tooltips.getTooltips().length, 0, "an empty pouch has no tooltip");
    assert.deepEqual(drawn().rects, [], "nor anything on it");

    await plugin.stop();
    setPouch([[1, 500]]);
    assert.equal(tooltips.getTooltips().length, 0, "turned off: its tooltip source is gone");
}

pluginChecks()
    .then(() => console.log("rune pouch tests passed"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
