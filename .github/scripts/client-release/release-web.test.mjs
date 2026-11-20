import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageWebRelease } from "./release-web.mjs";

test("shared releases contain game files and omit installed profile, launcher and cache assets", () => {
    const root = mkdtempSync(join(tmpdir(), "rsps-web-release-"));
    try {
        const dist = join(root, "build"), out = join(root, "release");
        mkdirSync(join(dist, "static"), { recursive: true });
        mkdirSync(join(dist, "caches"));
        writeFileSync(join(dist, "index.html"), "<html>Shared client</html>");
        writeFileSync(join(dist, "static/game.js"), "console.log('client');");
        writeFileSync(join(dist, "caches/caches.json"), JSON.stringify([{ name: "osrs-test", revision: 242 }]));
        writeFileSync(join(dist, "caches/big.dat"), "installed game cache");
        writeFileSync(join(dist, "desktop-startup.html"), "owner branding");
        writeFileSync(join(dist, "desktop-icon.png"), "owner icon");
        const release = packageWebRelease(dist, out, "0.1.2", "https://github.com/RSPSApp/tsps/releases/download/client-v0.1.2/");
        const entries = spawnSync("tar", ["-tzf", release.archive], { encoding: "utf8" });
        assert.equal(entries.status, 0);
        assert.match(entries.stdout, /static\/game.js/);
        assert.match(entries.stdout, /caches\/caches.json/);
        assert.doesNotMatch(entries.stdout, /big.dat|desktop-startup|desktop-icon/);
        const metadata = spawnSync("tar", ["-xOzf", release.archive, "caches/caches.json"], { encoding: "utf8" });
        assert.equal(JSON.parse(metadata.stdout)[0].name, "osrs-test");
        const bytes = readFileSync(release.archive);
        assert.equal(release.manifest.archive.sha256, createHash("sha256").update(bytes).digest("hex"));
        assert.equal(release.manifest.archive.size, bytes.length);
        assert.equal(release.manifest.archive.url, "https://github.com/RSPSApp/tsps/releases/download/client-v0.1.2/client-0.1.2.tar.gz");
        assert.throws(() => packageWebRelease(dist, out, "../bad", "https://example.com/"), /stable client version/);
        assert.throws(() => packageWebRelease(dist, out, "0.1.2", "http://example.com/"), /HTTPS/);
        assert.throws(() => packageWebRelease(dist, join(dist, "release"), "0.1.2", "https://example.com/"), /outside/);
        symlinkSync(join(root, "secret"), join(dist, "static/link"));
        assert.throws(() => packageWebRelease(dist, out, "0.1.2", "https://example.com/"), /links or special files/);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
