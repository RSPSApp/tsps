import assert from "node:assert/strict";
import fs from "node:fs";
import { LowEndDevicePlugin } from "../game/plugins/lowenddevice/LowEndDevicePlugin";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { PluginManager } from "../runelite/client/plugins/PluginManager";

(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const { HdPlugin } = require("../game/plugins/hd/HdPlugin");
const { getSceneResolutionScale, resolveBrowserQualityProfile } = require("../render/render/quality");
const { resolveEffectiveRenderDistanceTiles } = require("../render/render/draw2");
const { resolveEffectiveLodThresholdTiles } = require("../render/render/misc");
const { resolveWebGPURenderDistance, resolveWebGPULodDistance } = require("../render/webgpu/frameConfig");

async function main(): Promise<void> {
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    manager.loadCorePlugins([LowEndDevicePlugin]);
    const plugin = manager.getPlugin(LowEndDevicePlugin)!;
    assert.equal(plugin.isEnabled(), false);
    assert.equal(plugin.gpuSettings(), undefined);

    const clientPlugins = new ClientPluginManager();
    clientPlugins.add(plugin);
    const normal = { drawDistance: 70, msaaSamples: 4, fpsLimit: 120 };
    clientPlugins.add({ gpuSettings: () => normal as any });
    const client = { clientPlugins, renderDistance: 70, lodDistance: 60, isOnLoginScreen: () => false };
    const host: any = {
        osrsClient: client, sceneResolutionScale: 1,
        syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
        getFrameRenderDistanceTiles: () => resolveEffectiveRenderDistanceTiles(host, frame),
    };
    const hd = new HdPlugin();
    hd.setEnabledState(true);
    let frame = 1;
    assert.equal(hd.hdEnabled(), true);
    assert.equal(clientPlugins.gpuSettings(), normal);

    await manager.setPluginEnabled(LowEndDevicePlugin, true);
    assert.equal(clientPlugins.gpuSettings()?.fpsLimit, 30);
    assert.equal(clientPlugins.gpuSettings()?.msaaSamples, 0);
    assert.equal(clientPlugins.gpuSettings()?.fxaa, false);
    assert.equal(hd.hdEnabled(), true, "an explicitly enabled HD plugin keeps working");
    assert.equal(hd.isEnabled(), true);
    assert.equal(getSceneResolutionScale(host), 0.5);
    assert.equal(resolveEffectiveRenderDistanceTiles(host, frame), 12);
    assert.equal(resolveEffectiveLodThresholdTiles(host, frame), 6);
    assert.equal(resolveWebGPURenderDistance(host), 12);
    assert.equal(resolveWebGPULodDistance(host), 6);
    client.isOnLoginScreen = () => true;
    assert.equal(getSceneResolutionScale(host), 1, "login screen stays full resolution");

    await manager.setPluginEnabled(LowEndDevicePlugin, false);
    frame++;
    assert.equal(clientPlugins.gpuSettings(), normal, "normal GPU choices return");
    assert.equal(hd.hdEnabled(), true, "HD choice returns");
    assert.equal(resolveBrowserQualityProfile(host).key, "desktop");
    assert.equal(resolveEffectiveRenderDistanceTiles(host, frame), 70);
    assert.equal(resolveWebGPURenderDistance(host), 70);
    assert.equal(clientPlugins.sceneResolutionScale(), 1);
}
main().then(() => console.log("low-end device: ok")).catch((error) => { console.error(error); process.exitCode = 1; });
