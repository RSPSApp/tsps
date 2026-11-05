// Ported from upstream (xrsps/xrsps-typescript) server/scripts/ensure-cache.ts.
// Import style adjusted for this fork's tsconfig (no esModuleInterop), same
// fix already applied in CachePipeline.ts.
import AdmZip = require("adm-zip");
import fs = require("node:fs");
import path = require("node:path");

const OPENRS2_API = "https://archive.openrs2.org";
/** server/ package root (this file lives in server/scripts/) */
const SERVER_ROOT = path.resolve(__dirname, "..");
const CACHES_DIR = path.join(SERVER_ROOT, "caches");
const TARGET_FILE = path.join(SERVER_ROOT, "target.txt");
const LOCK_FILE = path.join(CACHES_DIR, ".cache-download.lock");
const LOCK_POLL_MS = 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;

type OpenRS2CacheEntry = {
    id: number;
    scope: string;
    game: string;
    environment: string;
    language: string;
    builds: Array<{ major: number; minor: number | null }>;
    timestamp: string;
    sources: string[];
    valid_indexes: number;
    indexes: number;
    valid_groups: number;
    groups: number;
    valid_keys: number;
    keys: number;
    size: number;
};

function acquireLock(): boolean {
    const lockPath = LOCK_FILE;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    if (fs.existsSync(lockPath)) {
        try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                console.log("[CacheDownloader] Removing stale lock file");
                fs.unlinkSync(lockPath);
            }
        } catch {}
    }

    try {
        fs.writeFileSync(lockPath, `${process.pid}`, { flag: "wx" });
        return true;
    } catch {
        return false;
    }
}

function releaseLock(): void {
    try {
        fs.unlinkSync(LOCK_FILE);
    } catch {}
}

async function waitForLock(): Promise<void> {
    const lockPath = LOCK_FILE;
    console.log("[CacheDownloader] Another process is downloading the cache, waiting...");
    while (fs.existsSync(lockPath)) {
        try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
                console.log("[CacheDownloader] Lock appears stale, removing");
                fs.unlinkSync(lockPath);
                break;
            }
        } catch {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
}

function readTarget(): string {
    const targetPath = TARGET_FILE;
    if (!fs.existsSync(targetPath)) {
        throw new Error(`target.txt not found at ${targetPath}`);
    }
    return fs.readFileSync(targetPath, "utf8").trim();
}

function parseTargetName(target: string): { revision: number; date: string } {
    const match = target.match(/^osrs-(\d+)_(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
        throw new Error(`Invalid target format: "${target}" (expected osrs-{revision}_{date})`);
    }
    return { revision: parseInt(match[1], 10), date: match[2] };
}

function isCacheValid(cacheDir: string): boolean {
    const required = ["main_file_cache.dat2", "main_file_cache.idx255", "info.json", "keys.json"];
    return required.every((f) => fs.existsSync(path.join(cacheDir, f)));
}

function renderProgressBar(current: number, total: number, width = 40): string {
    const ratio = Math.min(current / total, 1);
    const filled = Math.round(width * ratio);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const pct = (ratio * 100).toFixed(1).padStart(5);
    const currentMB = (current / (1024 * 1024)).toFixed(1);
    const totalMB = (total / (1024 * 1024)).toFixed(1);
    return `  [${bar}] ${pct}% (${currentMB}/${totalMB} MB)`;
}

async function findCacheOnOpenRS2(
    revision: number,
    date: string,
): Promise<OpenRS2CacheEntry | undefined> {
    console.log("[CacheDownloader] Fetching cache index from OpenRS2...");
    const resp = await fetch(`${OPENRS2_API}/caches.json`);
    if (!resp.ok) {
        throw new Error(`Failed to fetch OpenRS2 cache index: ${resp.status} ${resp.statusText}`);
    }
    const caches: OpenRS2CacheEntry[] = await resp.json();

    return caches.find(
        (c) =>
            c.scope === "runescape" &&
            c.game === "oldschool" &&
            c.language === "en" &&
            c.builds.length > 0 &&
            c.builds[0].major === revision &&
            c.timestamp?.startsWith(date),
    );

}

async function downloadWithProgress(url: string, label: string): Promise<Buffer> {
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Download failed: ${resp.status} ${resp.statusText} (${url})`);
    }

    const contentLength = parseInt(resp.headers.get("content-length") ?? "0", 10);
    if (!resp.body || contentLength === 0) {
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }

    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    process.stdout.write(`  ${label}\n`);

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        process.stdout.write(`\r${renderProgressBar(received, contentLength)}`);
    }
    process.stdout.write("\n");

    return Buffer.concat(chunks);
}

async function downloadCache(entry: OpenRS2CacheEntry, cacheDir: string): Promise<void> {
    fs.mkdirSync(cacheDir, { recursive: true });

    console.log(`[CacheDownloader] Downloading cache files (id=${entry.id})...`);
    const zipBuffer = await downloadWithProgress(
        `${OPENRS2_API}/caches/${entry.scope}/${entry.id}/disk.zip`,
        "Downloading cache archive...",
    );

    console.log("[CacheDownloader] Extracting cache files...");
    const zip = new AdmZip(zipBuffer);
    zip.extractEntryTo("cache/", cacheDir, false, true);

    console.log("[CacheDownloader] Downloading XTEA keys...");
    const keysResp = await fetch(`${OPENRS2_API}/caches/${entry.scope}/${entry.id}/keys.json`);
    if (!keysResp.ok) throw new Error(`XTEA keys download failed: ${keysResp.status}`);
    const xteas: Record<string, number[]> = {};
    const keys: Array<{ group: number; key: number[] }> = await keysResp.json();
    for (const k of keys) {
        xteas[k.group.toString()] = k.key;
    }

    fs.writeFileSync(path.join(cacheDir, "keys.json"), JSON.stringify(xteas), "utf8");
    fs.writeFileSync(path.join(cacheDir, "info.json"), JSON.stringify(entry), "utf8");
}

function writeCachesJson(directory: string, target: string, entry: OpenRS2CacheEntry): void {
    const cachesJsonPath = path.join(directory, "caches.json");
    const cacheEntry = {
        name: target,
        game: entry.game,
        environment: entry.environment,
        revision: entry.builds[0].major,
        timestamp: entry.timestamp,
        size: entry.size ?? 0,
    };

    const temporary = `${cachesJsonPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([cacheEntry]), "utf8");
    fs.renameSync(temporary, cachesJsonPath);
}

function publishCache(directory: string, target: string, entry: OpenRS2CacheEntry): void {
    const destination = path.join(directory, target);
    fs.mkdirSync(directory, { recursive: true });
    if (!isCacheValid(destination)) {
        const staging = fs.mkdtempSync(path.join(directory, `.${target}-`));
        try {
            fs.cpSync(path.join(CACHES_DIR, target), staging, { recursive: true });
            if (!isCacheValid(staging)) throw new Error("Published cache is incomplete");
            fs.chmodSync(staging, 0o755); // mkdtemp starts private; nginx needs directory access.
            fs.rmSync(destination, { recursive: true, force: true });
            fs.renameSync(staging, destination);
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    }
    // Existing clients keep their versioned files; new clients see this only after the copy.
    writeCachesJson(directory, target, entry);
    console.log(`[CacheDownloader] Published ${target} to ${directory}`);
}

async function ensureCache(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--publish" || !path.isAbsolute(args[1]))) {
        throw new Error("Usage: ensure-cache [--publish <absolute public cache directory>]");
    }
    const publishDirectory = args[1];
    const target = readTarget();
    const { revision, date } = parseTargetName(target);
    const cacheDir = path.resolve(CACHES_DIR, target);

    console.log(`[CacheDownloader] Target cache: "${target}" (rev ${revision})`);

    if (!acquireLock()) {
        await waitForLock();
        if (!acquireLock()) {
            throw new Error("Failed to acquire cache download lock after waiting");
        }
    }

    try {
        if (!isCacheValid(cacheDir)) {
            console.log("[CacheDownloader] Cache missing or incomplete, searching OpenRS2...");
            const entry = await findCacheOnOpenRS2(revision, date);
            if (!entry) {
                throw new Error(
                    `Could not find cache for revision ${revision} (date=${date}) on OpenRS2 archive`,
                );
            }
            console.log(`[CacheDownloader] Found cache id=${entry.id} (rev ${revision}, ${entry.timestamp})`);
            const staging = fs.mkdtempSync(path.join(CACHES_DIR, `.${target}-`));
            try {
                await downloadCache(entry, staging);
                if (!isCacheValid(staging)) throw new Error("Cache download completed but validation failed");
                fs.rmSync(cacheDir, { recursive: true, force: true });
                fs.renameSync(staging, cacheDir);
            } finally {
                fs.rmSync(staging, { recursive: true, force: true });
            }
        } else {
            console.log("[CacheDownloader] Cache is present and valid");
        }
        const entry: OpenRS2CacheEntry = JSON.parse(fs.readFileSync(path.join(cacheDir, "info.json"), "utf8"));
        if (entry.builds[0]?.major !== revision || !entry.timestamp?.startsWith(date)) {
            throw new Error(`Cache metadata does not match ${target}`);
        }
        writeCachesJson(CACHES_DIR, target, entry);
        if (publishDirectory) publishCache(publishDirectory, target, entry);
    } finally {
        releaseLock();
    }
}

ensureCache()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("[CacheDownloader] Fatal:", err);
        process.exit(1);
    });
