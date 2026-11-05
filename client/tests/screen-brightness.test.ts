import assert from "node:assert/strict";

import {
    DEFAULT_SCREEN_BRIGHTNESS,
    gammaFromScreenBrightness,
    loadScreenBrightness,
    normalizeScreenBrightness,
    saveScreenBrightness,
} from "../ui/ScreenBrightness";

const close = (actual: number, expected: number, message: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

// The slider (cache script 3966) writes device option 6 as clamp(0, 100, slider * 5).
close(gammaFromScreenBrightness(0), 0.9, "the darkest is the classic level 1");
close(gammaFromScreenBrightness(100), 0.6, "the brightest is the classic level 4");
close(gammaFromScreenBrightness(50), 0.75, "linear in between");
assert.ok(gammaFromScreenBrightness(70) < gammaFromScreenBrightness(30), "a higher setting is a lower gamma (brighter)");
close(gammaFromScreenBrightness(DEFAULT_SCREEN_BRIGHTNESS), 0.75, "the default is 50% brightness");
assert.equal(DEFAULT_SCREEN_BRIGHTNESS, 50);
assert.equal(DEFAULT_SCREEN_BRIGHTNESS % 5, 0, "the default is a slider step");

assert.equal(normalizeScreenBrightness(-20), 0);
assert.equal(normalizeScreenBrightness(140), 100);
assert.equal(normalizeScreenBrightness(Number.NaN), DEFAULT_SCREEN_BRIGHTNESS);

// Kept in localStorage, like the interface scaling.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
};
assert.equal(loadScreenBrightness(), DEFAULT_SCREEN_BRIGHTNESS, "nothing saved yet");
saveScreenBrightness(80);
assert.equal(loadScreenBrightness(), 80);
store.set("osrs.screenBrightness", "garbage");
assert.equal(loadScreenBrightness(), DEFAULT_SCREEN_BRIGHTNESS, "a bad value falls back to the default");
(globalThis as any).localStorage = {
    getItem: () => {
        throw new Error("blocked");
    },
    setItem: () => {
        throw new Error("blocked");
    },
};
assert.equal(loadScreenBrightness(), DEFAULT_SCREEN_BRIGHTNESS, "blocked storage falls back to the default");
saveScreenBrightness(10);

console.log("screen-brightness: ok");
