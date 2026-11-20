import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import test from "node:test";

const workflow = readFileSync(new URL("../../workflows/client-release.yml", import.meta.url), "utf8");

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
