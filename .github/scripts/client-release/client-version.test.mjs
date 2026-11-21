import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clientVersion } from "../../../scripts/client-version.mjs";

test("client version is deterministic, ignores server-only changes, and changes with release inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "client-version-"));
    try {
        execFileSync("git", ["init", "--quiet", root]);
        mkdirSync(join(root, ".github/workflows"), { recursive: true });
        mkdirSync(join(root, "client"));
        writeFileSync(join(root, ".github/workflows/client-release.yml"), "on:\n    push:\n        paths:\n            - 'client/**'\n    pull_request:\n");
        writeFileSync(join(root, "client/game.ts"), "first\n");
        const first = clientVersion(root);
        writeFileSync(join(root, "client/game.ts"), "first\r\n");
        assert.equal(clientVersion(root), first, "Windows line endings do not change compatibility");
        assert.match(first, /^[a-f0-9]{64}$/);
        assert.equal(clientVersion(root), first);
        writeFileSync(join(root, "server-only.txt"), "changed");
        assert.equal(clientVersion(root), first);
        writeFileSync(join(root, "client/game.ts"), "second");
        assert.notEqual(clientVersion(root), first);
        writeFileSync(join(root, "client/game.ts"), "first\n");
        assert.equal(clientVersion(root), first, "rolling back the source selects the same immutable client");
    } finally { rmSync(root, { recursive: true, force: true }); }
});
