import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { catalog, preview } from "../game/plugins/editmode/generation/buildings/MapPlans";
import { parseAreaStamp } from "../game/plugins/editmode/AreaStamp";

test("every built-in structure generates deterministically with networking unavailable", () => {
    const fetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Generation must not contact a server"); };
    try {
        const definitions = catalog();
        const dimensions = () => ({ sizeX: 1, sizeY: 1 });
        for (const recipe of definitions.generators) {
            const query = new URLSearchParams({ name: recipe.name, seed: "17", width: String(recipe.minSize), height: String(recipe.minSize) });
            const plan = preview(query, dimensions);
            assert.deepEqual(preview(query, dimensions), plan, `${recipe.name} retains its repeatable seed`);
            assert.ok(parseAreaStamp(plan).objects.length > 0, `${recipe.name} can be placed by the editor`);
        }
        for (const preset of definitions.presets) {
            assert.ok(parseAreaStamp(preview(new URLSearchParams({ name: preset.name }), dimensions)).objects.length > 0);
        }
        const query = new URLSearchParams({ name: "house" });
        const small = parseAreaStamp(preview(query, dimensions));
        const large = parseAreaStamp(preview(query, () => ({ sizeX: 4, sizeY: 3 })));
        assert.ok(large.width > small.width && large.height > small.height, "current object definitions determine the placed footprint");
    } finally {
        globalThis.fetch = fetch;
    }
});

test("editor generation sources have no server-source imports or generation HTTP dependency", () => {
    const editor = path.resolve(__dirname, "../game/plugins/editmode");
    const visit = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? visit(file) : /\.[cm]?[jt]s$/.test(file) ? [file] : [];
    });
    for (const file of visit(editor)) {
        const source = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const match of source.matchAll(/(?:from\s+|require\(\s*|import\(\s*)["']([^"']+)["']/g)) {
            const dependency = match[1];
            assert.ok(!/^(?:node:|fs$|path$|zlib$)/.test(dependency), `${file} imports a Node-only dependency ${dependency}`);
            if (dependency.startsWith(".")) {
                assert.ok(!path.resolve(path.dirname(file), dependency).includes(`${path.sep}server${path.sep}`), `${file} reaches into server source`);
            }
        }
    }
    for (const file of ["install.ts", "EditorLandscape.ts"]) {
        const source = fs.readFileSync(path.join(editor, file), "utf8");
        assert.doesNotMatch(source, /\/api\/world\/(?:map-plans|landscapes|templates)/, `${file} uses a generation endpoint`);
        assert.doesNotMatch(source, /loadLocalEditorData\(["'`](?:map-plans|templates)/, `${file} loads generator data from the server`);
    }
});
