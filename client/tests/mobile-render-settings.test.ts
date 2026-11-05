import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

// The GPU plugin's settings must be read before Low-end Device's fixed defaults.
const plugins = fs.readFileSync(new URL("../runelite/client/plugins/index.ts", import.meta.url), "utf8");
const gpu = plugins.indexOf("    GpuPlugin,");
const lowEnd = plugins.indexOf("    LowEndDevicePlugin,");
assert.ok(gpu >= 0 && lowEnd >= 0 && gpu < lowEnd,
    "an enabled GPU plugin must outrank Low-end Device's gpuSettings()");

const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
    const assert = require("node:assert/strict");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        maxTouchPoints: 5,
    } });
    globalThis.window = { innerWidth: 390, location: { search: "" }, addEventListener() {} };
    globalThis.self = globalThis;

    const { isTouchDevice } = require("./common/utils/DeviceUtil");
    assert.equal(isTouchDevice, true);
    const { resolveEffectiveRenderDistanceTiles } = require("./render/render/draw2");
    const { resolveEffectiveLodThresholdTiles } = require("./render/render/misc");
    const { resolveWebGPURenderDistance, resolveWebGPULodDistance } = require("./render/webgpu/frameConfig");
    const { setLowEndDeviceModeEnabled } = require("./game/plugins/lowenddevice/LowEndDeviceMode");

    let frame = 0;
    const host = (gpu, renderDistanceCap = 18, lodThresholdCap = 12) => {
        const settings = {
            osrsClient: {
                renderDistance: 25, lodDistance: 23, isOnLoginScreen: () => false,
                clientPlugins: { gpuSettings: () => gpu, hdEnabled: () => false, sceneResolutionScale: () => 1 },
            },
            syncBrowserQualityProfile: () => ({ renderDistanceCap, lodThresholdCap }),
        };
        settings.getFrameRenderDistanceTiles = () => resolveEffectiveRenderDistanceTiles(settings, ++frame);
        return settings;
    };

    setLowEndDeviceModeEnabled(true);
    const lowEnd = host({ drawDistance: 12, overrideDeviceCaps: false }, 12, 6);
    assert.equal(resolveEffectiveRenderDistanceTiles(lowEnd, ++frame), 12, "the low-end mode keeps its 12-tile view");
    assert.equal(resolveEffectiveLodThresholdTiles(lowEnd, ++frame), 6, "the low-end mode keeps its 6-tile detail cut");
    assert.equal(resolveWebGPURenderDistance(lowEnd), 12);
    assert.equal(resolveWebGPULodDistance(lowEnd), 6);
    setLowEndDeviceModeEnabled(false);

    const explicit = host({ drawDistance: 70, overrideDeviceCaps: true });
    assert.equal(resolveEffectiveRenderDistanceTiles(explicit, ++frame), 70,
        "an explicit draw distance must not be cut to the iPhone profile cap");
    assert.equal(resolveEffectiveLodThresholdTiles(explicit, ++frame), 68,
        "detail must follow the explicit draw distance on a phone");
    assert.equal(resolveWebGPURenderDistance(explicit), 70);
    assert.equal(resolveWebGPULodDistance(explicit), 68);

    const automatic = host(undefined);
    assert.equal(resolveEffectiveRenderDistanceTiles(automatic, ++frame), 18,
        "without a GPU choice the handheld profile still caps the view");
    assert.equal(resolveWebGPURenderDistance(automatic), 18);
`], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("mobile render settings: explicit GPU choices override the handheld caps");
