import assert from "node:assert/strict";
import test from "node:test";
import { getUiScale, setUiScale } from "../ui/UiScale";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
function withStorage(descriptor: PropertyDescriptor | undefined, run: () => void): void {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
    else Reflect.deleteProperty(globalThis, "localStorage");
    try { run(); } finally {
        if (original) Object.defineProperty(globalThis, "localStorage", original);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
}
const denied = () => { throw new DOMException("storage denied", "SecurityError"); };

// This must be the first stateful UI-scale operation in this process.
test("cold load defaults when the resolved storage getter denies access", () => {
    withStorage({ get: denied }, () => assert.equal(getUiScale(), 1));
});
test("numeric setter retains normalized memory value when getter denies access", () => {
    withStorage({ get: denied }, () => {
        assert.doesNotThrow(() => setUiScale(9));
        assert.equal(getUiScale(), 5);
    });
});
test("null setter restores the default when getter denies access", () => {
    withStorage(undefined, () => setUiScale(2));
    withStorage({ get: denied }, () => {
        assert.doesNotThrow(() => setUiScale(null));
        assert.equal(getUiScale(), 1);
    });
});
test("absent storage and failing methods retain in-memory values", () => {
    withStorage(undefined, () => { setUiScale(2); assert.equal(getUiScale(), 2); });
    withStorage({ value: { setItem: denied, removeItem: denied } }, () => {
        assert.doesNotThrow(() => setUiScale(3));
        assert.equal(getUiScale(), 3);
        assert.doesNotThrow(() => setUiScale(null));
        assert.equal(getUiScale(), 1);
    });
});
