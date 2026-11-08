import assert from "node:assert/strict";
import { getUiScale, normalizeOsrsInterfaceScalingPercent, setUiScale } from "../ui/UiScale";

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
} finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
}
