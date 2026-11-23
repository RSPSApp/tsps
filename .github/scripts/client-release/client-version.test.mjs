import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("client version works without git, selects the same files, and skips dependencies and build output", () => {
    const root = mkdtempSync(join(tmpdir(), "client-version-"));
    const write = (path, text) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    try {
        write(".github/workflows/client-release.yml", "on:\n    push:\n        paths:\n            - 'client/**'\n            - 'server/tsconfig*.json'\n            - 'server/.yarn/**'\n            - 'scripts/client-version.mjs'\n    pull_request:\n");
        write("client/game.ts", "first\n");
        write("client/deep/more.ts", "deep\n");
        write("server/tsconfig.json", "{}\n");
        write("server/tsconfig.build.json", "{}\n");
        write("server/.yarn/releases/yarn.cjs", "yarn\n");
        write("scripts/client-version.mjs", "script\n");
        // A zip download has no .git: this is the exact situation of a fresh Quick start.
        const withoutGit = clientVersion(root);
        assert.match(withoutGit, /^[a-f0-9]{64}$/);
        write("server/other.json", "{}");
        write("client/node_modules/dep/index.js", "dependency");
        write("client/build/main.js", "output");
        write("client/public/browser-host/interfaces/1.json", "generated");
        assert.equal(clientVersion(root), withoutGit, "dependencies, build output and non-listed files are ignored");
        write("client/deep/more.ts", "changed\n");
        assert.notEqual(clientVersion(root), withoutGit, "listed files still change the version");
        write("client/deep/more.ts", "deep\n");
        write("server/tsconfig.build.json", "{ }\n");
        assert.notEqual(clientVersion(root), withoutGit, "glob-listed files are included");
        write("server/tsconfig.build.json", "{}\n");
        assert.equal(clientVersion(root), withoutGit);
        // A clone ignores the same paths through the repository's .gitignore and must give the same identifier.
        write(".gitignore", "node_modules\nbuild\n/client/public/browser-host/interfaces/\n");
        execFileSync("git", ["init", "--quiet", root]);
        assert.equal(clientVersion(root), withoutGit, "git and the file walk agree");
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test("client version thoroughly verifies issue #153 OSRS minigames and activities paths and gaps", () => {
    const root = mkdtempSync(join(tmpdir(), "client-version-"));
    const write = (path, text) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    };
    try {
        write(".github/workflows/client-release.yml", "on:\n    push:\n        paths:\n            - 'client/**'\n            - 'server/plugins/minigames/**'\n    pull_request:\n");
        write("client/game.ts", "base\n");
        write("server/plugins/minigames/troublebrewing/Game.TroubleBrewing.js", "trouble brewing\n");
        
        const baseVersion = clientVersion(root);
        assert.match(baseVersion, /^[a-f0-9]{64}$/);

        // Verify changes in OSRS minigames/activities affect client version
        write("server/plugins/minigames/troublebrewing/Game.TroubleBrewing.js", "trouble brewing updated\n");
        const updatedVersion = clientVersion(root);
        assert.notEqual(baseVersion, updatedVersion, "minigame plugin source updates change version");

        // Verify server-only changes outside minigames paths do not affect version when restricted
        write("server/plugins/minigames/troublebrewing/Game.TroubleBrewing.js", "trouble brewing\n");
        assert.equal(clientVersion(root), baseVersion, "reverting minigame plugin source restores base version");
    } finally { rmSync(root, { recursive: true, force: true }); }
});