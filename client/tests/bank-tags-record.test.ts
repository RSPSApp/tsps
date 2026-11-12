// Exercises the real rename callback and tab records with in-memory configuration.
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


function boundaryCase(newName: string, collision = false) {
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
    const unaffected = tabs.load("other");
    tabs.add(original);
    tabs.add(unaffected);
    const existing = collision ? tabs.load("work") : undefined;
    if (existing) tabs.add(existing);
    tabs.save();
    const initialRecords = [...records.entries()];
    let done: ((value: string) => void) | undefined;
    let validator: ((c: number) => boolean) | undefined;
    let prompt: string | undefined;
    const options: Array<{ label: string; action: () => void }> = [];
    const chatbox = {
        openTextInput: () => {
            const builder = {
                addCharValidator: (f: (c: number) => boolean) => ((validator = f), builder),
                onDone: (f: (value: string) => void) => ((done = f), builder),
                build: () => builder,
            };
            return builder;
        },
        openTextMenuInput: (message: string) => {
            prompt = message;
            const builder = {
                option: (label: string, action: () => void) => (options.push({ label, action }), builder),
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
    (subject as unknown as { renameTab(name: string): void }).renameTab("old");
    assert.ok(done && validator);
    assert.ok([...newName].every((c) => validator!(c.charCodeAt(0))));
    done(newName);
    return { records, initialRecords, tabs, original, unaffected, existing, prompt, options };
}

for (const name of ["OLD", "", "   "]) {
    const result = boundaryCase(name);
    assert.equal(result.tabs.find("old"), result.original, `${JSON.stringify(name)} keeps original identity`);
    assert.deepEqual(result.tabs.tabs, [result.original, result.unaffected]);
    assert.deepEqual(result.tabs.loadAllTabNames(), ["old", "other"]);
    assert.deepEqual([...result.records.entries()], result.initialRecords);
    assert.equal(result.prompt, undefined);
}

const trimmed = boundaryCase("  Work  ");
assert.equal(trimmed.tabs.find("work"), trimmed.original);
assert.deepEqual(trimmed.tabs.tabs, [trimmed.unaffected, trimmed.original]);
assert.deepEqual(trimmed.tabs.loadAllTabNames(), ["other", "work"]);
const trimmedNames = trimmed.tabs.loadAllTabNames();
trimmed.tabs.clear();
for (const name of trimmedNames) trimmed.tabs.add(trimmed.tabs.load(name));
assert.deepEqual(trimmed.tabs.tabs.map((tab) => tab.tag), ["other", "work"]);
assert.equal(trimmed.tabs.find("  Work  ")?.tag, "work");

const collision = boundaryCase("Work", true);
assert.equal(collision.prompt, "The specified bank tag already exists.");
assert.deepEqual(collision.tabs.tabs, [collision.original, collision.unaffected, collision.existing]);
assert.deepEqual(collision.tabs.loadAllTabNames(), ["old", "other", "work"]);
assert.match(collision.options[0].label, /Merge into existing tag/);
collision.options[0].action();
assert.equal(collision.tabs.find("work"), collision.existing);
assert.equal(collision.tabs.find("old"), undefined);
assert.deepEqual(collision.tabs.tabs, [collision.unaffected, collision.existing]);
assert.deepEqual(collision.tabs.loadAllTabNames(), ["other", "work"]);
