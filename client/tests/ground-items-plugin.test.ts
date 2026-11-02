import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientState } from "../game/ClientState";
import { GroundItemStore } from "../game/data/ground/GroundItemStore";
import { GroundItemsConfig } from "../game/plugins/grounditems/GroundItemsConfig";
import { GroundItemsPlugin, collapse } from "../game/plugins/grounditems/GroundItemsPlugin";
import { STRING_GAP } from "../game/plugins/grounditems/GroundItemsOverlay";
import { MenuTargetType } from "../rs/MenuEntry";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { guidePrice, loadItemPrices } from "../network/serverConnection/domain/itemPrices";
import { state } from "../network/serverConnection/state";

const SHIFT = 81;
const COINS = 995, BONES = 526, WHIP = 4151, WHIP_NOTE = 4152, SCIM = 1333;
const objs: Record<number, any> = {
    [COINS]: { name: "Coins", price: 1, isTradable: true, stackability: 1, noteTemplate: -1, note: -1, model: -1 },
    [BONES]: { name: "Bones", price: 1, isTradable: true, stackability: 0, noteTemplate: -1, note: -1, model: -1 },
    [WHIP]: { name: "Abyssal whip", price: 120_001, isTradable: true, stackability: 0, noteTemplate: -1, note: -1, model: -1 },
    [WHIP_NOTE]: { name: "Abyssal whip", price: 120_001, isTradable: true, stackability: 0, noteTemplate: 799, note: WHIP, model: -1 },
    [SCIM]: { name: "Rune scimitar", price: 25_000, isTradable: true, stackability: 0, noteTemplate: -1, note: -1, model: -1 },
};
const prices: Record<number, number> = { [WHIP]: 1_500_000, [SCIM]: 15_000, [BONES]: 100 };

const store = new GroundItemStore();
store.setMetadataResolver((id) => ({ name: objs[id].name, gePrice: 0, haPrice: 0, tradeable: true }));
const messages: string[] = [];
const spawned: any[] = [];
const killed: number[] = [];
let filter: ((type: string, event: any) => boolean) | undefined;
const client: any = {
    gameState: 30,
    groundItems: store,
    objTypeLoader: { load: (id: number) => objs[id] },
    modelLoader: { getModel: () => undefined },
    controlledPlayerServerId: 1,
    playerEcs: { getIndexForServerId: () => 0, getX: () => 3200 * 128 + 64, getY: () => 3200 * 128 + 64, getLevel: () => 0 },
    sceneGeometry: {
        tileHeight: () => 0,
        worldToScreen: (x: number, h: number, y: number) => [(x - 3190) * 300, (y - 3190) * 60 + h * 10],
    },
    inputManager: { addInputFilter: (f: any) => ((filter = f), () => (filter = undefined)) },
    renderer: {
        registerWorldSpotAnimation: (event: any) => (spawned.push(event), spawned.length),
        killWorldSpotAnimation: (id: number) => killed.push(id),
    },
    addGameMessage: (m: string) => messages.push(m),
    getLocalAccountType: () => 0,
};

let stackId = 1;
const stack = (itemId: number, quantity: number, x = 3201, y = 3201, extra: object = {}) =>
    ({ id: stackId++, itemId, quantity, tile: { x, y, level: 0 }, ...extra });
const world = { surface: "world", menu: true } as const;
const objMenu = (itemId: number, option: string, actionIndex: number | undefined, name: string, x = 3201, y = 3201): SimpleMenuEntry => ({
    option,
    target: `<col=ff9040>${name}`,
    targetType: MenuTargetType.OBJ,
    targetId: itemId,
    mapX: x - ClientState.baseX,
    mapY: y - ClientState.baseY,
    actionIndex,
});

async function main(): Promise<void> {
    const config = inject(ConfigManager);
    const set = (key: string, value: unknown) => config.setConfigValue(GroundItemsConfig, key as any, value);
    const plugin = new GroundItemsPlugin(client);
    plugin.guidePrice = (id) => prices[id] ?? 0;
    const changed = () => plugin.onConfigChanged({ getGroup: () => "grounditems" } as any);
    set("hiddenItems", "Bones");
    set("notifyHighlightedDrops", true);
    set("highlightedItems", "Rune scimitar");
    await plugin.start();
    changed();
    assert.equal(GroundItemsPlugin.descriptor.enabledByDefault, true, "on by default, as in RuneLite");

    // --- Merging and prices ------------------------------------------------------------------
    store.update({ kind: "snapshot", serial: 1, stacks: [
        stack(COINS, 300, 3201, 3201, { expiresTick: 200, createdTick: 0 }),
        stack(COINS, 200, 3201, 3201, { expiresTick: 150 }),
        stack(WHIP_NOTE, 2, 3202, 3202),
        stack(BONES, 1, 3203, 3203),
    ] } as any);
    const items = [...plugin.groundItems().values()];
    assert.equal(items.length, 3, "two coin stacks on one tile merge");
    const coins = items.find((i) => i.id === COINS)!;
    assert.equal(coins.quantity, 500);
    assert.equal(coins.despawnTick, 150, "the earliest despawn");
    assert.deepEqual([coins.gePrice, coins.haPrice], [1, 1]);
    const whip = items.find((i) => i.id === WHIP_NOTE)!;
    assert.deepEqual([whip.itemId, whip.gePrice, whip.haPrice, whip.stackable], [WHIP, 1_500_000, 72_000, true], "noted: the unnoted item's prices");
    assert.deepEqual(messages, [], "a snapshot on login is not a drop... unless new");

    // --- Overlay: labels, colours, stacking, hidden items ------------------------------------
    let frame = JSON.parse(plugin.widgetOverlay.signature());
    let texts: [string, number, number, number][] = frame[1];
    assert.deepEqual(texts.map((t) => t[0]).sort(), ["Abyssal whip (2) (GE: 3M gp) (HA: 144K gp)", "Coins (500)"], "Bones are hidden");
    const whipText = texts.find((t) => t[0].startsWith("Abyssal"))!;
    assert.equal(whipText[3], 0xffff9600, "over 1M: the high value colour");
    assert.equal(texts.find((t) => t[0].startsWith("Coins"))![3], 0xffffffff);

    // Coverage: where the frame signature() built will draw, so moving labels redraw their own
    // rects rather than the whole UI. Unknown until a draw has supplied the font.
    const overlay = plugin.widgetOverlay as any;
    assert.equal(overlay.coverage(), undefined, "no font yet: the UI redraws whole");
    overlay.fontLoader = () => ({ measure: (text: string) => text.length * 6, maxAscent: 10, maxDescent: 3 });
    assert.deepEqual(
        overlay.coverage(),
        texts.map((t) => ({ x: t[1] - 2, y: t[2] - 16, w: t[0].length * 6 + 6, h: 22 })),
        "one rect per label: 2 px left of its baseline point, the text height above it, padded as draw() reports",
    );
    // Labels are formatted once per item, not every frame.
    const cachedCoins = overlay.labels.get(coins);
    assert.equal(cachedCoins?.text, "Coins (500)");
    plugin.widgetOverlay.signature();
    assert.equal(overlay.labels.get(coins), cachedCoins, "an unchanged item keeps its formatted label");
    coins.quantity = 501;
    plugin.widgetOverlay.signature();
    assert.equal(overlay.labels.get(coins)?.text, "Coins (501)", "a changed quantity reformats");
    coins.quantity = 500;

    store.update({ kind: "delta", serial: 2, upserts: [stack(SCIM, 1, 3201, 3201)], removes: [] } as any);
    frame = JSON.parse(plugin.widgetOverlay.signature());
    texts = frame[1];
    const coinY = texts.find((t) => t[0].startsWith("Coins"))![2];
    const scimY = texts.find((t) => t[0].startsWith("Rune"))![2];
    assert.equal(coinY - scimY, STRING_GAP, "the second item on a tile sits 15 px higher");
    assert.equal(messages.length, 1);
    assert.equal(messages[0], "<col=ff0000>You received a highlighted drop: Rune scimitar</col>");

    // Timers: TICKS in green while private.
    set("groundItemTimers", "TICKS");
    store.update({ kind: "delta", serial: 3, upserts: [stack(SCIM, 1, 3205, 3205, { expiresTick: 1_000_000, isPrivate: true })], removes: [] } as any);
    frame = JSON.parse(plugin.widgetOverlay.signature());
    const timers = (frame[1] as any[]).filter((t) => String(t[0]).startsWith(" - "));
    assert.equal(timers.length, 2, "timers only for items with a known despawn");
    assert.deepEqual(timers.map((t) => t[3]).sort(), [0xff00ff00, 0xffffff00], "private: green; public: yellow");
    assert.ok(timers.some((t) => t[0] === " - 150"), "TICKS: whole ticks left");
    set("groundItemTimers", "OFF");

    // Show highlighted only, highlight tiles, and item highlight mode MENU.
    set("showHighlightedOnly", true);
    changed();
    frame = JSON.parse(plugin.widgetOverlay.signature());
    assert.deepEqual((frame[1] as any[]).map((t) => t[0]).sort(), ["Abyssal whip (2) (GE: 3M gp) (HA: 144K gp)", "Rune scimitar (GE: 15K gp) (HA: 15K gp)", "Rune scimitar (GE: 15K gp) (HA: 15K gp)"]);
    set("showHighlightedOnly", false);
    set("highlightTiles", true);
    set("itemHighlightMode", "MENU");
    changed();
    frame = JSON.parse(plugin.widgetOverlay.signature());
    assert.equal(frame[1].length, 0, "MENU mode: no text");
    assert.ok(frame[0].length >= 3, "tiles still drawn");
    set("highlightTiles", false);
    set("itemHighlightMode", "BOTH");
    changed();

    // --- Hotkey mode: hidden items with boxes; clicks edit the lists --------------------------
    filter!("keyPressed", { keyCode: 18, altKey: true, repeat: false });
    assert.equal(plugin.hotKeyPressed, true);
    frame = JSON.parse(plugin.widgetOverlay.signature());
    assert.ok((frame[1] as any[]).some((t) => t[0] === "Bones (GE: 100 gp)"), "hidden items show with the hotkey");
    const boxes: any[] = frame[2];
    assert.equal(boxes.length, 2 * frame[1].length, "a hidden and a highlight box per label");
    // Hover the Bones hidden box, then click it: Bones leave the hidden list.
    const bones = (frame[1] as any[]).find((t) => t[0] === "Bones (GE: 100 gp)");
    const bonesIndex = (frame[1] as any[]).indexOf(bones);
    const [bx, by] = boxes[bonesIndex * 2];
    assert.equal(boxes[bonesIndex * 2][3], true, "the hidden box is filled for a hidden item");
    plugin.input.mouse = [bx + 1, by + 1];
    plugin.widgetOverlay.signature();
    assert.ok(plugin.hiddenBox, "hovered box remembered");
    assert.equal(plugin.input.mousePressed({ button: 0 }), true, "consumed");
    assert.equal(config.getConfiguration("grounditems", "hiddenItems"), "");
    changed();
    // Right-click a name: hide it.
    frame = JSON.parse(plugin.widgetOverlay.signature());
    const coinsLabel = (frame[1] as any[]).find((t) => String(t[0]).startsWith("Coins"));
    plugin.input.mouse = [coinsLabel[1] + 2, coinsLabel[2] - 4];
    plugin.widgetOverlay.signature();
    assert.equal(plugin.input.mousePressed({ button: 2 }), true);
    assert.equal(config.getConfiguration("grounditems", "hiddenItems"), "Coins");
    assert.equal(plugin.input.mousePressed({ button: 1 }), false, "middle click: not ours");
    filter!("keyReleased", { keyCode: 18 });
    assert.equal(plugin.hotKeyPressed, false);
    assert.equal(plugin.input.mousePressed({ button: 0 }), false, "no hotkey: clicks pass");
    changed();

    // Double tap hides everything until the next press.
    let now = 1000;
    (plugin.input as any).now = () => now;
    plugin.input.keyPressed({ keyCode: 18, altKey: true });
    plugin.input.keyReleased({ keyCode: 18 });
    now += 100;
    plugin.input.keyPressed({ keyCode: 18, altKey: true });
    assert.equal(plugin.hideAll, true);
    assert.equal(plugin.widgetOverlay.signature(), "");
    plugin.input.keyReleased({ keyCode: 18 });
    now += 1000;
    plugin.input.keyPressed({ keyCode: 18, altKey: true });
    assert.equal(plugin.hideAll, false);
    plugin.input.keyReleased({ keyCode: 18 });

    // --- Menus ---------------------------------------------------------------------------------
    ClientState.setKeybindState(SHIFT, false);
    let menu = plugin.transformMenuEntries([
        objMenu(WHIP_NOTE, "Take", 2, "Abyssal whip", 3202, 3202),
        objMenu(WHIP_NOTE, "Examine", undefined, "Abyssal whip", 3202, 3202),
        objMenu(COINS, "Take", 2, "Coins"),
    ], world);
    assert.equal(menu[0].target, "<col=ff9600>Abyssal whip (2)", "NAME mode: the name in the tier colour, stack quantity");
    assert.equal(menu[0].option, "Take");
    assert.equal(menu[1].target, "<col=ff9040>Abyssal whip", "only Take is changed");
    assert.equal(menu[2].target, "<col=ff9040>Coins (500)", "hidden: not recoloured unless asked");
    set("menuHighlightMode", "BOTH");
    set("recolorMenuHiddenItems", true);
    menu = plugin.transformMenuEntries([objMenu(COINS, "Take", 2, "Coins")], world);
    assert.equal(menu[0].option, "<col=808080>Take");
    assert.equal(menu[0].target, "<col=808080>Coins (500)");
    set("showMenuItemQuantities", false);
    menu = plugin.transformMenuEntries([objMenu(COINS, "Take", 2, "Coins")], world);
    assert.equal(menu[0].target, "<col=808080>Coins");
    set("showMenuItemQuantities", true);
    set("recolorMenuHiddenItems", false);

    set("deprioritizeHiddenItems", true);
    assert.equal(plugin.deprioritizeGroundItem(store.getAllStacks().find((s) => s.itemId === COINS)!), true);
    assert.equal(plugin.deprioritizeGroundItem(store.getAllStacks().find((s) => s.itemId === SCIM)!), false);
    set("deprioritizeHiddenItems", false);

    // Collapse identical entries.
    const dup = [objMenu(BONES, "Take", 2, "Bones"), objMenu(BONES, "Take", 2, "Bones"), objMenu(SCIM, "Take", 2, "Rune scimitar")];
    assert.deepEqual(collapse(dup).map((e) => e.target), ["<col=ff9040>Bones x 2", "<col=ff9040>Rune scimitar"]);

    // Shift + Examine: the Color submenu, saved per item.
    ClientState.setKeybindState(SHIFT, true);
    menu = plugin.transformMenuEntries([objMenu(SCIM, "Take", 2, "Rune scimitar"), objMenu(SCIM, "Examine", undefined, "Rune scimitar")], world);
    assert.deepEqual(menu.map((e) => e.option), ["<col=aa00ff>Take", "Color", "Examine"]);
    assert.deepEqual(menu[1].subEntries!.map((e) => e.option),
        ["Pick", "<col=ff0000>Color", "<col=00ff00>Color", "<col=0000ff>Color", "<col=ffff00>Color", "<col=ff00ff>Color"]);
    menu[1].subEntries![2].onClick!();
    assert.equal(config.getConfiguration("grounditems", `highlight_${SCIM}`), "#ff00ff00");
    changed();
    menu = plugin.transformMenuEntries([objMenu(SCIM, "Take", 2, "Rune scimitar"), objMenu(SCIM, "Examine", undefined, "Rune scimitar")], world);
    assert.equal(menu[0].option, "<col=00ff00>Take", "the per-item colour wins");
    assert.equal(menu[1].subEntries![0].option, "Reset");
    assert.equal(menu[1].subEntries![2].option, "<col=00ff00>Color", "colours in use first");
    menu[1].subEntries![0].onClick!();
    assert.equal(config.getConfiguration("grounditems", `highlight_${SCIM}`), undefined);
    changed();
    ClientState.setKeybindState(SHIFT, false);
    set("menuHighlightMode", "NAME");

    // --- Notifications ---------------------------------------------------------------------------
    messages.length = 0;
    set("notifyHighlightedDrops", false);
    set("notifyTier", "MEDIUM");
    store.update({ kind: "delta", serial: 4, upserts: [stack(WHIP, 1, 3210, 3210)], removes: [] } as any);
    assert.deepEqual(messages, ["<col=ff0000>You received a valuable drop: Abyssal whip</col>"]);
    set("hiddenItems", "Abyssal whip");
    changed();
    store.update({ kind: "delta", serial: 5, upserts: [stack(WHIP, 1, 3211, 3211)], removes: [] } as any);
    assert.equal(messages.length, 1, "hidden: no tier notification");
    set("hiddenItems", "Coins");
    set("notifyTier", "OFF");
    changed();

    // --- Loot beams --------------------------------------------------------------------------------
    const beamAt = (x: number, y: number) => plugin.lootbeams.get(`${x}|${y}|0`);
    assert.equal(beamAt(3202, 3202)?.color, 0xffff9600, "1.5M whip stack over the HIGH tier: high colour beam");
    assert.equal(beamAt(3201, 3201), undefined, "nothing valuable");
    assert.ok(spawned.length > 0 && spawned.every((e) => e.loop === true));
    set("showLootbeamForHighlighted", true);
    changed();
    assert.equal(beamAt(3201, 3201)?.color, 0xffaa00ff, "a highlighted item's beam");
    set("lootbeamStyle", "LIGHT");
    changed();
    assert.equal(beamAt(3201, 3201)?.style, "LIGHT");
    const scimStacks = store.getAllStacks().filter((s) => s.itemId === SCIM && s.tile.x === 3201);
    store.update({ kind: "delta", serial: 6, upserts: [], removes: scimStacks.map((s) => s.id) } as any);
    assert.equal(beamAt(3201, 3201), undefined, "taken: beam removed");
    assert.ok(killed.length > 0);

    // Price-table readiness and login reloads update every derived view without a store mutation.
    const previousSocket = state.socket, previousWebRtc = state.webRtcConfig;
    try {
        let quote!: (prices: Record<number, number>) => void;
        state.webRtcConfig = {} as any;
        state.socket = { fetchContent: () => new Promise((resolve) => { quote = resolve; }) } as any;
        plugin.guidePrice = guidePrice;
        set("highlightedItems", "");
        set("hiddenItems", "");
        set("showLootbeamForHighlighted", false);
        set("valueCalculationMode", "GE");
        changed();
        const loading = loadItemPrices();
        store.update({ kind: "snapshot", serial: 7, stacks: [stack(WHIP, 1), stack(WHIP_NOTE, 2, 3202, 3202)] } as any);
        assert.equal(plugin.groundItemAt(3201, 3201, 0, WHIP)!.gePrice, 120_001, "loading uses the store value instead of stale facts");
        assert.equal(beamAt(3201, 3201), undefined);
        quote({ [WHIP]: 2_000_000 });
        await loading;
        const ready = plugin.groundItemAt(3201, 3201, 0, WHIP)!;
        assert.equal(ready.gePrice, 2_000_000);
        assert.equal(plugin.groundItemAt(3202, 3202, 0, WHIP_NOTE)!.gePrice, 2_000_000);
        assert.equal(plugin.evaluate(ready).color, 0xffff9600);
        plugin.widgetOverlay.signature();
        plugin.onGameTick();
        assert.equal(beamAt(3201, 3201)?.color, 0xffff9600, "late prices refresh beams even after labels already read them");

        const reloading = loadItemPrices();
        plugin.onGameTick();
        assert.equal(beamAt(3201, 3201), undefined, "reloading clears the old beam without a ground update");
        quote({ [WHIP]: 42 });
        await reloading;
        plugin.onGameTick();
        const cheap = plugin.groundItemAt(3201, 3201, 0, WHIP)!;
        assert.equal(cheap.gePrice, 42, "a new price table invalidates previously resolved facts");
        assert.equal(plugin.evaluate(cheap).color, 0xffffffff, "tier evaluations follow the new price");
        assert.equal(beamAt(3202, 3202), undefined, "noted-item beams follow the new quote too");
        store.update({ kind: "delta", serial: 8, upserts: [stack(WHIP, 1, 3204, 3204)], removes: [] } as any);
        assert.equal(plugin.groundItemAt(3204, 3204, 0, WHIP)!.gePrice, 42, "fresh drops cannot reuse a prior login's price");
    } finally {
        state.socket = previousSocket;
        state.webRtcConfig = previousWebRtc;
    }

    await plugin.stop();
    assert.equal([...plugin.lootbeams.keys()].length, 0, "shut down: no beams");
    assert.equal(filter, undefined, "input released");
    console.log("ground items plugin tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
