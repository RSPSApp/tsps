import assert from "node:assert/strict";
import { AudioVarpController } from "../game/audio/AudioVarpController";
import {
    getUiScale,
    normalizeOsrsInterfaceScalingPercent,
    setMobileInterfaceScalingPercent,
    setUiScale,
} from "../ui/UiScale";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const values = new Map<string, string>();
const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
};
try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    assert.equal(getUiScale(), 1);
    assert.equal(normalizeOsrsInterfaceScalingPercent(999), 400);
    setUiScale(9);
    assert.equal(getUiScale(), 5);
    assert.equal(values.get("osrs.runeliteUiScale"), "5");
    setUiScale(null);
    assert.equal(getUiScale(), 1);
    assert.equal(values.has("osrs.runeliteUiScale"), false);

    // A Settings layout pass re-applies the selected mobile scale; only a real change
    // may resize the renderer. Nested refreshes (a resize script setting the option
    // again) must not recurse.
    let resizes = 0;
    const controller = new AudioVarpController({
        getMusicSystem: () => undefined,
        getSoundEffectSystem: () => undefined,
        getRenderer: () => ({
            canvas: { width: 800, height: 600 },
            onResize: () => {
                resizes++;
                controller.refreshUiScalingLayout();
            },
        }) as never,
        getMasterVolume: () => 1,
        setMasterVolume: () => {},
        getMusicVolume: () => 1,
        setMusicVolume: () => {},
        getSfxVolume: () => 1,
        setSfxVolume: () => {},
        getAmbientVolume: () => 1,
        setAmbientVolume: () => {},
    });
    setMobileInterfaceScalingPercent(175);
    resizes = 0;
    controller.applyInterfaceScalingPercentDeviceOption(175, true);
    assert.equal(resizes, 0, "re-applying the same mobile scale does not resize");
    controller.applyInterfaceScalingPercentDeviceOption(400, true);
    assert.equal(resizes, 1, "a changed mobile scale resizes once");
    assert.equal(resizes, 1, "a resize script re-applying the option cannot recurse");
    controller.applyInterfaceScalingPercentDeviceOption(175, true);
    assert.equal(resizes, 2);
} finally {
    setMobileInterfaceScalingPercent(400);
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
}
