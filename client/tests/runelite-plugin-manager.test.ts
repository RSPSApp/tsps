import { strict as assert } from "node:assert";

import { PluginChanged } from "@runelite/api/events";
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

    console.log("runelite plugin manager tests passed");
}

void main();
