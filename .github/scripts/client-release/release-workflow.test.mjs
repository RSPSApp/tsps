import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflow = readFileSync(new URL("../../workflows/client-release.yml", import.meta.url), "utf8");
const root = fileURLToPath(new URL("../../../", import.meta.url));

// Read this workflow's quoted path-list form without adding a YAML runtime dependency.
function eventPaths(event) {
    const block = workflow.match(new RegExp(`^    ${event}:\\r?\\n([\\s\\S]*?)(?=^    \\w|^\\S|$(?![\\s\\S]))`, "m"))?.[1];
    assert.ok(block, `${event} event is present`);
    assert.match(block, /^        branches: \[main\]$/m);
    const paths = [...block.matchAll(/^            - '([^']+)'\r?$/gm)].map((match) => match[1]);
    assert.ok(paths.length, `${event} has a nonempty path filter`);
    return paths;
}

test("both release events include shared client inputs and interface generator dependencies", () => {
    const inputs = [
        "client/game/movement/ContinuousMovement.ts",
        "server/plugins/world/ContinuousMotion.FreeMovement.js",
        "server/plugins/items/BlightedItems.js",
        "server/plugins/items/data/food.json",
        "server/scripts/browser-host-interface-definitions.ts",
        "server/plugins/agent/mcp/DiagonalWall.AgentMcp.js",
        "server/plugins/interface/bestiary/Layout.Bestiary.js",
        "server/plugins/interface/bestiary/MapNavigation.Bestiary.js",
        "server/plugins/interface/monsterexamine/Layout.MonsterExamine.js",
        "server/plugins/interface/teleportinterface/Layout.TeleportInterface.js",
        "server/plugins/interface/widgetGroup.js",
        "server/src/main/typescript/elvarg/game/content/combat/CombatType.ts",
        "server/package.json",
        "server/yarn.lock",
        "server/target.txt",
        "scripts/run-with-env.mjs",
        ".github/scripts/client-release/release-workflow.test.mjs",
    ];
    for (const event of ["push", "pull_request"]) {
        const paths = eventPaths(event);
        for (const input of inputs) {
            assert.ok(paths.some((pattern) => posix.matchesGlob(input, pattern)), `${event} skips ${input}`);
        }
        assert.equal(paths.some((pattern) => posix.matchesGlob("docs/index.md", pattern)), false,
            `${event} should retain the unrelated-documentation exclusion`);
    }
});

test("unrelated server-only changes do not build or publish a client release", () => {
    const unrelated = [
        "server/plugins/quests/inaid/Escort.InAidOfTheMyreque.js",
        "server/plugins/quests/hallowvale/Hassle.DarknessOfHallowvale.js",
        "server/plugins/modes/pvp/Presets.PvpMode.js",
        "server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerSave.ts",
        "server/tests/player-save.test.cjs",
        "server/docs/agents/interfaces.md",
        "server/AGENTS.md",
    ];
    for (const event of ["push", "pull_request"]) {
        for (const input of unrelated) {
            assert.equal(eventPaths(event).some((pattern) => posix.matchesGlob(input, pattern)), false,
                `${event} unnecessarily releases for ${input}`);
        }
    }
});

// Observe what the real definition exporter loads, rather than following lazy game-only
// requires in its plugins (which would incorrectly make almost the whole server an input).
test("all actual shared modules and generated-interface inputs remain watched", (t) => {
    const shared = new Set();
    function scanClient(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (!["node_modules", "build", "public", "tests", "scripts", ".cache"].includes(entry.name)) scanClient(join(dir, entry.name));
                continue;
            }
            if (!/\.[jt]sx?$/.test(entry.name)) continue;
            const file = join(dir, entry.name);
            const source = readFileSync(file, "utf8");
            for (const match of source.matchAll(/(?:from\s+|require\(\s*|import\(\s*)["'](\.[^"']+)["']/g)) {
                const input = relative(root, resolve(dirname(file), match[1])).split(sep).join("/");
                if (input.startsWith("server/")) shared.add(input);
            }
        }
    }
    scanClient(join(root, "client"));
    assert.ok(shared.has("server/plugins/world/ContinuousMotion.FreeMovement.js"), "discover the actual shared movement import");
    assert.ok(shared.has("server/plugins/items/BlightedItems.js"), "discover the actual shared item import");
    // Webpack includes shared-module dependencies even when a require is inside a
    // function; unlike generator-only imports, these must also be followed statically.
    for (const input of shared) {
        if (!/\.[jt]sx?$/.test(input)) continue;
        const file = join(root, input);
        for (const match of readFileSync(file, "utf8").matchAll(/(?:from\s+|require\(\s*|import\(\s*)["'](\.[^"']+)["']/g)) {
            const stem = resolve(dirname(file), match[1]);
            const candidates = [stem, `${stem}.js`, `${stem}.ts`, `${stem}.json`, join(stem, "index.js"), join(stem, "index.ts")];
            const dependency = candidates.find((candidate) => {
                try { return statSync(candidate).isFile(); } catch { return false; }
            });
            assert.ok(dependency, `resolve shared-module dependency ${match[1]} in ${input}`);
            const path = relative(root, dependency).split(sep).join("/");
            if (path.startsWith("server/")) shared.add(path);
        }
    }
    const temporary = mkdtempSync(join(tmpdir(), "client-release-inputs-"));
    try {
        const observed = join(temporary, "inputs.jsonl");
        const preload = join(temporary, "trace.cjs");
        writeFileSync(preload, `
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const inputs = new Set(), root = process.env.RELEASE_INPUT_ROOT;
function record(file) {
    if (typeof file !== "string" || !path.isAbsolute(file)) return;
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (rel.startsWith("server/") && !rel.includes("/node_modules/") && !rel.startsWith("server/caches/")) inputs.add(rel);
}
const load = Module._load;
Module._load = function(request, parent, main) {
    const result = load.apply(this, arguments);
    try { record(Module._resolveFilename(request, parent, main)); } catch {}
    return result;
};
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) { const result = read.call(this, file, ...args); record(typeof file === "string" ? path.resolve(file) : file); return result; };
process.on("exit", () => fs.appendFileSync(process.env.RELEASE_INPUT_TRACE, JSON.stringify([...inputs]) + "\\n"));
`);
        const runner = join(temporary, "export.ts");
        writeFileSync(runner, `
for (const input of JSON.parse(process.env.RELEASE_SHARED_INPUTS)) require(process.env.RELEASE_INPUT_ROOT + "/" + input);
require(process.env.RELEASE_INPUT_ROOT + "/server/scripts/browser-host-interface-definitions.ts");
`);
        const run = spawnSync(process.execPath, [join(root, "client/node_modules/tsx/dist/cli.mjs"), runner], {
            cwd: join(root, "server"), encoding: "utf8", timeout: 30000,
            env: {
                ...process.env, BROWSER_HOST: "1", DISABLE_PLAYER_BOTS: "1",
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`,
                RELEASE_INPUT_ROOT: root.replace(/[\\/]$/, ""), RELEASE_INPUT_TRACE: observed,
                RELEASE_SHARED_INPUTS: JSON.stringify([...shared]),
            },
        });
        assert.ifError(run.error);
        assert.equal(run.status, 0, run.stderr);
        const definitions = JSON.parse(run.stdout);
        assert.ok(Array.isArray(definitions) && definitions.length > 0 && definitions.every((definition) =>
            Number.isInteger(definition.groupId) && Array.isArray(definition.widgets) && definition.widgets.length > 0),
            "execute the actual interface export");
        const inputs = new Set([...shared, "server/scripts/browser-host-interface-definitions.ts"]);
        for (const line of readFileSync(observed, "utf8").trim().split(/\r?\n/)) {
            for (const input of JSON.parse(line)) inputs.add(input);
        }
        assert.ok(inputs.has("server/plugins/interface/SideJournalDefaults.plugin.js"), "observe the real dynamic plugin list");
        assert.ok(inputs.has("server/plugins/interface/widgetGroup.js"), "observe shared generator helpers");
        assert.equal(inputs.has("server/src/main/typescript/elvarg/game/entity/impl/player/persistence/PlayerSave.ts"), false,
            "lazy gameplay-only imports are not generator inputs");
        for (const event of ["push", "pull_request"]) {
            const paths = eventPaths(event);
            for (const input of inputs) assert.ok(paths.some((pattern) => posix.matchesGlob(input, pattern)), `${event} skips actual build input ${input}`);
        }
        t.diagnostic(`Observed ${inputs.size} shared/generator inputs: ${[...inputs].sort().join(", ")}`);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
});
