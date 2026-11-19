import assert from "node:assert/strict";
import { GameState } from "@runelite/api/GameState";
import { GameStateChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { PingGrapherPlugin } from "../game/plugins/pinggrapher/PingGrapherPlugin";

(async () => {
    assert.equal(PingGrapherPlugin.descriptor.enabledByDefault, false);
    let clock = 0;
    let fail = false;
    let finish: (() => void) | undefined;
    let defer = false;
    const plugin = new PingGrapherPlugin(() => clock, async () => {
        if (defer) await new Promise<void>(resolve => { finish = resolve; });
        if (fail) throw new Error("offline");
        clock += 42;
    }, () => GameState.LOGGED_IN, () => "test-world");
    await plugin.start();
    try {
        await plugin.sample();
        assert.deepEqual(plugin.pings, [42]);
        plugin.onGameTick(); clock += 600; plugin.onGameTick();
        assert.deepEqual(plugin.ticks, [600]);
        for (let i = 0; i < 105; i++) await plugin.sample();
        assert.equal(plugin.pings.length, 100);
        fail = true;
        await plugin.sample();
        assert.equal(plugin.noResponseCount, 1);
        assert.equal(plugin.pings.at(-1), 42);
        inject(ConfigManager).setConfiguration("pinggraph", "enablePingSpikes", true);
        await plugin.sample();
        assert.equal(plugin.pings.at(-1), -1);
        fail = false;
        defer = true;
        const pending = plugin.sample();
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOGGED_IN));
        finish!(); await pending;
        assert.deepEqual(plugin.pings, [], "discard a response from the previous session");
        const stopped = plugin.sample();
        await plugin.stop();
        finish!(); await stopped;
        assert.deepEqual(plugin.pings, [], "discard a response after shutdown");
    } finally { await plugin.stop(); }
    console.log("Ping Grapher checks passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
