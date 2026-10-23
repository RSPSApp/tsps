import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { PluginInjector, CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { GameTick, PostClientTick } from "@runelite/api/events";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { NPCIndicatorsPlugin, NPCIndicatorsConfig, npcIndicatorRules } from "../game/plugins/npcindicators/NPCIndicatorsPlugin";

async function main() {
    assert.equal(NPCIndicatorsPlugin.descriptor.enabledByDefault, false);
    assert.deepEqual(npcIndicatorRules(" Goblin |#00ff00\ngoblin|#ff0000,Man|invalid\n,Guard|#abcdef", 0x123456), [
        { name: "goblin", color: 0x00ff00 }, { name: "man", color: 0x123456 }, { name: "guard", color: 0xabcdef },
    ]);
    assert.deepEqual(npcIndicatorRules("", 1), []);
    assert.equal(npcIndicatorRules(Array.from({ length: 140 }, (_, i) => `NPC ${i}`).join("\n"), 1).length, 128);

    const bus = new EventBus();
    const config = new ConfigManager(bus);
    const toolbar = new ClientToolbar();
    const actors = new Map([
        [1, { x: 3200, y: 3201, plane: 0, active: true }],
        [2, { x: 3200, y: 3201, plane: 0, active: true }],
    ]);
    let transformed: { name: string } | null = { name: "<col=00ff00>Goblin</col>" };
    let plane = 0;
    let local: number | undefined = 0;
    const client: any = {
        gameState: 30, controlledPlayerServerId: 1,
        playerEcs: { getIndexForServerId: () => local, getLevel: () => plane },
        tileHighlightManager: new TileHighlightManager(),
        npcEcs: {
            getAllActiveIds: () => [...actors.keys()], getLevel: (id: number) => actors.get(id)!.plane,
            isActive: (id: number) => actors.get(id)!.active, getNpcTypeId: () => 7,
            getWorldX: (id: number) => actors.get(id)!.x * 128,
            getWorldY: (id: number) => actors.get(id)!.y * 128,
        },
        npcTypeLoader: { load: () => ({ transforms: [1], transform: () => transformed }) },
        varManager: {},
    };
    const injector = new PluginInjector(config).provide(ConfigManager, config).provide(ClientToolbar, toolbar).provide(CLIENT_TOKEN, client);
    const npc = injector.runWith(() => new NPCIndicatorsPlugin());
    const entries = () => client.tileHighlightManager.getRenderEntries() as { x: number; y: number; colorRgb: number; fillAlpha: number; slot: number }[];
    const owned = () => entries().filter(entry => entry.slot >= 62000);
    client.tileHighlightManager.configure(4, 0x123456, 1, 50, 0);
    client.tileHighlightManager.set((3200 << 14) | 3200, 4, 0);
    assert.equal(toolbar.getNavigations().length, 0, "no icon before enable");
    await npc.start();
    bus.register(npc);
    assert.equal(toolbar.getNavigations().length, 1, "enabling adds its sidebar button");
    const button = toolbar.getNavigations()[0];
    assert.equal(button.tooltip, "NPC Indicators");
    assert.ok(button.icon);
    assert.ok(button.panel);
    assert.match(renderToStaticMarkup(createElement(button.icon!, { label: button.tooltip })), /<svg/);
    const panel = renderToStaticMarkup(createElement(button.panel!));
    for (const label of ["NPC names", "Default colour", "Fill opacity"]) assert.ok(panel.includes(label), label);
    assert.match(panel, /type="color"/);
    assert.match(panel, /<textarea/);
    assert.equal(owned().length, 0, "empty configuration highlights nothing");
    // The generated ConfigPanel writes through this same manager and event bus.
    config.setConfigValue(NPCIndicatorsConfig, "names", "Goblin|#00ff00\nMan");
    assert.equal(owned().length, 1, "overlapping NPCs share one marker");
    assert.equal(owned()[0].colorRgb, 0x00ff00);
    actors.get(1)!.x = 3202;
    bus.post(new PostClientTick());
    assert.deepEqual(owned().map(entry => entry.x).sort(), [3200, 3202], "interpolated movement updates before another GameTick");
    actors.get(2)!.active = false;
    bus.post(new PostClientTick());
    assert.deepEqual(owned().map(entry => entry.x), [3202], "despawn removes its old shared tile");
    assert.equal(entries().filter(entry => entry.slot === 4).length, 1, "other owners remain untouched");
    transformed = null;
    bus.post(new GameTick());
    assert.equal(owned().length, 0, "null transformations are invisible");
    transformed = { name: "Man" };
    config.setConfigValue(NPCIndicatorsConfig, "color", 0x112233);
    config.setConfigValue(NPCIndicatorsConfig, "fill", 35);
    assert.equal(owned()[0].colorRgb, 0x112233);
    assert.equal(owned()[0].fillAlpha, 0.35);
    plane = 1; bus.post(new GameTick());
    assert.equal(owned().length, 0, "other planes are excluded");
    plane = 0; bus.post(new GameTick());
    npc.onGameStateChanged();
    assert.equal(owned().length, 0, "scene changes clear owned tiles");
    bus.post(new GameTick()); local = undefined; bus.post(new PostClientTick());
    assert.equal(owned().length, 0, "missing local player clears stale tiles");
    local = 0; bus.post(new GameTick());
    await npc.stop();
    assert.equal(owned().length, 0, "disable removes owned markers");
    assert.equal(toolbar.getNavigations().length, 0, "disable removes sidebar button");
    assert.equal(entries().length, 1, "disable preserves another owner's tile");
    await npc.start(); await npc.start();
    assert.equal(toolbar.getNavigations().length, 1, "re-enabling adds only one button");
    await npc.stop();
    assert.equal(toolbar.getNavigations().length, 0);
    console.log("NPC Indicators config, marker movement and sidebar lifecycle tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
