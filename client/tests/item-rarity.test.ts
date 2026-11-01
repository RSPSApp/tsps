import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { GameState } from "@runelite/api/GameState";
import { loadItemPrices } from "../network/serverConnection/domain/itemPrices";
import { state } from "../network/serverConnection/state";
import { ItemRarityConfig, itemRarity, normalizeThreshold } from "../game/plugins/itemrarity/ItemRarityConfig";
import { ItemRarityPlugin } from "../game/plugins/itemrarity/ItemRarityPlugin";
import { canonicalItemId } from "../game/plugins/inventorytags/inventoryTags";

const thresholds = { minimum: 100, common: 1_000, uncommon: 10_000, rare: 100_000, veryRare: 1_000_000 };
assert.equal(itemRarity(99, thresholds), undefined);
assert.equal(itemRarity(100, thresholds), "COMMON");
assert.equal(itemRarity(1_000, thresholds), "UNCOMMON");
assert.equal(itemRarity(10_000, thresholds), "RARE");
assert.equal(itemRarity(100_000, thresholds), "VERY_RARE");
assert.equal(itemRarity(1_000_000, thresholds), "LEGENDARY");
assert.equal(itemRarity(Number.NaN, thresholds), undefined);
assert.equal(normalizeThreshold(-10, 20), 0);
assert.equal(normalizeThreshold("bad", 20), 20);
assert.equal(canonicalItemId(201, (id) => id === 201 ? { placeholderTemplate: 1, placeholder: 101 } : undefined), 101);
assert.equal(canonicalItemId(202, (id) => id === 202 ? { noteTemplate: 1, note: 102 } : undefined), 102);

const config = inject(ConfigManager);
const makeItem = (uid: number, itemId: number, x: number, extra: Record<string, unknown> = {}) => ({
    uid, itemId, itemQuantity: 1, _absX: x, _absY: 10, _absWidth: 36, _absHeight: 32, ...extra,
});
const groups: Record<number, any[]> = {
    149: [{ uid: 149 << 16, type: 0, _absX: 0, _absY: 0, _absWidth: 300, _absHeight: 42, children: [makeItem(1, 101, 0, { parentUid: 149 << 16 }), makeItem(2, 102, 40, { parentUid: 149 << 16 }), makeItem(3, 103, 80, { hidden: true, parentUid: 149 << 16 }), makeItem(6, 106, 200, { parentUid: 149 << 16 }), makeItem(7, 107, 240, { parentUid: 149 << 16 })] }],
    387: [makeItem(4, 104, 120)],
    12: [makeItem(5, 105, 145, { _absY: 5, parentUid: -1 })],
};
const definitions: Record<number, { price: number }> = {
    101: { price: 50_000 }, 102: { price: 500_000 }, 103: { price: 5_000_000 },
    104: { price: 2_000_000 }, 105: { price: 50_000 }, 106: { price: 5_000_000 }, 107: { price: 5_000_000 },
};
const client: any = {
    gameState: GameState.LOGGED_IN,
    objTypeLoader: { load: (id: number) => definitions[id] },
    widgetManager: {
        getWidgetsForGroup: (id: number) => groups[id] ?? [], isEffectivelyHidden: () => false,
        getInterfaceParentContainerUid: (groupId: number) => groupId === 12 ? 999 : undefined,
        getWidgetByUid: (uid: number) => uid === 999
            ? { uid, type: 0, parentUid: 998, _absX: 150, _absY: 10, _absWidth: 30, _absHeight: 30, scrollHeight: 100 }
            : uid === 998 ? { uid, type: 0, parentUid: -1, _absX: 155, _absY: 15, _absWidth: 15, _absHeight: 15, scrollHeight: 40 } : undefined,
    },
};

async function run(): Promise<void> {
    const previousSocket = state.socket;
    const previousWebRtcConfig = state.webRtcConfig;
    state.webRtcConfig = {} as any;
    state.socket = {
     fetchContent: async () => ({ 101: 50_000, 102: 500_000, 104: 2_000_000, 105: 50_000, 107: 0 }),
    } as any;
    await loadItemPrices();
    const plugin = new ItemRarityPlugin(client);
    await plugin.start();
    config.setConfigValue(ItemRarityConfig, "minimumPrice", 1);
    config.setConfigValue(ItemRarityConfig, "commonPrice", 10_000);
    config.setConfigValue(ItemRarityConfig, "uncommonPrice", 100_000);
    config.setConfigValue(ItemRarityConfig, "rarePrice", 1_000_000);
    config.setConfigValue(ItemRarityConfig, "veryRarePrice", 10_000_000);

    const calls: Array<{ key: string; x: number; y: number; w: number; h: number; uScale: number; vScale: number; uOffset: number; vOffset: number }> = [];
    const textures = new Map<string, { key: string }>();
    const outlinePixels: Uint8ClampedArray[] = [];
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => ({
                    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
                    putImageData: (image: { data: Uint8ClampedArray }) => outlinePixels.push(image.data),
                }),
            }),
        },
    });
    const renderer: any = {
        getTexture: (key: string) => textures.get(key),
        drawTexture: (texture: { key: string }, x: number, y: number, w: number, h: number, uScale: number, vScale: number, _tint: number, _color: unknown, _flipX: boolean, _flipY: boolean, _alpha: number, uOffset: number, vOffset: number) => calls.push({ key: texture.key, x, y, w, h, uScale, vScale, uOffset, vOffset }),
        drawRect() {},
        createTextureFromCanvas: (key: string) => {
            const texture = { key };
            textures.set(key, texture);
            return texture;
        },
        deleteTexture: (key: string) => textures.delete(key),
    };
    const signature = plugin.widgetOverlay.signature();
    const source = {
        width: 3,
        height: 3,
        getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }) }),
    };
    const rects = plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any);
    assert.equal(rects.length, 4, "inventory, equipment and bank items are outlined, hidden and unquoted items are skipped");
    assert.deepEqual(calls.map(({ x }) => x), [0, 40, 120, 155]);
    assert.deepEqual([calls[0].x, calls[0].y, calls[0].w, calls[0].h, calls[0].uScale, calls[0].vScale, calls[0].uOffset, calls[0].vOffset], [0, 10, 36, 32, 1, 1, 0, 0], "items without clipping ancestors keep their full geometry and texture");
    assert.deepEqual([calls[3].x, calls[3].y, calls[3].w, calls[3].h, calls[3].uScale, calls[3].vScale, calls[3].uOffset, calls[3].vOffset], [155, 15, 15, 15, 15 / 36, 15 / 32, 10 / 36, 10 / 32], "mounted and nested scroll clips crop all four edges without stretching the texture");
    groups[12][0]._isDragActive = true;
    assert.equal(plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any).at(-1)?.x, 145, "a dragged item bypasses ancestor clips like the renderer");
    assert.deepEqual([calls.at(-1)?.w, calls.at(-1)?.h, calls.at(-1)?.uOffset, calls.at(-1)?.vOffset], [36, 32, 0, 0]);
    delete groups[12][0]._isDragActive;
    assert.ok(!calls.some(({ x }) => x === 200), "an unquoted store-priced item is not treated as a GE-priced rarity");
    assert.ok(calls[0].key.endsWith(":66cc66:255"), "the 50,000 gp item uses the uncommon tier color at full opacity");
    assert.ok(calls[1].key.endsWith(":3399ff:255"), "the 500,000 gp item uses the rare tier color at full opacity");
    assert.ok(outlinePixels[0].some((alpha, i) => i % 4 === 3 && alpha > 0), "priced items create visible outline pixels");
    assert.equal(plugin.widgetOverlay.signature(), signature, "a stable inventory keeps its signature");

    config.setConfigValue(ItemRarityConfig, "uncommonColor", 0x8066cc66);
    assert.equal(plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any).length, 4);
    assert.ok(calls.at(-4)?.key.endsWith(":66cc66:128"), "custom color alpha is included in the texture key");
    assert.ok(outlinePixels.at(-1)?.some((alpha, i) => i % 4 === 3 && alpha === 128), "custom color alpha is applied to outline pixels");
    config.setConfigValue(ItemRarityConfig, "uncommonColor", 0xff66cc66);
    groups[149][0].children[0]._absY = 50;
    assert.equal(plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any).length, 3, "a scrolled-out item with stale absolute bounds is not outlined");
    groups[149][0].children[0]._absY = 10;
    assert.equal(plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any).length, 4, "successive overlay draws retain visible items");
    config.setConfigValue(ItemRarityConfig, "minimumPrice", 0);
    const zeroMinimumRects = plugin.widgetOverlay.draw({ renderer, itemImage: () => source } as any);
    assert.equal(zeroMinimumRects.length, 4, "an item with no guide quote stays hidden when the minimum price is zero");
    assert.ok(!calls.some(({ x }) => x === 200 || x === 240), "unquoted items never receive a rarity outline");
    config.setConfigValue(ItemRarityConfig, "minimumPrice", 1);

    client.menuOpen = true;
    assert.equal(plugin.widgetOverlay.signature(), "", "rarity outlines are hidden while the world context menu is open");
    assert.equal(plugin.widgetOverlay.draw({ renderer } as any).length, 0);
    client.menuOpen = false;
    client.renderer = { canvas: { __ui: { menu: { open: true } } } };
    assert.equal(plugin.widgetOverlay.signature(), signature, "a stale UI menu signal does not suppress rarity outlines");
    client.renderer.canvas.__ui.menu.open = false;

    config.setConfigValue(ItemRarityConfig, "showBank", false);
    assert.equal(plugin.widgetOverlay.draw({ renderer } as any).length, 3, "bank outlines can be disabled");
    client.gameState = GameState.LOGIN_SCREEN;
    assert.equal(plugin.widgetOverlay.signature(), "", "items are hidden while logged out");
    client.gameState = GameState.LOGGED_IN;
    await plugin.stop();
    assert.equal(plugin.widgetOverlay.signature(), "", "items are hidden when the plugin stops");
    if (previousDocument === undefined) delete (globalThis as any).document;
    else Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    state.socket = previousSocket;
    state.webRtcConfig = previousWebRtcConfig;
}

run().then(() => console.log("item rarity tests passed")).catch((error) => {
    console.error(error);
    process.exit(1);
});
