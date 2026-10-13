import { strict as assert } from "node:assert";

import { ClientTick, PluginChanged } from "@runelite/api/events";
import type { ConfigStorage } from "@runelite/client/config/ConfigStorage";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { Plugin } from "@runelite/client/plugins/Plugin";
import { PluginManager } from "@runelite/client/plugins/PluginManager";

class MemoryStorage implements ConfigStorage {
    private readonly values = new Map<string, string>();
    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
    removeItem(key: string): void {
        this.values.delete(key);
    }
    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }
    get length(): number {
        return this.values.size;
    }
}

async function main(): Promise<void> {
    const events: string[] = [];

    class TestPluginA extends Plugin {
        static descriptor = {
            name: "Test A",
            configKey: "testplugina",
        };
        protected async startUp(): Promise<void> {
            events.push("a:start");
        }
        protected async shutDown(): Promise<void> {
            events.push("a:stop");
        }
    }

    class TestPluginB extends Plugin {
        static descriptor = {
            name: "Test B",
            configKey: "testpluginb",
            enabledByDefault: false,
        };
    }

    class FailingPlugin extends Plugin {
        static descriptor = { name: "Failing", configKey: "failingplugin" };
        protected async startUp(): Promise<void> {
            throw new Error("nope");
        }
    }

    const storage = new MemoryStorage();
    const bus = new EventBus();
    const configManager = new ConfigManager(bus, storage);
    const manager = new PluginManager(bus, configManager);
    const pluginChanges: boolean[] = [];
    bus.subscribe(PluginChanged, (event) => pluginChanges.push(event.isEnabled()));

    manager.loadCorePlugins([TestPluginA, TestPluginB, FailingPlugin]);

    const pluginA = manager.getPlugin(TestPluginA)!;
    const pluginB = manager.getPlugin(TestPluginB)!;
    assert.equal(manager.isEnabled(TestPluginA), true, "enabled by default");
    assert.equal(manager.isEnabled(TestPluginB), false, "descriptor can opt out");
    assert.deepEqual(events, ["a:start"], "only enabled plugins start");

    assert.equal(manager.getConfigDescriptor(TestPluginA), undefined);

    await manager.setPluginEnabled(TestPluginA, false);
    assert.deepEqual(events, ["a:start", "a:stop"]);
    assert.equal(configManager.getConfiguration("runelite", "testplugina"), "false");
    assert.equal(manager.getState(TestPluginA), "disabled");

    // A fresh manager over the same storage restores the toggle.
    const second = new PluginManager(new EventBus(), new ConfigManager(new EventBus(), storage));
    second.loadCorePlugins([TestPluginA]);
    assert.equal(second.isEnabled(TestPluginA), false, "enabled state persists under runelite.<key>");

    await manager.setPluginEnabled(pluginB, true);
    assert.equal(manager.getState(pluginB), "enabled");
    assert.deepEqual(pluginChanges, [false, true], "PluginChanged posts on toggles");

    assert.equal(manager.getState(FailingPlugin), "failed");
    assert.equal(manager.getFailure(FailingPlugin), "nope");

    const pendingStarts: Array<() => void> = [];
    let ticks = 0;
    class SlowPlugin extends Plugin {
        static descriptor = { name: "Slow", enabledByDefault: false };
        protected async startUp(): Promise<void> {
            await new Promise<void>(resolve => pendingStarts.push(resolve));
        }
        onClientTick(): void { ticks++; }
    }
    manager.loadCorePlugins([SlowPlugin]);
    const firstEnable = manager.setPluginEnabled(SlowPlugin, true);
    await manager.setPluginEnabled(SlowPlugin, false);
    const secondEnable = manager.setPluginEnabled(SlowPlugin, true);
    pendingStarts[0]();
    await firstEnable;
    bus.post(new ClientTick());
    assert.equal(ticks, 0, "a cancelled startup must not register events during a later enable");
    pendingStarts[1]();
    await secondEnable;
    bus.post(new ClientTick());
    assert.equal(ticks, 1, "only the current startup registers events");
    await manager.setPluginEnabled(SlowPlugin, false);
    bus.post(new ClientTick());
    assert.equal(ticks, 1, "disable removes all event handlers");

    console.log("runelite plugin manager tests passed");
}

void main();
