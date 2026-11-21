import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const tooling = dirname(fileURLToPath(import.meta.url));
const excluded = new Set(["caches", "desktop-updates", "desktop-startup.html", "desktop-icon.png"]);

export function packageWebRelease(dist, out, version, baseUrl) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Use a stable client version such as 0.1.2");
    const base = new URL(baseUrl);
    if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) || base.username || base.password || base.search || base.hash) {
        throw new Error("Release URLs require HTTPS, or loopback HTTP for a local test");
    }
    if (!base.pathname.endsWith("/")) throw new Error("Release base URL must end with /");
    dist = resolve(dist); out = resolve(out);
    const outputRelative = relative(dist, out);
    if (!isAbsolute(outputRelative) && outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`)) throw new Error("Release output must be outside the client build");
    if (!statSync(join(dist, "index.html")).isFile()) throw new Error("Client build is missing index.html");
    const { clientVersion } = JSON.parse(readFileSync(join(dist, "client-release.json"), "utf8"));
    if (typeof clientVersion !== "string" || !/^[a-f0-9]{64}$/.test(clientVersion)) throw new Error("Missing client build identifier");
    const cacheMetadata = "caches/caches.json";
    if (lstatSync(join(dist, "caches")).isSymbolicLink()) throw new Error("Client releases cannot contain links in cache metadata");
    const cacheList = JSON.parse(readFileSync(join(dist, cacheMetadata), "utf8"));
    if (!Array.isArray(cacheList) || cacheList.length === 0 || cacheList.some(cache =>
        typeof cache?.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(cache.name) || !Number.isInteger(cache.revision) || cache.revision <= 0)) {
        throw new Error("caches.json must pin the release's cache name and revision");
    }
    const entries = [...readdirSync(dist).filter(name => !excluded.has(name)), cacheMetadata];
    function checkFile(path) {
        const stat = lstatSync(path);
        if (stat.isDirectory()) for (const name of readdirSync(path)) checkFile(join(path, name));
        else if (!stat.isFile()) throw new Error(`Client releases cannot contain links or special files: ${path}`);
    }
    for (const entry of entries) checkFile(join(dist, entry));
    mkdirSync(out, { recursive: true });
    const archiveName = `client-${version}.tar.gz`;
    const archive = join(out, archiveName);
    const packed = spawnSync("tar", ["-czf", archive, "-C", dist, "--", ...entries], {
        env: { ...process.env, COPYFILE_DISABLE: "1" }, encoding: "utf8",
    });
    if (packed.error) throw packed.error;
    if (packed.status !== 0) throw new Error(`Could not package client: ${packed.stderr}`);
    const bytes = readFileSync(archive);
    const manifest = {
        version, createdAt: new Date().toISOString(), minShellVersion: "0.1.2",
        archive: { url: new URL(archiveName, base).href, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length },
    };
    const manifestPath = join(out, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return { manifest, manifestPath, archive };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [version, baseUrl] = process.argv.slice(2);
    if (!version || !baseUrl) throw new Error("Usage: npm run release:web -- <version> <release-base-url/>");
    if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY_PATH (local key file) or TAURI_SIGNING_PRIVATE_KEY (CI secret)");
    const release = packageWebRelease(resolve(tooling, "../../../client/build"), resolve(tooling, "releases/client"), version, baseUrl);
    const signed = spawnSync(resolve(tooling, "node_modules/.bin/tauri"), ["signer", "sign", "--app-version", version, release.manifestPath], {
        env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" }, encoding: "utf8",
    });
    if (signed.error) throw signed.error;
    if (signed.status !== 0) throw new Error("Could not sign client release. Check the signing key and password.");
    // Tauri wraps a standard minisign signature in base64; the web updater reads the raw signature.
    writeFileSync(`${release.manifestPath}.minisig`, Buffer.from(readFileSync(`${release.manifestPath}.sig`, "utf8").trim(), "base64"));
    console.log(`Prepared signed client ${version}: ${release.manifest.archive.size} bytes → ${dirname(release.manifestPath)}`);
}
