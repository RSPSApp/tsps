import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Webpack resolves `import "./Foo"` to Foo.js before Foo.ts, while the tests (tsx) and the server
// use the .ts. A .js left beside a .ts is therefore what the browser runs, untested: after cache
// 242, readSignedMedium() went into rs/io/ByteBuffer.ts only, the browser's ByteBuffer.js lacked
// it, and every multiloc stopped drawing (#4007).

const clientDir = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "build", "public"]);

function shadowedPairs(dir: string, found: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                shadowedPairs(join(dir, entry.name), found);
            }
            continue;
        }
        const match = /^(.*)\.(js|jsx)$/.exec(entry.name);
        if (!match) continue;
        for (const ext of ["ts", "tsx"]) {
            if (names.has(`${match[1]}.${ext}`)) {
                found.push(`${relative(clientDir, join(dir, entry.name))} shadows ${match[1]}.${ext}`);
            }
        }
    }
}

test("no .js or .jsx sits beside a .ts or .tsx of the same name", () => {
    const found: string[] = [];
    shadowedPairs(clientDir, found);
    assert.deepEqual(
        found,
        [],
        "webpack bundles these .js files instead of the .ts the tests check; delete the .js:\n" +
            found.join("\n"),
    );
});
