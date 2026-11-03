import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { ItemPricesPlugin } from "../game/plugins/itemprices/ItemPricesPlugin";
import { ItemStatsPlugin } from "../game/plugins/itemstats/ItemStatsPlugin";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { inject } from "../runelite/client/plugins/PluginInjector";
import { BANKMAIN, INVENTORY, WORNITEMS } from "../runelite/api/gameval/InterfaceID";
import { GameState } from "../runelite/api/GameState";
import { ItemPricesConfig } from "../game/plugins/itemprices/ItemPricesConfig";
import { itemPriceMarketId } from "../game/plugins/itemprices/itemPricesMapping";
import { state } from "../network/serverConnection/state";
import { guidePrice, loadItemPrices } from "../network/serverConnection/domain/itemPrices";
import { buildItemPriceRows, formatPrice } from "../game/plugins/itemprices/itemPricesPresentation";
import { BitmapFont } from "../rs/font/BitmapFont";
import { fallbackInteractionBounds, findInteractionTextBounds, findMouseoverTimerBounds, getItemStatsTooltipBounds, setItemStatsTooltipBounds } from "../game/plugins/itemstats/tooltipPosition";
import { SpellSelectionController } from "../game/widgets/SpellSelectionController";
import { handleWidgetActionTargeting } from "../game/widgets/widgetActionHandlers";
import { ClientState } from "../game/ClientState";
import { BARROWS_AHRIM_HEAD, BARROWS_AHRIM_HEAD_50, BARROWS_AHRIM_HEAD_BROKEN } from "../runelite/api/gameval/ItemID";

async function main(): Promise<void> {
// Exercise the real content path without an external server: test the connected world's quote
// endpoint contract and make sure the overlay uses that quote rather than ObjDefinition.price.
(state as any).webRtcConfig = {};
(state as any).socket = { fetchContent: async (path: string) => path === "/api/item-prices"
    ? { 4151: 1_500_000, 561: 200, [BARROWS_AHRIM_HEAD]: 600, [BARROWS_AHRIM_HEAD_BROKEN]: 50 }
    : {} };
await loadItemPrices();
assert.equal(guidePrice(4151), 1_500_000, "price comes from connected-world guide data");
const config = inject(ConfigManager).getConfig(ItemPricesConfig);
assert.deepEqual([
    config.showGEPrice(), config.showHAValue(), config.showEA(), config.hideInventory(), config.showAlchProfit(), config.showWhileAlching(),
], [true, true, true, true, false, true], "RuneLite default settings");
const enabled = { showGEPrice: true, showHAValue: true, showEA: true, showAlchProfit: true };
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 1, storePrice: 0, settings: enabled }), [],
    "an item without positive values has no fabricated GE or zero HA tooltip");
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 1, storePrice: 0, guideQuote: 500, settings: enabled }),
    [["GE", "500 gp"]], "a real GE quote remains usable when the cache store price is zero");
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 1, storePrice: 100, guideQuote: 0, settings: enabled }),
    [["HA", "60 gp"]], "an absent GE quote is omitted instead of saying No quote");
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 2, storePrice: 100, guideQuote: 50, natureRuneQuote: 0, settings: enabled }),
    [["GE", "100 gp (50 ea)"], ["HA", "120 gp (60 ea)"]], "profit needs a nonzero nature-rune quote");
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 2, storePrice: 100, guideQuote: 45, natureRuneQuote: 10, settings: enabled }),
    [["GE", "90 gp (45 ea)"], ["HA", "120 gp (60 ea)"], ["HA profit", "10 gp (5 ea)"]]);
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 1, storePrice: 100, guideQuote: 45, natureRuneQuote: 10,
    settings: { ...enabled, showGEPrice: false } }), [["HA", "60 gp"]], "profit requires GE display to be enabled");
assert.deepEqual(buildItemPriceRows({ itemId: 4151, quantity: 1, storePrice: 100, guideQuote: 45, natureRuneQuote: 10,
    settings: { ...enabled, showHAValue: false } }), [["GE", "45 gp"], ["HA profit", "5 gp"]],
    "RuneLite calculates high-alchemy profit even when the HA value row is hidden");
const enormousStack = buildItemPriceRows({
    itemId: 4151,
    quantity: 2_147_483_647,
    storePrice: 9_999_990,
    guideQuote: 1,
    settings: { ...enabled, showHAValue: true, showGEPrice: false },
});
assert.deepEqual(enormousStack, [["HA", "12,884,888,997,098,118 gp (6M ea)"]],
    "stack multiplication remains exact above Number.MAX_SAFE_INTEGER and follows RuneLite stack abbreviations");
for (const [value, expected] of [
    [1_000n, "1,000"],
    [9_999n, "9,999"],
    [1_999_999n, "2M"],
    [10_999_999n, "11M"],
    [999_999_500n, "1B"],
    [-999_999_500n, "-1B"],
    [999_999_500_000n, "999,999,500,000"],
    [-999_999_500_000n, "-999,999,500,000"],
    [1_000_000_000_000n, "1,000,000,000,000"],
    [12_884_891_144_581_765n, "12,884,891,144,581,765"],
    [-1_999_999n, "-2M"],
    [-12_884_891_144_581_765n, "-12,884,891,144,581,765"],
] as const) assert.equal(formatPrice(value), expected, `format ${value} as ${expected}`);
assert.equal(itemPriceMarketId(BARROWS_AHRIM_HEAD_50), BARROWS_AHRIM_HEAD,
    "Ahrim's hood at 50% durability uses RuneLite's tradeable base item mapping");
assert.equal(itemPriceMarketId(BARROWS_AHRIM_HEAD_BROKEN), BARROWS_AHRIM_HEAD_BROKEN,
    "broken Ahrim's hood keeps its own quote instead of inheriting the unbroken base price");
assert.equal(guidePrice(itemPriceMarketId(BARROWS_AHRIM_HEAD_50)), 600, "50% Ahrim's hood reads the base quote");
assert.equal(guidePrice(itemPriceMarketId(BARROWS_AHRIM_HEAD_BROKEN)), 50, "broken Ahrim's hood reads its separate quote");
assert.deepEqual(buildItemPriceRows({ itemId: 995, quantity: 3000, storePrice: 0, settings: enabled }), [["Value", "3,000 gp"]],
    "coins use their stack count, not GE or store values");
assert.deepEqual(buildItemPriceRows({ itemId: 13204, quantity: 3, storePrice: 0, settings: enabled }), [["Value", "3,000 gp"]],
    "platinum tokens convert at 1,000 coins each");

const itemWidget: any = {
    uid: (BANKMAIN << 16) | 1, groupId: BANKMAIN, itemId: 4151, itemQuantity: 2,
    x: 100, y: 100, width: 32, height: 32, type: 5, children: [],
};
const bankRoot: any = {
    uid: BANKMAIN << 16, groupId: BANKMAIN, x: 0, y: 0, width: 765, height: 503,
    type: 0, children: [itemWidget],
};
const nativeActionWidget: any = {
    uid: (BANKMAIN << 16) | 2, groupId: BANKMAIN, text: "<col=ffff00>Wield Abyssal whip",
    x: 400, y: 110, width: 150, height: 20, type: 4,
    _absX: 400, _absY: 110, _absWidth: 150, _absHeight: 20, children: [],
};
const nativeTimerWidget: any = { uid: 600, onTimer: [4725], children: [nativeActionWidget] };
bankRoot.children.push(nativeActionWidget);
const definitions = new Map([[4151, { name: "Abyssal whip", price: 120_001, params: { get: (key: number) => key === 0 ? 1 : undefined } }]]);
const client: any = {
    gameState: GameState.LOGGED_IN,
    menuOpen: false,
    menuActiveSimpleEntries: [{ option: "Wield", target: "Abyssal whip" }],
    inputManager: { mouseX: 110, mouseY: 110 },
    equipment: { getSlots: () => [] },
    objTypeLoader: { load: (id: number) => definitions.get(id) },
    widgetManager: {
        rootInterface: BANKMAIN,
        getInputRoots: () => [bankRoot],
        getWidgetsForGroup: (group: number) => group === BANKMAIN ? [bankRoot, itemWidget, nativeActionWidget] : [],
        getStaticChildrenByParentUid: () => [],
        getActiveTimerWidgets: () => [nativeTimerWidget],
    },
};
const prices = new ItemPricesPlugin(client);
const stats = new ItemStatsPlugin(client);
assert.equal(ItemStatsPlugin.descriptor.enabledByDefault, false, "Item Stats stays disabled for new profiles");
const spellSelection = new SpellSelectionController({
    getWidgetManager: () => client.widgetManager,
    getObjTypeLoader: () => client.objTypeLoader,
    getCs2Vm: () => undefined,
    executeScriptListener: () => {},
});
ClientState.clearSpellSelection();
const spellWidget: any = {
    uid: (218 << 16) | 57,
    childIndex: 57,
    targetVerb: "Cast",
    opBase: "<col=ffff00>High Level   Alchemy</col>",
    name: "High Level Alchemy",
};
const targetingDeps: any = {
    getWidgetManager: () => client.widgetManager,
    getCs2Vm: () => undefined,
    getVarManager: () => undefined,
    getInventory: () => ({ setSelectedSlot: () => {} }),
    clearSelectedSpell: () => spellSelection.clearSelectedSpell(),
    setSelectedSpell: (spell: any, sourceWidget: any) => spellSelection.setSelectedSpell(spell, sourceWidget),
    normalizeSelectedSpellState: () => {},
    resolveSpellSelectionFromWidget: (_widget: any, widgetId: number, childIndex: number, itemId: number) => ({
        widgetId, childIndex, itemId,
    }),
    getWidgetTargetMask: () => 1,
};
const selectHighAlchemy = () => {
    assert.equal(handleWidgetActionTargeting(targetingDeps, { widget: spellWidget, option: "Cast" }, 218, 57), true,
        "spellbook widget action enters target mode through the real action handler");
    assert.ok(ClientState.isSpellSelected);
};
await prices.start();
await stats.start();
const plugins = new ClientPluginManager();
plugins.add(stats);
plugins.add(prices);
assert.equal(plugins.widgetOverlays().length, 2, "Item Stats and Item Prices both retain their overlays");
assert.ok(prices.widgetOverlay.signature(), "bank hover resolves an item quote panel");
const rects: { x: number; y: number; w: number; h: number }[] = [];
const rectColors: number[][] = [];
const drawContext: any = {
    renderer: {
        canvas: { width: 765, height: 503 },
        drawRect: (x: number, y: number, w: number, h: number, color: number[]) => {
            rects.push({ x, y, w, h });
            if (color) rectColors.push(color);
        },
    },
    fontLoader: () => undefined,
    sprite: () => undefined,
    place: () => undefined,
    textScaleX: 1,
    textScaleY: 1,
    overlayTextScale: () => ({ x: drawContext.textScaleX, y: drawContext.textScaleY }),
};
const pricesWithoutStats = new ItemPricesPlugin(client);
await pricesWithoutStats.start();
assert.ok(pricesWithoutStats.widgetOverlay.draw(drawContext).length > 0,
    "Item Prices draws without starting Item Stats");
await pricesWithoutStats.stop();
const statsRects = stats.widgetOverlay.draw(drawContext);
const priceRects = prices.widgetOverlay.draw(drawContext);
assert.ok(statsRects.length > 0 && priceRects.length > 0, "both plugins draw for the same live bank widget hit");
assert.ok(priceRects[0].h <= 30, "Item Prices uses a compact two-line tooltip without a title row");
assert.deepEqual(rectColors.findLast((color) => color[3] === 156 / 255), [70 / 255, 61 / 255, 50 / 255, 156 / 255],
    "Item Prices uses the same translucent background color as Item Stats");
assert.deepEqual(rectColors.slice(-4), Array.from({ length: 4 }, () => [55 / 255, 51 / 255, 47 / 255, 1]),
    "Item Prices uses the same opaque warm dark gray-brown outline as Item Stats");
assert.ok(priceRects[0].y >= client.inputManager.mouseY + 8 ||
    priceRects[0].y + priceRects[0].h <= client.inputManager.mouseY - 8,
    "Item Prices stays above or below the cursor with a clear gap");
assert.ok(!overlaps(statsRects[0], priceRects[0]), "Item Prices avoids the rendered Item Stats tooltip");
const actionBounds = findInteractionTextBounds([bankRoot, itemWidget, nativeActionWidget], "Wield Abyssal whip");
assert.ok(actionBounds && !overlaps(priceRects[0], actionBounds), "Item Prices avoids measured native action text");
// Register in the shipped order, then draw each overlay once for a first hover. Item Stats must
// publish its tooltip bounds before Item Prices places its own panel in the same pass.
const registry = readFileSync(new URL("../runelite/client/plugins/index.ts", import.meta.url), "utf8");
const corePlugins = registry.slice(registry.indexOf("export const CORE_PLUGINS"));
const statsFirst = corePlugins.indexOf("    ItemStatsPlugin,") < corePlugins.indexOf("    ItemPricesPlugin,");
assert.ok(statsFirst, "production registers Item Stats before Item Prices");
const firstHoverPrices = new ItemPricesPlugin(client);
const firstHoverStats = new ItemStatsPlugin(client);
await firstHoverPrices.start();
await firstHoverStats.start();
const productionPlugins = new ClientPluginManager();
for (const plugin of statsFirst ? [firstHoverStats, firstHoverPrices] : [firstHoverPrices, firstHoverStats]) {
    productionPlugins.add(plugin);
}
setItemStatsTooltipBounds(client, undefined);
const productionOverlays = productionPlugins.widgetOverlays();
for (const overlay of productionOverlays) overlay.signature();
const firstHoverRects = productionOverlays.map((overlay) => overlay.draw(drawContext));
assert.ok(firstHoverRects.every((rects) => rects.length > 0), "both panels draw on the first hover");
const [firstStatsRects, firstPriceRects] = statsFirst
    ? firstHoverRects : [firstHoverRects[1], firstHoverRects[0]];
assert.ok(!overlaps(firstStatsRects[0], firstPriceRects[0]),
    "the first hover's panels do not overlap in production draw order");
await Promise.all([firstHoverPrices.stop(), firstHoverStats.stop()]);
client.menuOpen = true;
assert.equal(prices.widgetOverlay.signature(), "", "price panel closes with the context menu");
stats.widgetOverlay.signature();
assert.equal(getItemStatsTooltipBounds(client), undefined, "Item Stats clears shared tooltip bounds when the menu opens");
client.menuOpen = false;
itemWidget.groupId = INVENTORY;
itemWidget.uid = (INVENTORY << 16) | 1;
client.widgetManager.getInputRoots = () => [bankRoot];
assert.equal(prices.widgetOverlay.signature(), "", "inventory hover is hidden by the default setting");
nativeActionWidget.text = "<col=ffff00>Cast High Level Alchemy";
client.menuActiveSimpleEntries = [];
selectHighAlchemy();
assert.ok(prices.widgetOverlay.signature(), "High Level Alchemy hover overrides inventory hiding when enabled");
const spellActionBounds = findInteractionTextBounds([bankRoot, itemWidget, nativeActionWidget], "Cast High Level Alchemy");
const alchPriceRects = prices.widgetOverlay.draw(drawContext);
const timerActionBounds = findMouseoverTimerBounds([nativeTimerWidget]);
assert.ok(spellActionBounds && timerActionBounds && alchPriceRects.length > 0 &&
    !overlaps(alchPriceRects[0], spellActionBounds) && !overlaps(alchPriceRects[0], timerActionBounds),
    "selected-spell text and the live mouseover timer bounds are both avoided without a world-menu entry");
inject(ConfigManager).setConfiguration("itemprices", "showWhileAlching", false);
assert.equal(prices.widgetOverlay.signature(), "", "the alching override can be turned off");
inject(ConfigManager).setConfiguration("itemprices", "showWhileAlching", true);
spellSelection.clearSelectedSpell();
nativeActionWidget.text = "<col=ffff00>Wield Abyssal whip";
client.menuActiveSimpleEntries = [{ option: "Wield", target: "Abyssal whip" }];
assert.equal(prices.widgetOverlay.signature(), "", "ordinary inventory actions do not bypass inventory hiding");
selectHighAlchemy();
nativeActionWidget.text = "Cast High Level Alchemy";
itemWidget.x = 720;
client.inputManager.mouseX = 730;
client.inputManager.mouseY = 110;
assert.ok(prices.widgetOverlay.signature(), "alching remains available on an edge inventory slot");
stats.widgetOverlay.draw(drawContext);
const edgePriceRects = prices.widgetOverlay.draw(drawContext);
assert.ok(edgePriceRects.length > 0, "edge inventory hover draws while alching");
assert.ok(edgePriceRects.every(({ x, y, w, h }) => x >= 0 && y >= 0 && x + w <= 765 && y + h <= 503),
    "price panel stays clipped within the canvas at the screen edge");
assert.ok(edgePriceRects[0].y >= client.inputManager.mouseY + 8 ||
    edgePriceRects[0].y + edgePriceRects[0].h <= client.inputManager.mouseY - 8,
    "price panel keeps a cursor gap near the screen edge");
assert.ok(!overlaps(edgePriceRects[0], fallbackInteractionBounds(730, 110, 765, 503)),
    "the price panel also avoids the conservative action-text reserve");
const measuredEdgeAction = findInteractionTextBounds([bankRoot, itemWidget, nativeActionWidget], "Cast High Level Alchemy");
assert.ok(measuredEdgeAction && !overlaps(edgePriceRects[0], measuredEdgeAction),
    "the alching price panel also clears the measured selected-spell action bounds");
spellSelection.clearSelectedSpell();
itemWidget.x = 100;
itemWidget.groupId = BANKMAIN;
itemWidget.uid = (BANKMAIN << 16) | 1;
bankRoot.__widgetRenderScaleX = 2;
bankRoot.__widgetRenderScaleY = 2;
bankRoot.__widgetRenderOffsetX = 10;
bankRoot.__widgetRenderOffsetY = 20;
client.inputManager.mouseX = 230;
client.inputManager.mouseY = 230;
client.menuActiveSimpleEntries = [{ option: "Wield", target: "Abyssal whip" }];
nativeActionWidget._absX = 810;
nativeActionWidget._absY = 240;
nativeActionWidget._absWidth = 300;
nativeActionWidget._absHeight = 40;
drawContext.renderer.canvas.width = 1540;
drawContext.renderer.canvas.height = 1026;
assert.ok(prices.widgetOverlay.signature(), "a device-pixel pointer hits a scaled logical item slot");
const scaledStatsRects = stats.widgetOverlay.draw(drawContext);
const scaledPriceRects = prices.widgetOverlay.draw(drawContext);
const scaledActionBounds = findMouseoverTimerBounds([nativeTimerWidget]);
assert.ok(scaledStatsRects.length && scaledPriceRects.length && scaledActionBounds &&
    !overlaps(scaledStatsRects[0], scaledPriceRects[0]) &&
    !overlaps(scaledPriceRects[0], scaledActionBounds),
    "scaled tooltip placement separates Item Stats, Item Prices, and native timer text");
assert.ok(scaledPriceRects.every(({ x, y, w, h }) => x >= 0 && y >= 0 && x + w <= 1540 && y + h <= 1026),
    "scaled price panel remains inside the renderer canvas");
// Touch displays cap their backing store below the device pixel ratio, so the overlay canvas
// is larger than the input buffer. The pointer and the hit rect arrive in input pixels; the
// panel must convert them to the overlay's pixels or it lands nowhere near the hovered slot.
const touchItem: any = {
    uid: (BANKMAIN << 16) | 1, groupId: BANKMAIN, itemId: 4151, itemQuantity: 2,
    x: 350, y: 200, width: 32, height: 32, type: 5, children: [],
    _absX: 350, _absY: 200, _absWidth: 32, _absHeight: 32,
};
// The tree renders at the overlay scale; mouseover text keeps those rendered bounds.
const touchAction: any = {
    uid: (BANKMAIN << 16) | 2, groupId: BANKMAIN, text: "<col=ffff00>Wield Abyssal whip",
    x: 350, y: 236, width: 150, height: 20, type: 4,
    _absX: 700, _absY: 472, _absWidth: 300, _absHeight: 40, children: [],
};
const touchRoot: any = {
    uid: BANKMAIN << 16, groupId: BANKMAIN, x: 0, y: 0, width: 765, height: 503, type: 0,
    children: [touchItem, touchAction],
};
const touchClient: any = {
    gameState: GameState.LOGGED_IN,
    menuOpen: false,
    menuActiveSimpleEntries: [{ option: "Wield", target: "Abyssal whip" }],
    inputManager: { mouseX: 360, mouseY: 210 },
    equipment: { getSlots: () => [] },
    objTypeLoader: { load: (id: number) => definitions.get(id) },
    widgetManager: {
        rootInterface: BANKMAIN,
        getInputRoots: () => [touchRoot],
        getWidgetsForGroup: () => [touchRoot, touchItem, touchAction],
        getStaticChildrenByParentUid: () => [],
        getActiveTimerWidgets: () => [],
    },
};
const touchPrices = new ItemPricesPlugin(touchClient);
await touchPrices.start();
const touchPriceContext: any = {
    ...drawContext,
    renderer: { canvas: { width: 1530, height: 1006 }, drawRect: () => {} },
    inputScale: () => ({ x: 2, y: 2 }),
    overlayTextScale: () => ({ x: 2, y: 2 }),
};
const [touchPriceRect] = touchPrices.widgetOverlay.draw(touchPriceContext);
const drawnTouchAction = { x: 700, y: 472, w: 300, h: 40 };
const drawnTouchItem = { x: 700, y: 400, w: 64, h: 64 };
assert.ok(touchPriceRect && !overlaps(touchPriceRect, drawnTouchAction),
    "the price panel clears the action text at its drawn overlay position");
assert.ok(Math.hypot(
    touchPriceRect.x + touchPriceRect.w / 2 - (drawnTouchItem.x + drawnTouchItem.w / 2),
    touchPriceRect.y + touchPriceRect.h / 2 - (drawnTouchItem.y + drawnTouchItem.h / 2),
) <= 200, "the price panel follows the item at the overlay's scale");
assert.ok(touchPriceRect.x >= 0 && touchPriceRect.y >= 0 &&
    touchPriceRect.x + touchPriceRect.w <= 1530 && touchPriceRect.y + touchPriceRect.h <= 1006,
    "the price panel stays inside the larger overlay canvas");
await touchPrices.stop();
// Render through TextRenderer's bitmap-font path at DPR 2. Capture actual glyph quads and panel
// geometry so this covers drawTextGL scaling, not just the overlay's input coordinates.
const previousDocument = (globalThis as any).document;
(globalThis as any).document = {
    createElement: () => {
        let imageData: any;
        return {
            width: 1,
            height: 1,
            getContext: () => ({
                createImageData: (width: number, height: number) => (imageData = { data: new Uint8ClampedArray(width * height * 4), width, height }),
                putImageData: () => {},
            }),
        };
    },
};
const bitmapFont = new BitmapFont();
bitmapFont.ascent = bitmapFont.maxAscent = 8;
for (let code = 32; code < 128; code++) {
    bitmapFont.advances[code] = 5;
    bitmapFont.widths[code] = 4;
    bitmapFont.heights[code] = 7;
    bitmapFont.glyphPixels[code] = new Uint8Array(28).fill(1);
}
const glyphQuads: Float32Array[] = [];
const scaledDrawRects: { x: number; y: number; w: number; h: number; color?: number[] }[] = [];
drawContext.fontLoader = () => bitmapFont;
drawContext.renderer.createTextureFromCanvas = (_key: string, canvas: any) => ({ tex: {}, w: canvas.width, h: canvas.height });
drawContext.renderer.drawTextureQuads = (_texture: unknown, vertices: Float32Array) => glyphQuads.push(vertices.slice());
drawContext.renderer.drawRect = (x: number, y: number, w: number, h: number, color: number[]) => scaledDrawRects.push({ x, y, w, h, color });
drawContext.textScaleX = 2;
drawContext.textScaleY = 2;
const renderedDpr2Rect = prices.widgetOverlay.draw(drawContext)[0];
assert.ok(renderedDpr2Rect && scaledDrawRects.some((rect) => rect.w === renderedDpr2Rect.w && rect.h === renderedDpr2Rect.h),
    "DPR 2 panel geometry is rendered at device scale");
assert.deepEqual(scaledDrawRects.slice(1, 5).map(({ w, h, color }) => [w, h, color]), [
    [renderedDpr2Rect.w, 2, [55 / 255, 51 / 255, 47 / 255, 1]],
    [renderedDpr2Rect.w, 2, [55 / 255, 51 / 255, 47 / 255, 1]],
    [2, renderedDpr2Rect.h - 4, [55 / 255, 51 / 255, 47 / 255, 1]],
    [2, renderedDpr2Rect.h - 4, [55 / 255, 51 / 255, 47 / 255, 1]],
], "DPR 2 outline keeps the warm dark gray-brown color and scales to two pixels");
assert.ok(glyphQuads.some((quads) => quads.some((value) => value >= 4 && Number.isInteger(value))),
    "real bitmap glyph quads are emitted using the DPR-scaled drawTextGL path");
assert.ok(glyphQuads.some((quads) => {
    for (let offset = 0; offset + 16 <= quads.length; offset += 16) {
        if (Math.round(quads[offset + 4] - quads[offset]) === 8) return true;
    }
    return false;
}), "DPR 2 glyph quads are twice the mocked font's four-pixel glyph width");
(globalThis as any).document = previousDocument;
bankRoot.__widgetRenderScaleX = 1;
bankRoot.__widgetRenderScaleY = 1;
bankRoot.__widgetRenderOffsetX = 0;
bankRoot.__widgetRenderOffsetY = 0;
nativeActionWidget._absX = 400;
nativeActionWidget._absY = 110;
nativeActionWidget._absWidth = 150;
nativeActionWidget._absHeight = 20;
drawContext.renderer.canvas.width = 765;
drawContext.renderer.canvas.height = 503;
client.inputManager.mouseX = 110;
client.inputManager.mouseY = 110;
itemWidget.groupId = WORNITEMS;
itemWidget.uid = (WORNITEMS << 16) | 1;
assert.equal(prices.widgetOverlay.signature(), "", "worn equipment is not presented as a RuneLite Item Prices target");
await Promise.all([prices.stop(), stats.stop()]);
console.log("Item Prices defaults, simultaneous Item Stats overlays, bank hover, and menu dismissal passed");
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
