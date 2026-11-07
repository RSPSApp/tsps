const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");

const copyDeps = fs.readFileSync(path.join(__dirname, "wt"), "utf8")
    .match(/^copy_deps\(\) \{[\s\S]*?^\}/m)[0];

test("dependency copies omit only source-root self-links", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wt-copy-"));
    try {
        const main = path.join(fixture, "main");
        const destination = path.join(fixture, "worktree");
        const foreign = path.join(fixture, "foreign");
        fs.mkdirSync(foreign);
        for (const sub of ["node_modules", "server/node_modules", "client/node_modules", "server/caches"]) {
            const source = path.join(main, sub);
            fs.mkdirSync(path.join(source, "package/node_modules/nested"), { recursive: true });
            fs.mkdirSync(path.dirname(path.join(destination, sub)), { recursive: true });
            fs.writeFileSync(path.join(source, "package/node_modules/nested/value"), "kept");
            fs.symlinkSync(foreign, path.join(source, "foreign"), "dir");
            fs.symlinkSync(sub === "client/node_modules" ? "." : source, path.join(source, "node_modules"), "dir");
        }
        execFileSync("bash", ["-c", 'set -euo pipefail; MAIN=$1; ' + copyDeps + '; copy_deps "$2"', "-", main, destination]);
        for (const sub of ["node_modules", "server/node_modules", "client/node_modules", "server/caches"]) {
            const copied = path.join(destination, sub);
            assert.equal(fs.readFileSync(path.join(copied, "package/node_modules/nested/value"), "utf8"), "kept");
            assert.equal(fs.readlinkSync(path.join(copied, "foreign")), foreign);
            assert.equal(fs.existsSync(path.join(copied, "node_modules")), sub === "server/caches");
        }
        // An existing dependency tree belongs to its current owner and is never sanitized.
        fs.symlinkSync(main + "/client/node_modules", destination + "/client/node_modules/node_modules", "dir");
        execFileSync("bash", ["-c", 'set -euo pipefail; MAIN=$1; ' + copyDeps + '; copy_deps "$2"', "-", main, destination]);
        assert.equal(fs.readlinkSync(destination + "/client/node_modules/node_modules"), main + "/client/node_modules");
        // A dependency-root link to another directory is legitimate and must survive.
        const clean = path.join(fixture, "clean");
        fs.mkdirSync(path.join(clean, "node_modules"), { recursive: true });
        fs.symlinkSync(foreign, path.join(clean, "node_modules/node_modules"), "dir");
        const cleanCopy = path.join(fixture, "clean-copy");
        fs.mkdirSync(cleanCopy);
        execFileSync("bash", ["-c", 'set -euo pipefail; MAIN=$1; ' + copyDeps + '; copy_deps "$2"', "-", clean, cleanCopy]);
        assert.equal(fs.readlinkSync(path.join(cleanCopy, "node_modules/node_modules")), foreign);
        // A linked dependency root is shared, so never unlink anything through it.
        const linked = path.join(fixture, "linked");
        const linkedCopy = path.join(fixture, "linked-copy");
        fs.mkdirSync(linked);
        fs.mkdirSync(linkedCopy);
        fs.symlinkSync(main + "/node_modules", linked + "/node_modules", "dir");
        execFileSync("bash", ["-c", 'set -euo pipefail; MAIN=$1; ' + copyDeps + '; copy_deps "$2"', "-", linked, linkedCopy]);
        assert.equal(fs.readlinkSync(linkedCopy + "/node_modules"), main + "/node_modules");
        assert.equal(fs.readlinkSync(main + "/node_modules/node_modules"), main + "/node_modules");

    } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
    }
});
