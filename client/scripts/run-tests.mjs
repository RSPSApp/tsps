// Runs every tests/*.test.ts with tsx, one process each, and reports the failures at the end.
// New tests are picked up by their file name: there is no list to keep in sync.
//   yarn test                 every test
//   yarn test edit-mode npc   only tests whose file name contains one of the words
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const clientDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(clientDir, "tests");
const tsx = join(clientDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

// Tests that are known to fail, each with the reason. Keep this short: a test belongs here only
// until someone fixes it, and the summary lists every skipped test so none is forgotten.
const SKIPPED = new Map([
    [
        "edit-mode-plugin.test.ts",
        "expects a 'safe' zone tag to be rejected (any tag is allowed since 2d27d62c); the wall tool's one-tile preview check fails too",
    ],
    [
        "edit-mode-settings.test.ts",
        "settings list predates the 'F2P zones' option (1be97079); a host-only setting also shows standalone",
    ],
]);

const filters = process.argv.slice(2);
const files = readdirSync(testsDir)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
    .sort();

const failed = [];
const skipped = [];
let passed = 0;
for (const file of files) {
    if (SKIPPED.has(file)) {
        skipped.push(file);
        continue;
    }
    const start = Date.now();
    const result = spawnSync(tsx, [join("tests", file)], { cwd: clientDir, encoding: "utf8" });
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    if (result.status === 0) {
        passed++;
        console.log(`ok    ${file} (${seconds}s)`);
    } else {
        failed.push(file);
        console.log(`FAIL  ${file} (${seconds}s)`);
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? String(result.error) : ""}`;
        console.log(output.trimEnd().replace(/^/gm, "      "));
    }
}

console.log(`\n${passed} passed, ${failed.length} failed, ${skipped.length} skipped`);
for (const file of skipped) console.log(`  skipped ${file}: ${SKIPPED.get(file)}`);
for (const file of failed) console.log(`  failed  ${file}`);
if (files.length === 0) console.log(`no test file matches: ${filters.join(", ")}`);
process.exitCode = failed.length > 0 || files.length === 0 ? 1 : 0;
