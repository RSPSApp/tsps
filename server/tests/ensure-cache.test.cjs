const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const AdmZip = require("adm-zip");

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../scripts/ensure-cache.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const target = "osrs-241_2026-10-20";
const oldTarget = "osrs-241_2026-09-30";
const entry = { id: 1, scope: "runescape", game: "oldschool", environment: "live", language: "en",
    builds: [{ major: 241 }], timestamp: "2026-10-20T09:00:00Z", size: 100 };

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ensure-cache-test-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, "caches"));
    fs.mkdirSync(path.join(root, "public"));
    fs.writeFileSync(path.join(root, "target.txt"), target);
    return root;
}

function cached(directory, name = target) {
    const destination = path.join(directory, name);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["main_file_cache.dat2", "main_file_cache.idx255", "main_file_cache.idx0"]) {
        fs.writeFileSync(path.join(destination, file), "cache bytes");
    }
    fs.writeFileSync(path.join(destination, "keys.json"), "{}");
    fs.writeFileSync(path.join(destination, "info.json"), JSON.stringify(entry));
}

function manifest(directory, name) {
    fs.writeFileSync(path.join(directory, "caches.json"), JSON.stringify([{ name }]));
}

function run(root, fetch = () => { throw new Error("Unexpected network request"); }, fsOverride = fs) {
    return new Promise((resolve) => {
        vm.runInNewContext(source, {
            require: (id) => id === "node:fs" ? fsOverride : require(id),
            __dirname: path.join(root, "scripts"), exports: {}, Buffer, setTimeout, fetch,
            console: { log() {}, error() {} },
            process: { pid: process.pid, argv: ["node", "ensure-cache", "--publish", path.join(root, "public")],
                stdout: { write() {} }, exit: resolve },
        });
    });
}

test("an existing cache repairs both manifests and publishes every file without downloading", async (t) => {
    const root = fixture(t);
    cached(path.join(root, "caches"));
    cached(path.join(root, "public"), oldTarget);
    manifest(path.join(root, "public"), oldTarget);
    assert.equal(await run(root), 0);
    for (const directory of ["caches", "public"]) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, directory, "caches.json")))[0].name, target);
    }
    assert.equal(fs.readFileSync(path.join(root, "public", target, "main_file_cache.idx0"), "utf8"), "cache bytes");
    assert.equal(fs.statSync(path.join(root, "public", target)).mode & 0o777, 0o755);
    assert.ok(fs.existsSync(path.join(root, "public", oldTarget, "main_file_cache.dat2")));
    // Re-running also repairs an independently stale public manifest.
    manifest(path.join(root, "public"), oldTarget);
    assert.equal(await run(root), 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "public/caches.json")))[0].name, target);
});

for (const failure of [undefined, "archive", "keys", "date"]) {
    test(`a new download preserves old files and manifests until it succeeds (${failure ?? "success"})`, async (t) => {
        const root = fixture(t);
        for (const directory of ["caches", "public"]) {
            cached(path.join(root, directory), oldTarget);
            manifest(path.join(root, directory), oldTarget);
        }
        const zip = new AdmZip();
        for (const file of ["main_file_cache.dat2", "main_file_cache.idx255", "main_file_cache.idx0"]) {
            zip.addFile(`cache/${file}`, Buffer.from("downloaded bytes"));
        }
        const fetch = async (url) => {
            for (const directory of ["caches", "public"]) {
                assert.equal(JSON.parse(fs.readFileSync(path.join(root, directory, "caches.json")))[0].name, oldTarget);
            }
            if (url.endsWith("/caches.json")) return Response.json([
                failure === "date" ? { ...entry, timestamp: "2026-10-21T09:00:00Z" } : entry,
            ]);
            if (url.endsWith("/disk.zip")) {
                return failure === "archive" ? new Response("error", { status: 503 }) : new Response(zip.toBuffer());
            }
            if (url.endsWith("/keys.json")) {
                return failure === "keys" ? new Response("error", { status: 503 }) : Response.json([]);
            }
            throw new Error(`Unexpected request: ${url}`);
        };
        assert.equal(await run(root, fetch), failure ? 1 : 0);
        for (const directory of ["caches", "public"]) {
            assert.ok(fs.existsSync(path.join(root, directory, oldTarget, "main_file_cache.dat2")));
            assert.equal(JSON.parse(fs.readFileSync(path.join(root, directory, "caches.json")))[0].name,
                failure ? oldTarget : target);
            assert.deepEqual(fs.readdirSync(path.join(root, directory)).filter((name) => name.startsWith(".")), []);
        }
    });
}

test("a failed public copy leaves the old public manifest usable", async (t) => {
    const root = fixture(t);
    cached(path.join(root, "caches"));
    cached(path.join(root, "public"), oldTarget);
    manifest(path.join(root, "public"), oldTarget);
    assert.equal(await run(root, undefined, { ...fs, cpSync() { throw new Error("Disk full"); } }), 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "public/caches.json")))[0].name, oldTarget);
    assert.ok(fs.existsSync(path.join(root, "public", oldTarget, "main_file_cache.dat2")));
    assert.deepEqual(fs.readdirSync(path.join(root, "public")).filter((name) => name.startsWith(".")), []);
});
