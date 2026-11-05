import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cases = [
    { name: "Android phone", agent: "Mozilla/5.0 (Linux; Android 14) Chrome/156.0 Mobile Safari/537.36", touch: 5, width: 390, enabled: true },
    { name: "iPhone", agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", touch: 5, width: 390, enabled: true },
    { name: "iPad with desktop user agent", agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15", touch: 5, width: 1024, enabled: true },
    { name: "narrow desktop window", agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0", touch: 0, width: 375, enabled: false },
    { name: "touchscreen laptop", agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0", touch: 10, width: 1280, enabled: false },
    { name: "desktop Mac", agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", touch: 0, width: 1440, enabled: false },
    { name: "explicit mobile preview", agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", touch: 0, width: 1280, enabled: true, search: "?mobile=1" },
];

// Device flags are resolved at startup, so each case needs a fresh module cache.
for (const scenario of cases) {
    const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
        const assert = require("node:assert/strict");
        const scenario = ${JSON.stringify(scenario)};
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
            userAgent: scenario.agent, maxTouchPoints: scenario.touch,
        } });
        globalThis.window = { innerWidth: scenario.width, location: { search: scenario.search || "" }, addEventListener() {} };
        const { LowEndDevicePlugin } = require("./game/plugins/lowenddevice/LowEndDevicePlugin");
        const { ConfigManager } = require("./runelite/client/config/ConfigManager");
        const { EventBus } = require("./runelite/client/eventbus/EventBus");
        const { PluginManager } = require("./runelite/client/plugins/PluginManager");
        assert.equal(LowEndDevicePlugin.descriptor.enabledByDefault, scenario.enabled);
        for (const saved of [undefined, "true", "false"]) {
            const events = new EventBus();
            const config = new ConfigManager(events);
            if (saved !== undefined) config.setConfiguration("runelite", "lowenddeviceplugin", saved);
            const manager = new PluginManager(events, config);
            manager.loadCorePlugins([LowEndDevicePlugin]);
            const expected = saved === undefined ? scenario.enabled : saved === "true";
            assert.equal(manager.getPlugin(LowEndDevicePlugin).isEnabled(), expected);
            assert.equal(require("./game/plugins/lowenddevice/LowEndDeviceMode").lowEndDeviceModeEnabled, expected);
        }
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, `${scenario.name}: ${result.stderr || result.stdout}`);
}
console.log("low-end device defaults: 7 device cases, including saved overrides, passed");
