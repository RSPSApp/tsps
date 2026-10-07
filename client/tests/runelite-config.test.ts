import { strict as assert } from "node:assert";

import { ConfigChanged } from "@runelite/api/events";
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";
import type { ConfigStorage } from "@runelite/client/config/ConfigStorage";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { runLegacyConfigMigrations } from "@runelite/impl/LegacyConfigMigration";

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

const PriceDisplayMode = { BOTH: "both", GE: "ge", OFF: "off" } as const;

const TestConfig = ConfigGroup(
    "testplugin",
    {
        enabledByDefault: ConfigItem({ name: "Flag", default: true }),
        count: ConfigItem({ name: "Count", default: 5, range: { min: 0, max: 10 } }),
        label: ConfigItem({ name: "Label", default: "hello" }),
        colour: ConfigItem({ name: "Colour", color: true, default: 0xaa00ff }),
        mode: ConfigItem({ name: "Mode", enum: PriceDisplayMode, default: PriceDisplayMode.BOTH }),
        hiddenThing: ConfigItem({ name: "Hidden", hidden: true, default: 1 }),
    },
    { sections: { main: { name: "Main", position: 1 } } },
);

const bus = new EventBus();
const storage = new MemoryStorage();
const manager = new ConfigManager(bus, storage);
const config = manager.getConfig(TestConfig);

assert.equal(config.enabledByDefault(), true);
assert.equal(config.count(), 5);
assert.equal(config.label(), "hello");
assert.equal(config.colour(), 0xaa00ff);
assert.equal(config.mode(), "both");

const changes: ConfigChanged[] = [];
bus.subscribe(ConfigChanged, (event) => changes.push(event));

manager.setConfiguration(TestConfig.group, "count", "7");
assert.equal(config.count(), 7);
assert.equal(changes.length, 1);
assert.equal(changes[0].getOldValue(), undefined);
assert.equal(changes[0].getNewValue(), "7");

manager.setConfigValue(TestConfig, "count", 9);
assert.equal(config.count(), 9);
manager.setConfigValue(TestConfig, "colour", 0x112233);
assert.equal(config.colour(), 0x112233);
assert.equal(manager.getConfiguration(TestConfig.group, "colour"), "#112233", "colours serialise as hex");
manager.setConfigValue(TestConfig, "mode", "off");
assert.equal(config.mode(), "off");
assert.equal(manager.getConfiguration(TestConfig.group, "mode"), "OFF", "enums serialise by name");

const sameValueChanges = changes.length;
manager.setConfiguration(TestConfig.group, "count", "9");
assert.equal(changes.length, sameValueChanges, "unchanged writes do not post ConfigChanged");

manager.unsetConfiguration(TestConfig.group, "count");
assert.equal(config.count(), 5, "unset restores the default");

// Legacy migration: JSON blob fields land in rl.config.*, enabled becomes the plugin key.
storage.setItem("osrs.plugin.testplugin.v1", JSON.stringify({ enabled: false, count: 3, label: "old" }));
runLegacyConfigMigrations(
    [{ name: "testplugin", legacyKey: "osrs.plugin.testplugin.v1", config: TestConfig, enabledKey: "testplugin" }],
    manager,
);
assert.equal(config.count(), 3);
assert.equal(config.label(), "old");
assert.equal(manager.getConfiguration("runelite", "testplugin"), "false");
assert.equal(manager.isMigrated("testplugin"), true);

// A second run must not overwrite newer values.
manager.setConfigValue(TestConfig, "label", "new");
runLegacyConfigMigrations(
    [{ name: "testplugin", legacyKey: "osrs.plugin.testplugin.v1", config: TestConfig, enabledKey: "testplugin" }],
    manager,
);
assert.equal(config.label(), "new");

// Raw string legacy form (the old notes key).
const NotesConfig = ConfigGroup("notes", {
    notes: ConfigItem({ name: "Notes", textArea: true, default: "" }),
});
const notes = manager.getConfig(NotesConfig);
storage.setItem("osrs.sidebar.notes", "remember the milk");
runLegacyConfigMigrations(
    [{ name: "notes-sidebar", legacyKey: "osrs.sidebar.notes", config: NotesConfig, rawStringAs: "notes" }],
    manager,
);
assert.equal(notes.notes(), "remember the milk");

manager.destroy();
console.log("runelite config tests passed");
