import { strict as assert } from "node:assert";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { CLIENT_TOKEN, PluginInjector } from "@runelite/client/plugins/PluginInjector";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { ClientTick, PostClientTick } from "@runelite/api/events";
import { NpcEcs } from "../game/ecs/NpcEcs";
import { TileHighlightManager } from "../game/highlights/TileHighlightManager";
import { NPCIndicatorsConfig, NPCIndicatorsPlugin } from "../game/plugins/npcindicators/NPCIndicatorsPlugin";

async function main() {
    const config = new ConfigManager(undefined);
    const ecs = new NpcEcs(8);
    const id = ecs.createNpc(50, 50, 7, 1, 64, 64, 0, 0, 0, 0);
    const other = ecs.createNpc(50, 50, 7, 1, 64, 64, 0, 0, 0, 0);
    ecs.setServerMapping(id, 1);
    ecs.setServerMapping(other, 2);
    const highlights = new TileHighlightManager();
    let configurations = 0;
    const configure = highlights.configure.bind(highlights);
    highlights.configure = (...args) => { configurations++; configure(...args); };
    let tileWrites = 0;
    const set = highlights.set.bind(highlights), remove = highlights.remove.bind(highlights);
    highlights.set = (...args) => { tileWrites++; set(...args); };
    highlights.remove = (...args) => { tileWrites++; remove(...args); };
    let plane = 0;
    const client: any = { gameState: 30, controlledPlayerServerId: 1, npcEcs: ecs,
        playerEcs: { getIndexForServerId: () => 0, getLevel: () => plane },
        npcTypeLoader: { load: () => ({ name: "Man" }) }, tileHighlightManager: highlights };
    config.setConfigValue(NPCIndicatorsConfig, "names", "Man|#00ff00");
    const injector = new PluginInjector(config).provide(ConfigManager, config).provide(ClientToolbar, new ClientToolbar()).provide(CLIENT_TOKEN, client);
    const plugin = injector.runWith(() => new NPCIndicatorsPlugin());
    await plugin.start(); plugin.onGameTick();
    const bus = new EventBus(); bus.register(plugin);
    const configured = configurations;
    ecs.enqueueStep(id, 192, 64, 4);
    for (let i = 0; i < 32; i++) {
        // Match OsrsClient.runClientTicks: interpolation happens between these events.
        bus.post(new ClientTick()); ecs.updateClient(1); bus.post(new PostClientTick());
        const positions = highlights.getRenderEntries().map(e => `${e.x},${e.y}`).sort();
        const expected = [...new Set([id, other].map(n => `${ecs.getWorldX(n) >> 7},${ecs.getWorldY(n) >> 7}`))].sort();
        assert.deepEqual(positions, expected, "markers follow actual interpolated ECS positions each client cycle");
    }
    assert.equal(ecs.getWorldX(id) >> 7, 3201, "fixture actually walked across a tile boundary");
    assert.equal(configurations, configured, "movement does not reconfigure styles every client cycle");
    const writes = tileWrites;
    bus.post(new PostClientTick());
    assert.equal(tileWrites, writes, "unchanged interpolated tiles do not rewrite highlights");
    assert.equal(highlights.getRenderEntries()[0].colorRgb, 0x00ff00);
    ecs.destroyNpc(id); bus.post(new PostClientTick());
    assert.equal(highlights.getRenderEntries().length, 1, "despawn clears only its old tile, retaining a shared NPC tile");
    plane = 1; bus.post(new PostClientTick());
    assert.equal(highlights.getRenderEntries().length, 0, "plane change clears markers immediately");
    plane = 0; plugin.onGameTick();
    await plugin.stop(); bus.post(new PostClientTick());
    assert.equal(highlights.getRenderEntries().length, 0, "disabled plugin cannot restore markers");
    console.log("NPC indicator following tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
