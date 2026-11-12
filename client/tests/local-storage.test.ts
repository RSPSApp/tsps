import assert from "node:assert/strict";

import {
    canUseLocalStorage,
    readLocalStorageBool,
    readLocalStorageItem,
    readLocalStorageJson,
    removeLocalStorageItem,
    writeLocalStorageBool,
    writeLocalStorageItem,
    writeLocalStorageJson,
} from "../common/utils/localStorage";
import {
    loadClientPreferences,
    resetClientPreferencesCache,
    updateClientPreferences,
} from "../game/preferences/ClientPreferences";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const setWindow = (value: unknown) => {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value });
};

try {
    Reflect.deleteProperty(globalThis, "window");
    assert.equal(canUseLocalStorage(), false);
    assert.equal(readLocalStorageItem("missing"), undefined);
    assert.equal(writeLocalStorageItem("key", "value"), false);
    assert.doesNotThrow(() => removeLocalStorageItem("key"));
    setWindow({});
    assert.equal(canUseLocalStorage(), false);
    assert.equal(readLocalStorageBool("missing", true), true);

    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
    };
    setWindow({ localStorage: storage });
    assert.equal(canUseLocalStorage(), true);
    assert.equal(readLocalStorageItem("missing"), undefined);
    assert.equal(writeLocalStorageItem("empty", ""), true);
    assert.equal(readLocalStorageItem("empty"), "");
    assert.equal(writeLocalStorageItem("text", "hello"), true);
    assert.equal(readLocalStorageItem("text"), "hello");
    removeLocalStorageItem("text");
    assert.equal(readLocalStorageItem("text"), undefined);
    assert.equal(writeLocalStorageBool("bool", true), true);
    assert.equal(readLocalStorageBool("bool", false), true);
    assert.equal(writeLocalStorageBool("bool", false), true);
    assert.equal(readLocalStorageBool("bool", true), false);
    values.set("bool", "TRUE");
    assert.equal(readLocalStorageBool("bool", true), true);
    assert.equal(readLocalStorageBool("bool", false), false);
    assert.equal(writeLocalStorageJson("json", { enabled: true, count: 2 }), true);
    assert.deepEqual(readLocalStorageJson("json"), { enabled: true, count: 2 });
    values.set("json", "{");
    assert.equal(readLocalStorageJson("json"), undefined);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    assert.equal(writeLocalStorageJson("cyclic", cyclic), false);

    const blocked = () => { throw new Error("blocked method"); };
    setWindow({ localStorage: { ...storage, getItem: blocked } });
    assert.equal(readLocalStorageItem("key"), undefined);
    assert.equal(readLocalStorageBool("key", true), true);
    assert.equal(readLocalStorageJson("key"), undefined);
    setWindow({ localStorage: { ...storage, setItem: blocked } });
    assert.equal(writeLocalStorageItem("key", "value"), false);
    assert.equal(writeLocalStorageBool("key", true), false);
    assert.equal(writeLocalStorageJson("key", {}), false);
    setWindow({ localStorage: { ...storage, removeItem: blocked } });
    assert.doesNotThrow(() => removeLocalStorageItem("key"));

    setWindow({ get localStorage() { throw new DOMException("storage denied", "SecurityError"); } });
    // Causal target: this assertion must be reached after all controls above.
    assert.doesNotThrow(() => {
        assert.equal(readLocalStorageItem("getter-denied"), undefined);
    }, "throwing storage getter must return the read default without throwing");

    // These assertions are reached only after the causal target passes.
    assert.equal(canUseLocalStorage(), false);
    assert.equal(readLocalStorageBool("key", true), true);
    assert.equal(readLocalStorageJson("key"), undefined);
    assert.equal(writeLocalStorageItem("key", "value"), false);
    assert.equal(writeLocalStorageBool("key", true), false);
    assert.equal(writeLocalStorageJson("key", {}), false);
    assert.doesNotThrow(() => removeLocalStorageItem("key"));
    resetClientPreferencesCache();
    assert.equal(loadClientPreferences().titleMusicDisabled, false);
    assert.equal(loadClientPreferences().iosInstallHintDismissed, false);
    assert.equal(updateClientPreferences({ iosInstallHintDismissed: true }).iosInstallHintDismissed, true);
    assert.equal(loadClientPreferences().iosInstallHintDismissed, true);
} finally {
    resetClientPreferencesCache();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
}

console.log("local-storage: ok");
