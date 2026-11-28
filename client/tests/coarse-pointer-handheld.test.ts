import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// A coarse-pointer touch device is a handheld for memory and Auto purposes, even when its UA
// is a desktop one (a tablet on "desktop site", or a touch-only Windows device).
const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"), "-e", `
    const assert = require("node:assert/strict");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:160.0) Gecko/20100101 Firefox/160.0",
        maxTouchPoints: 10,
        hardwareConcurrency: 8,
        deviceMemory: 8,
    } });
    globalThis.matchMedia = (query) => ({ matches: /pointer: coarse/.test(query) });
    globalThis.window = {
        innerWidth: 1280, innerHeight: 720, devicePixelRatio: 3,
        location: { search: "" }, matchMedia: globalThis.matchMedia, addEventListener() {},
    };
    globalThis.self = globalThis;
    const fs = require("node:fs");
    require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
    for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };

    const { getPerformanceFacts } = require("./game/performance/PerformancePolicy");
    const facts = getPerformanceFacts();
    assert.equal(facts.coarsePointer, true);
    assert.equal(facts.handheld, true, "a coarse-pointer touch device is treated as handheld");

    const { getPerformancePolicy } = require("./game/performance/PerformancePolicy");
    const policy = getPerformancePolicy();
    assert.equal(policy.preset, "auto-mobile");
    assert.equal(policy.sceneResolution, 0.5);
    assert.equal(policy.drawDistanceCap, 12);
    assert.equal(policy.lodThresholdCap, 6);
    assert.equal(policy.workerCount, 1);
    assert.equal(policy.mapSquareCacheLimit, 64);
    assert.equal(policy.sceneChunkMaxSquares, 1);

    const { getCanvasResolutionScale } = require("./render/render/quality");
    assert.equal(getCanvasResolutionScale({ osrsClient: { gameState: 30, isOnLoginScreen: () => false } }, 400, 300), 2,
        "handheld canvas DPR cap applies");
`], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("coarse-pointer handheld: detection, Auto mobile, memory and canvas caps");
