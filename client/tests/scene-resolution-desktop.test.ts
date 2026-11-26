import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The scene resolution must follow the platform, not touch hardware: a Windows laptop with a
// touchscreen still reports a coarse pointer, which used to put it on the low-end scene scale
// (0.6) even though it was laid out as a desktop. A 1652x982 canvas then rendered the scene at
// 991x589 and the final blit stretched it back with LINEAR filtering.
const cases = [
    {
        name: "touchscreen Windows laptop on the desktop layout",
        agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0",
        touch: 10,
        coarse: true,
        expectedScale: 1,
    },
    {
        name: "desktop without touch",
        agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0",
        touch: 0,
        coarse: false,
        expectedScale: 1,
    },
    {
        name: "Android phone",
        agent: "Mozilla/5.0 (Linux; Android 14) Chrome/156.0 Mobile Safari/537.36",
        touch: 5,
        coarse: true,
        expectedScale: 0.6,
    },
    {
        name: "iPhone",
        agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        touch: 5,
        coarse: true,
        expectedScale: 0.5,
    },
];

// Device flags are resolved at import time, so each case needs a fresh module cache.
for (const scenario of cases) {
    const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
        const assert = require("node:assert/strict");
        const scenario = ${JSON.stringify(scenario)};
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
            userAgent: scenario.agent, maxTouchPoints: scenario.touch,
        } });
        globalThis.matchMedia = (query) => ({ matches: scenario.coarse && /pointer: coarse/.test(query) });
        globalThis.window = {
            innerWidth: 1652, innerHeight: 982, location: { search: "" },
            matchMedia: globalThis.matchMedia, addEventListener() {},
        };
        globalThis.self = globalThis;
        const fs = require("node:fs");
        require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
        for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };

        const { getSceneResolutionScale, getSceneRenderSize, resolveBrowserQualityProfile } =
            require("./render/render/quality");
        const { ConfigManager } = require("./runelite/client/config/ConfigManager");
        const { PerformanceConfig, PerformanceMode } = require("./game/performance/PerformanceConfig");
        const { initPerformancePolicy, refreshPerformancePolicy } =
            require("./game/performance/PerformancePolicy");

        const config = new ConfigManager();
        initPerformancePolicy(config);
        const client = {
            clientPlugins: { sceneResolutionScale: () => 1 },
            isOnLoginScreen: () => false,
            mobileEffectiveResolutionScale: 1,
        };
        const host = {
            osrsClient: client,
            sceneResolutionScale: 1,
            app: { width: 1652, height: 982 },
            getSceneResolutionScale: () => getSceneResolutionScale(host),
            syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
        };

        assert.equal(getSceneResolutionScale(host), scenario.expectedScale,
            "default scene scale follows the platform/preset");
        assert.deepEqual(getSceneRenderSize(host), {
            width: Math.round(1652 * scenario.expectedScale),
            height: Math.round(982 * scenario.expectedScale),
        }, "the scene framebuffer matches the chosen scale");

        if (scenario.expectedScale === 1) {
            // An explicit user choice still reduces the scene; it is not forced to native.
            host.sceneResolutionScale = 0.75;
            assert.equal(getSceneResolutionScale(host), 0.75, "debug scene resolution setting still applies");
            host.sceneResolutionScale = 1;

            // The explicit Low preset keeps its half-resolution scene.
            config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
            refreshPerformancePolicy();
            assert.equal(resolveBrowserQualityProfile(host).key, "low-end");
            assert.equal(getSceneResolutionScale(host), 0.5, "explicit Low renders at half");

            config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
            refreshPerformancePolicy();
            assert.equal(getSceneResolutionScale(host), 1, "High renders natively");
        }

        client.isOnLoginScreen = () => true;
        assert.equal(getSceneResolutionScale(host), 1, "login screen stays full resolution");
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, `${scenario.name}: ${result.stderr || result.stdout}`);
}

console.log("scene resolution: desktop stays at 1.0, mobile keeps its performance scale");
