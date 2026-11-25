import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorMapFiles } from "../game/plugins/editmode/EditorMapFiles";

class Directory {
    readonly kind = "directory";
    readonly entries = new Map<string, Directory | File>();

    constructor(readonly name: string) {}

    async getDirectoryHandle(name: string, { create = false } = {}) {
        const existing = this.entries.get(name);
        if (existing instanceof Directory) return existing;
        if (!create) throw new DOMException("Directory missing", "NotFoundError");
        const dir = new Directory(name);
        this.entries.set(name, dir);
        return dir;
    }

    async getFileHandle(name: string, { create = false } = {}) {
        if (!this.entries.has(name)) {
            if (!create) throw new DOMException("File missing", "NotFoundError");
            this.entries.set(name, new File([], name));
        }
        return {
            getFile: async () => this.entries.get(name) as File,
            createWritable: async () => {
                let data: Blob;
                return {
                    write: async (next: Blob) => { data = next; },
                    close: async () => { this.entries.set(name, new File([data], name)); },
                    abort: async () => {},
                };
            },
        };
    }

    async removeEntry(name: string) {
        if (!this.entries.delete(name)) throw new DOMException("File missing", "NotFoundError");
    }

    async *values() {
        for (const [name, entry] of this.entries) {
            if (entry instanceof Directory) yield entry;
            else yield { kind: "file", name, getFile: () => entry };
        }
    }
}

test("folder saves keep previous and original files and refuse a concurrent edit", async () => {
    const data = new Directory("data");
    const definitions = await data.getDirectoryHandle("definitions", { create: true });
    definitions.entries.set("world.json", new File(["{}"], "world.json"));
    definitions.entries.set("object-spawns.json", new File(["[]"], "object-spawns.json"));
    const path = "definitions/map-warps.json";
    const name = "map-warps.json";
    definitions.entries.set(name, new File(["[1]"], name));
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { showDirectoryPicker: async () => data } });
    try {
        const editor = await EditorMapFiles.open();
        const id = await editor.save(new Map([[path, new Blob(["[2]"])]]));
        assert.equal(await (definitions.entries.get(name) as File).text(), "[1]", "saving leaves the base file intact");
        const layerRoot = await data.getDirectoryHandle("map-edits");
        const layer = await layerRoot.getDirectoryHandle(id);
        const edited = await layer.getDirectoryHandle("definitions");
        assert.equal(await (edited.entries.get(name) as File).text(), "[2]");
        const concurrent = await EditorMapFiles.open();
        await concurrent.checkLoadedDefinition(name, "[2]");
        assert.deepEqual(await editor.listBackups(), [id]);
        assert.deepEqual(await editor.listOriginals(), [path]);
        await editor.restore(id);
        await editor.checkLoadedDefinition(name, "[1]");
        assert.equal(await (edited.entries.get(name) as File).text(), "[2]", "restoring leaves the edited layer intact");
        await editor.save(new Map([[path, new Blob(["[7]"])]]));
        await editor.restoreOriginal(path);
        assert.equal(await (definitions.entries.get(name) as File).text(), "[1]");
        await editor.checkLoadedDefinition(name, "[1]");
        await assert.rejects(concurrent.save(new Map([[path, new Blob(["[4]"])]])), /changed on disk/);
        assert.equal(await (definitions.entries.get(name) as File).text(), "[1]");
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});

test("a new map square never replaces a saved square and can be restored to absent", async () => {
    const data = new Directory("data");
    const definitions = await data.getDirectoryHandle("definitions", { create: true });
    definitions.entries.set("world.json", new File(["{}"], "world.json"));
    definitions.entries.set("object-spawns.json", new File(["[]"], "object-spawns.json"));
    const regions = await data.getDirectoryHandle("regions", { create: true });
    regions.entries.set("12850.pack", new File(["existing"], "12850.pack"));
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { showDirectoryPicker: async () => data } });
    try {
        const editor = await EditorMapFiles.open();
        const existing = "regions/12850.pack";
        const draft = "regions/19765.pack";
        await assert.rejects(editor.save(new Map([[existing, new Blob(["collision"])]]), new Set([existing])), /already exists/);
        const files = new Map([[existing, new Blob(["edited"])], [draft, new Blob(["new terrain"])]]);
        const backup = await editor.save(files, new Set([draft]));
        const layerRoot = await data.getDirectoryHandle("map-edits");
        const layer = await layerRoot.getDirectoryHandle(backup);
        const changed = await layer.getDirectoryHandle("regions");
        assert.equal(await (changed.entries.get("12850.pack") as File).text(), "edited");
        assert.equal(await (changed.entries.get("19765.pack") as File).text(), "new terrain");
        const reopened = await EditorMapFiles.open();
        await assert.rejects(reopened.save(new Map([[draft, new Blob(["duplicate"])]]), new Set([draft])), /already exists/);
        await editor.restore(backup);
        assert.equal(await (regions.entries.get("12850.pack") as File).text(), "existing");
        assert.equal(regions.entries.has("19765.pack"), false);
        const restored = await EditorMapFiles.open();
        await restored.save(new Map([[draft, new Blob(["usable again"])]]), new Set([draft]));
        assert.equal(await (changed.entries.get("19765.pack") as File).text(), "new terrain");
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
});
