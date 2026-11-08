// Staged proposal: intended path client/tests/bank-tags-record.test.ts.
// Execute only through the separately reviewed, fail-closed import adapter.
import assert from "node:assert/strict";
import { TagManager } from "../game/plugins/banktags/TagManager";
import { TabManager } from "../game/plugins/banktags/tabs/TabManager";
import { TabInterface } from "../game/plugins/banktags/tabs/TabInterface";

function renameCase(newName: string) {
    const records = new Map<string, string>();
    const config = {
        getConfiguration: (group: string, key: string) => records.get(`${group}.${key}`),
        setConfiguration: (group: string, key: string, value: unknown) => records.set(`${group}.${key}`, String(value)),
        unsetConfiguration: (group: string, key: string) => records.delete(`${group}.${key}`),
        getConfigurationKeys: (prefix: string) => [...records.keys()].filter((key) => key.startsWith(prefix)),
    };
    const tags = new TagManager(config as any, (id) => id);
    const tabs = new TabManager(config as any);
    const original = tabs.load("old");
    tabs.add(original);
    tabs.save();
    let done: ((value: string) => void) | undefined;
    let validator: ((c: number) => boolean) | undefined;
    const chatbox = {
        openTextInput: () => {
            const builder = {
                addCharValidator: (f: (c: number) => boolean) => ((validator = f), builder),
                onDone: (f: (value: string) => void) => ((done = f), builder),
                build: () => builder,
            };
            return builder;
        },
    };
    const layouts = { loadLayout: () => null, removeLayout: () => {} };
    const subject = new TabInterface(
        {} as any, {} as any, {} as any, tags, tabs, layouts as any,
        chatbox as any, {} as any, {} as any, {} as any,
    );
    // Invoke the actual private method; the captured function is its actual onDone callback.
    (subject as unknown as { renameTab(name: string): void }).renameTab("old");
    assert.ok(done && validator);
    assert.ok([...newName].every((c) => validator!(c.charCodeAt(0))), "name accepted by actual validator");
    done(newName);
    const beforeReload = tabs.find(newName);
    const savedNames = tabs.loadAllTabNames();
    tabs.clear();
    for (const name of savedNames) tabs.add(tabs.load(name));
    const afterReload = tabs.find(newName);
    return { original, beforeReload, afterReload, savedNames };
}

const lower = renameCase("work");
assert.equal(lower.beforeReload, lower.original, "lowercase rename remains findable");
assert.ok(lower.afterReload, "lowercase rename remains findable after reload");
assert.deepEqual(lower.savedNames, ["work"]);

const mixed = renameCase("Work");
assert.ok(mixed.afterReload, "mixed-case rename is findable after reload");
assert.equal(mixed.beforeReload, mixed.original, "mixed-case rename is immediately findable by the same normalized identity");
