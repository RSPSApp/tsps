import { strict as assert } from "node:assert";
import * as NpcID from "@runelite/api/gameval/NpcID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { IMPLINGS, IMPLING_TYPES, findImpling } from "../game/plugins/implings/Impling";
import { IMPLING_SPAWNS } from "../game/plugins/implings/ImplingSpawn";
import { ImplingsConfig } from "../game/plugins/implings/ImplingsConfig";
import { PURO_PURO, regionId } from "../game/plugins/implings/ImplingsOverlay";
import { ImplingsPlugin } from "../game/plugins/implings/ImplingsPlugin";
import { bindNpcEvents } from "../runelite/impl/NpcEventSource";

assert.equal(ImplingsPlugin.descriptor.enabledByDefault, false, "fresh installs start disabled");

// --- Impling lookup by NPC id ---------------------------------------------------------------------
assert.equal(IMPLINGS.length, 39, "RuneLite's 39 impling NPC ids");
assert.equal(new Set(IMPLINGS.map((i) => i.npcId)).size, IMPLINGS.length, "no id twice");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_1)?.type, "BABY");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_1_MAZE)?.type, "BABY", "Puro-Puro ids too");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_6)?.type, "ECLECTIC");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_10)?.type, "DRAGON");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_11_MAZE)?.type, "LUCKY");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_12_STEWIE)?.type, "CRYSTAL");
assert.equal(findImpling(NpcID.II_IMPLING_TYPE_12_PRECURSOR), undefined, "not in RuneLite's list");
assert.equal(findImpling(655), undefined, "a goblin is no impling");
for (const type of IMPLING_TYPES) assert.ok(IMPLINGS.some((i) => i.type === type), `${type} has ids`);

// --- Puro-Puro spawns and region ------------------------------------------------------------------
assert.equal(IMPLING_SPAWNS.length, 44);
assert.ok(IMPLING_SPAWNS.every((s) => regionId(s.x, s.y) === PURO_PURO), "every spawn is in Puro-Puro");
assert.equal(PURO_PURO, 10307);

// --- Config: RuneLite's group, keys and defaults --------------------------------------------------
assert.equal(ImplingsConfig.group, "implings");
const items = ImplingsConfig.items;
assert.equal(items.showBaby.keyName, "showbaby");
assert.equal(items.showCrystal.keyName, "showCrystal", "RuneLite's one camel-case key");
assert.equal(items.showName.keyName, "showname");
assert.equal(items.showDragon.default, "HIGHLIGHT");
assert.equal(items.showLucky.default, "HIGHLIGHT");
assert.equal(items.babyColor.default, 0xffb18fb3, "Color(177, 143, 179)");
assert.equal(items.luckyColor.default, 0xff660765, "Color(102, 7, 101)");
assert.equal(items.showBaby.section, "implings");
assert.equal(ImplingsConfig.sections?.implings?.name, "Impling type settings");

// --- The plugin -----------------------------------------------------------------------------------
const BABY = NpcID.II_IMPLING_TYPE_1, EARTH = NpcID.II_IMPLING_TYPE_4, DRAGON = NpcID.II_IMPLING_TYPE_10;
const GOBLIN = 655;
const npcType = (name: string) => ({ name, size: 1, isInteractable: true, isFollower: false, params: new Map() });
const types: Record<number, any> = {
    [BABY]: npcType("Baby impling"),
    [EARTH]: npcType("Earth impling"),
    [DRAGON]: npcType("Dragon impling"),
    [GOBLIN]: npcType("Goblin"),
};
const npcs = new NpcEcs(16);
const messages: string[] = [];
const client: any = {
    gameState: 30,
    npcEcs: npcs,
    npcTypeLoader: { load: (id: number) => types[id] },
    varManager: {},
    controlledPlayerServerId: 1,
    playerTileX: 3200,
    playerTileY: 3200,
    playerEcs: {
        getIndexForServerId: () => 0,
        getX: () => client.playerTileX * 128,
        getY: () => client.playerTileY * 128,
        getLevel: () => 0,
    },
    sceneGeometry: {
        tileHeight: () => 0,
        worldToScreen: (x: number, h: number, y: number) => [x * 10, y * 10 + h * 10],
        npcHeight: () => 100,
    },
    minimapGeometry: { drawnAt: 0, plane: 0, scale: 1, worldToMinimap: (x: number, y: number) => [x, y] },
    addGameMessage: (message: string) => messages.push(message),
};
const npcAt = (type: number, tileX: number, tileY: number) =>
    npcs.createNpc(50, 50, type, 1, (tileX - 3200) * 128 + 64, (tileY - 3200) * 128 + 64, 0, 0, tileX, tileY);

async function main(): Promise<void> {
    const config = inject(ConfigManager);
    const set = (key: keyof typeof items, value: unknown) => config.setConfigValue(ImplingsConfig, key as any, value);
    const plugin = new ImplingsPlugin(client);
    assert.equal(ImplingsPlugin.descriptor.configKey, "implingsplugin");
    assert.equal(ImplingsPlugin.config, ImplingsConfig);

    // Mode per type, with RuneLite's defaults.
    assert.equal(plugin.showImplingType("BABY"), "NONE");
    assert.equal(plugin.showImplingType("DRAGON"), "HIGHLIGHT");
    assert.equal(plugin.showImplingType("LUCKY"), "HIGHLIGHT");
    set("showBaby", "NOTIFY");
    set("showEarth", "HIGHLIGHT");
    assert.equal(plugin.showImplingType("BABY"), "NOTIFY");
    assert.equal(plugin.showImplingType("EARTH"), "HIGHLIGHT");
    assert.equal(plugin.showImplingType("YOUNG"), "NONE", "other types keep their own mode");
    assert.equal(plugin.showImpling(findImpling(BABY)!), true, "NOTIFY also highlights");
    assert.equal(plugin.showImpling(findImpling(NpcID.II_IMPLING_TYPE_2)!), false);

    // Colour per type.
    assert.equal(plugin.implingColor("EARTH"), 0xff3e5640);
    assert.equal(plugin.implingColor("DRAGON"), 0xffd2554b);
    set("earthColor", 0x8000ff00);
    assert.equal(plugin.implingColor("EARTH"), 0x8000ff00, "alpha kept");
    assert.equal(plugin.implingColor("BABY"), 0xffb18fb3, "other colours unchanged");

    // Highlights and notifications from NPC events.
    const bus = new EventBus();
    bus.register(plugin);
    bindNpcEvents(npcs, (event) => bus.post(event));
    const removeListener = config.addListener((event) => plugin.onConfigChanged(event));

    const dragon = npcAt(DRAGON, 3203, 3203);
    npcs.setServerMapping(dragon, 11);
    await plugin.start();
    assert.ok(plugin.highlightedNpcs.has(dragon), "startUp finds loaded implings");
    assert.deepEqual(messages, [], "HIGHLIGHT does not notify");

    const baby = npcAt(BABY, 3205, 3205);
    npcs.setServerMapping(baby, 12);
    assert.deepEqual(messages, ["<col=ff0000>Baby impling is in the area</col>"], "NOTIFY: one notification on spawn");
    assert.equal(plugin.highlightedNpcs.get(baby)?.name, "Baby impling");
    assert.equal(plugin.highlightedNpcs.get(baby)?.color, 0xffb18fb3);

    const goblin = npcAt(GOBLIN, 3206, 3206);
    npcs.setServerMapping(goblin, 13);
    assert.ok(!plugin.highlightedNpcs.has(goblin), "not an impling");
    assert.equal(messages.length, 1);

    // A goblin turning into an earth impling (NpcChanged) is highlighted, not notified.
    npcs.setNpcTypeId(goblin, EARTH);
    assert.equal(plugin.highlightedNpcs.get(goblin)?.color, 0x8000ff00);
    assert.equal(messages.length, 1);

    // Overlay: a tile and a name per highlighted impling, a minimap dot each, no minimap names.
    client.minimapGeometry.drawnAt = performance.now();
    let frame = JSON.parse(plugin.widgetOverlay.signature());
    assert.equal(frame[0].length, 3, "three tiles");
    assert.deepEqual(frame[1].map((t: any[]) => t[0]).sort(), ["Baby impling", "Dragon impling", "Earth impling"]);
    assert.equal(frame[2].length, 3, "three minimap dots");
    assert.equal(plugin.widgetOverlay.drawBelowWidgets, true);
    set("showName", true);
    frame = JSON.parse(plugin.widgetOverlay.signature());
    assert.equal(frame[1].length, 6, "names on the minimap too");
    set("showName", false);

    // Mode NONE: the highlight goes on the config change.
    set("showDragon", "NONE");
    assert.ok(!plugin.highlightedNpcs.has(dragon));
    set("showDragon", "HIGHLIGHT");
    assert.ok(plugin.highlightedNpcs.has(dragon));

    // Despawn.
    npcs.destroyNpc(baby);
    assert.ok(!plugin.highlightedNpcs.has(baby));

    // Puro-Puro spawns: only with the setting on, only inside Puro-Puro, only types not NONE.
    const texts = () => (JSON.parse(plugin.widgetOverlay.signature() || "[[],[],[]]")[1] as any[]).map((t) => t[0]);
    assert.ok(!texts().includes("Young"));
    set("showSpawn", true);
    assert.ok(!texts().includes("Baby"), "outside Puro-Puro: no spawns");
    client.playerTileX = 2591;
    client.playerTileY = 4320;
    const spawnTexts = texts();
    assert.equal(spawnTexts.filter((t) => t === "Baby").length, 11, "baby (NOTIFY) spawns in range");
    assert.equal(spawnTexts.filter((t) => t === "Earth").length, 5);
    assert.ok(!spawnTexts.includes("Young"), "NONE types skipped");
    client.playerTileX = 2620;
    client.playerTileY = 4348;
    assert.ok(texts().filter((t) => t === "Baby").length < 11, "far spawns skipped");
    set("showSpawn", false);

    // Logged out: nothing drawn. Shutdown clears the highlights.
    client.gameState = 10;
    assert.equal(plugin.widgetOverlay.signature(), "");
    client.gameState = 30;
    await plugin.stop();
    assert.equal(plugin.highlightedNpcs.size, 0);
    removeListener();
}

main()
    .then(() => console.log("implings plugin tests passed"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
