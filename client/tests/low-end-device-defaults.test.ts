import assert from "node:assert/strict";
import fs from "node:fs";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { PerformanceConfig, PerformanceMode } from "../game/performance/PerformanceConfig";
import { PerformancePlugin } from "../game/performance/PerformancePlugin";
import {
    computePerformancePolicy,
    type PerformanceFacts,
} from "../game/performance/PerformancePolicy";

const desktopFacts: PerformanceFacts = {
    handheld: false, ios: false, phone: false, coarsePointer: false,
    cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "defaults-desktop",
};
const mobileFacts: PerformanceFacts = {
    handheld: true, ios: false, phone: true, coarsePointer: true,
    cores: 8, coresKnown: true, deviceMemoryGb: 4, signature: "defaults-mobile",
};

const plugins = fs.readFileSync(new URL("../runelite/client/plugins/index.ts", import.meta.url), "utf8");
assert.ok(plugins.includes("PerformancePlugin,"), "the Performance plugin is a core plugin");
assert.ok(!plugins.includes("LowEndDevicePlugin,"), "the old Low-end Device plugin is not loaded");
assert.equal(PerformancePlugin.descriptor.enabledByDefault, true);

// A mobile default (no saved old-plugin key) stays Auto, which is the mobile preset.
{
    const config = new ConfigManager();
    const policy = computePerformancePolicy(config, { facts: mobileFacts, probe: false });
    assert.equal(policy.mode, PerformanceMode.AUTO);
    assert.equal(policy.preset, "auto-mobile");
    assert.equal(policy.sceneResolution, 0.6);
    assert.equal(policy.workerCount, 1);
}

// An explicit old Low-end Device choice migrates to Low.
{
    const config = new ConfigManager();
    config.setConfiguration("runelite", "lowenddeviceplugin", "true");
    const policy = computePerformancePolicy(config, { facts: desktopFacts, probe: false });
    assert.equal(policy.mode, PerformanceMode.LOW);
    assert.equal(policy.preset, "low");
    assert.equal(policy.sceneResolution, 0.5);
    assert.equal(config.getConfiguration("performance", "mode"), "Low", "the migration is saved");
}

// Explicitly turning the old plugin off is not an explicit Low choice.
{
    const config = new ConfigManager();
    config.setConfiguration("runelite", "lowenddeviceplugin", "false");
    const policy = computePerformancePolicy(config, { facts: desktopFacts, probe: false });
    assert.equal(policy.mode, PerformanceMode.AUTO);
}

// A saved new preset always wins over the old key.
{
    const config = new ConfigManager();
    config.setConfiguration("runelite", "lowenddeviceplugin", "true");
    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
    const policy = computePerformancePolicy(config, { facts: desktopFacts, probe: false });
    assert.equal(policy.mode, PerformanceMode.HIGH);
    assert.equal(policy.preset, "high");
}

console.log("low-end device defaults: migration preserves explicit Low vs mobile Auto");
