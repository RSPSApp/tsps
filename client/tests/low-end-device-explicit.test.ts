import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { GpuConfig } from "../game/plugins/gpu/GpuConfig";
import { GpuPlugin } from "../game/plugins/gpu/GpuPlugin";
import { LowEndDevicePlugin } from "../game/plugins/lowenddevice/LowEndDevicePlugin";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { PluginManager } from "../runelite/client/plugins/PluginManager";

(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module: any, file: string) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module: any, file: string) => { module.exports = file; };
const { HdPlugin } = require("../game/plugins/hd/HdPlugin");

async function main(): Promise<void> {
    // Desktop: both plugins were switched on by the user. The explicit Low-end
    // choice must win, while an explicit HD choice keeps working (the PR's rule).
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    manager.getInjector().provide(CLIENT_TOKEN, { applyScreenBrightness: () => {}, renderer: {} });
    manager.loadCorePlugins([GpuPlugin, LowEndDevicePlugin]);
    await manager.setPluginEnabled(GpuPlugin, true);
    config.setConfigValue(GpuConfig, "drawDistance", 70);
    await manager.setPluginEnabled(LowEndDevicePlugin, true);
    const clientPlugins = new ClientPluginManager();
    for (const plugin of manager.getPlugins()) clientPlugins.add(plugin);
    const hd = new HdPlugin();
    hd.setEnabledState(true);
    clientPlugins.add(hd);
    assert.equal(clientPlugins.gpuSettings()?.drawDistance, 12,
        "an explicitly enabled Low-end Device keeps its 12-tile view over the GPU plugin");
    assert.equal(clientPlugins.gpuSettings()?.fpsLimit, 30,
        "an explicitly enabled Low-end Device keeps its 30 fps cap over the GPU plugin");
    assert.equal(clientPlugins.hdEnabled(), true, "an explicit HD choice is preserved");
    await manager.setPluginEnabled(LowEndDevicePlugin, false);
    assert.equal(clientPlugins.gpuSettings()?.drawDistance, 70,
        "disabling the explicit Low-end Device returns the GPU choice");

    // Mobile default: Low-end Device is on without the user choosing it, so the
    // explicitly enabled GPU plugin must still win (the #2539 fix).
    const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
        const assert = require("node:assert/strict");
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
            maxTouchPoints: 5,
        } });
        globalThis.window = { innerWidth: 390, location: { search: "" }, addEventListener() {} };
        globalThis.self = globalThis;
        const fs = require("node:fs");
        require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
        for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
        const { ConfigManager } = require("./runelite/client/config/ConfigManager");
        const { EventBus } = require("./runelite/client/eventbus/EventBus");
        const { PluginManager } = require("./runelite/client/plugins/PluginManager");
        const { CLIENT_TOKEN } = require("./runelite/client/plugins/PluginInjector");
        const { GpuConfig } = require("./game/plugins/gpu/GpuConfig");
        const { GpuPlugin } = require("./game/plugins/gpu/GpuPlugin");
        const { LowEndDevicePlugin } = require("./game/plugins/lowenddevice/LowEndDevicePlugin");
        const { ClientPluginManager } = require("./game/plugins/ClientPluginManager");
        const { HdPlugin } = require("./game/plugins/hd/HdPlugin");

        (async () => {
            const events = new EventBus();
            const config = new ConfigManager(events);
            const manager = new PluginManager(events, config);
            manager.getInjector().provide(CLIENT_TOKEN, { applyScreenBrightness: () => {}, renderer: {} });
            manager.loadCorePlugins([GpuPlugin, LowEndDevicePlugin]);
            assert.equal(manager.isEnabled(LowEndDevicePlugin), true, "mobile Low-end Device is on by default");
            await manager.setPluginEnabled(GpuPlugin, true);
            config.setConfigValue(GpuConfig, "drawDistance", 70);
            const clientPlugins = new ClientPluginManager();
            for (const plugin of manager.getPlugins()) clientPlugins.add(plugin);
            const hd = new HdPlugin();
            hd.setEnabledState(true);
            clientPlugins.add(hd);
            assert.equal(clientPlugins.gpuSettings()?.drawDistance, 70,
                "the default mobile Low-end Device does not shadow an explicit GPU draw distance");
            assert.equal(clientPlugins.hdEnabled(), true, "117 HD works with the default mobile Low-end Device");
        })().catch((error) => { console.error(error); process.exitCode = 1; });
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
}
main().then(() => console.log("low-end device explicit: desktop precedence and mobile default both pass"))
    .catch((error) => { console.error(error); process.exitCode = 1; });
