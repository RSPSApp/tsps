import AdmZip = require("adm-zip");
import fs = require("fs");
import path = require("path");
import { SectorCluster } from "./codec/rs/cache/store/SectorCluster";
import { FileStore } from "./codec/rs/cache/store/FileStore";
import { GAMEVAL_INDEX } from "./Gamevals";

const OPENRS2 = "https://archive.openrs2.org";
const REQUIRED_FILES = [
  "main_file_cache.dat2",
  "main_file_cache.idx255",
  "info.json",
  "keys.json",
];

type OpenRs2Cache = {
  id: number;
  scope: string;
  game: string;
  environment: string;
  language: string;
  builds: Array<{ major: number }>;
  timestamp: string;
  size: number;
};

export type ActiveCache = {
  name: string;
  revision: number;
  directory: string;
  timestamp: string;
};

export function parseCacheTarget(target: string): { revision: number; date: string } {
  const match = /^osrs-(\d+)_(\d{4}-\d{2}-\d{2})$/.exec(target);
  if (!match) {
    throw new Error(`Invalid cache target "${target}"; expected osrs-{revision}_{date}`);
  }
  return { revision: Number(match[1]), date: match[2] };
}

export class CachePipeline {
  private static active?: ActiveCache;
  private static store?: FileStore;
  private static xteas = new Map<number, number[]>();

  public static isInitialized(): boolean {
    return this.active != null;
  }

  public static getActive(): ActiveCache {
    if (!this.active) throw new Error("Cache pipeline has not been initialized");
    return this.active;
  }

  public static getStore(): FileStore {
    if (this.store) return this.store;
    const active = this.getActive();
    return this.store = new FileStore(active.directory);
  }

  public static getXtea(regionId: number): number[] {
    return this.xteas.get(regionId) ?? [0, 0, 0, 0];
  }

  public static async initialize(root = process.cwd()): Promise<ActiveCache> {
    this.store?.close();
    this.store = undefined;
    const name = fs.readFileSync(path.join(root, "target.txt"), "utf8").trim();
    const { revision, date } = parseCacheTarget(name);
    const caches = path.join(root, "caches");
    const directory = path.join(caches, name);
    fs.mkdirSync(caches, { recursive: true });

    if (!this.isValid(directory)) {
      if (process.env.BROWSER_HOST === "1") {
        throw new Error("Browser-host cache is missing or incomplete; restart the server to reload it");
      }
      await this.download(caches, directory, name, revision, date);
    }

    const info = JSON.parse(fs.readFileSync(path.join(directory, "info.json"), "utf8"));
    this.xteas = new Map(Object.entries(JSON.parse(
      fs.readFileSync(path.join(directory, "keys.json"), "utf8")
    ) as Record<string, number[]>).map(([regionId, key]) => [Number(regionId), key]));
    const manifestPath = path.join(caches, "caches.json");
    const manifest = JSON.stringify([
      {
        name,
        game: info.game ?? "oldschool",
        environment: info.environment ?? "live",
        revision,
        timestamp: info.timestamp ?? date,
        size: info.size ?? 0,
      },
    ]);
    if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== manifest) {
      fs.writeFileSync(manifestPath, manifest);
    }
    this.active = { name, revision, directory, timestamp: info.timestamp ?? date };
    return this.active;
  }

  /** Every required file is there, and the index list reaches the gamevals (a stale or cut-short cache does not). */
  private static isValid(directory: string): boolean {
    return REQUIRED_FILES.every((file) => fs.existsSync(path.join(directory, file)))
      && fs.statSync(path.join(directory, "main_file_cache.idx255")).size > GAMEVAL_INDEX * SectorCluster.SIZE;
  }

  private static async download(
    caches: string,
    directory: string,
    name: string,
    revision: number,
    date: string
  ): Promise<void> {
    const lock = path.join(caches, ".cache-download.lock");
    let ownsLock = false;
    try {
      try {
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 10 * 60 * 1000) {
          fs.rmSync(lock, { force: true });
        }
        fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
        ownsLock = true;
      } catch {
        while (fs.existsSync(lock)) {
          if (Date.now() - fs.statSync(lock).mtimeMs > 10 * 60 * 1000) {
            fs.rmSync(lock, { force: true });
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (this.isValid(directory)) return;
        fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
        ownsLock = true;
      }

      const response = await fetch(`${OPENRS2}/caches.json`);
      if (!response.ok) throw new Error(`OpenRS2 cache index returned HTTP ${response.status}`);
      const entries = (await response.json()) as OpenRs2Cache[];
      const candidates = entries
        .filter(
          (entry) =>
            entry.scope === "runescape" &&
            entry.game === "oldschool" &&
            entry.language === "en" &&
            entry.builds[0]?.major === revision
        )
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      const entry = candidates.find((candidate) => candidate.timestamp.startsWith(date)) ?? candidates[0];
      if (!entry) throw new Error(`OpenRS2 has no oldschool cache for revision ${revision}`);

      const temporary = path.join(caches, `.${name}-${process.pid}`);
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.mkdirSync(temporary, { recursive: true });
      try {
        const [archiveResponse, keysResponse] = await Promise.all([
          fetch(`${OPENRS2}/caches/${entry.scope}/${entry.id}/disk.zip`),
          fetch(`${OPENRS2}/caches/${entry.scope}/${entry.id}/keys.json`),
        ]);
        if (!archiveResponse.ok) throw new Error(`OpenRS2 disk archive returned HTTP ${archiveResponse.status}`);
        new AdmZip(Buffer.from(await archiveResponse.arrayBuffer())).extractEntryTo(
          "cache/",
          temporary,
          false,
          true
        );

        const xteas: Record<string, number[]> = {};
        if (keysResponse.ok) {
          for (const key of (await keysResponse.json()) as Array<{ group: number; key: number[] }>) {
            xteas[String(key.group)] = key.key;
          }
        }
        fs.writeFileSync(path.join(temporary, "keys.json"), JSON.stringify(xteas));
        fs.writeFileSync(path.join(temporary, "info.json"), JSON.stringify(entry));
        if (!this.isValid(temporary)) throw new Error("Downloaded cache failed validation");

        fs.rmSync(directory, { recursive: true, force: true });
        fs.renameSync(temporary, directory);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    } finally {
      if (ownsLock) fs.rmSync(lock, { force: true });
    }
  }
}
