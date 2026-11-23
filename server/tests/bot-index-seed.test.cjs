// Run after `yarn build`: node --test tests/bot-index-seed.test.cjs
//
// The tracked object index is a read-only seed. A rebuild goes to the untracked runtime file, so a live
// checkout never has local edits that block the deploy's `git merge --ff-only`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { createTraversalAssist } = require("../plugins/bots/lib/TraversalAssist.PlayerBots");

const TRACKED = 2;
const REGION = 12850;
const CACHE = fs.readFileSync(path.join(process.cwd(), "target.txt"), "utf8").trim();

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-index-seed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let scans = 0;
  const api = {
    core: {
      readTemplateRegion: () => {
        scans++;
        return { chunks: [[{ id: TRACKED, localX: 5, localY: 7, plane: 0 }]], settings: {} };
      },
    },
    getRegionManager: () => ({
      regions: new Map([[REGION, {}]]),
      getRegionid: () => ({ isLoaded: () => false }),
      regionIdForTile: () => REGION,
    }),
    log() {},
  };
  return {
    seedPath: path.join(dir, "seed", "object-index.json"),
    cachePath: path.join(dir, "saves", "bot-object-index.json"),
    api,
    scans: () => scans,
  };
}

const dump = (ids, r) => JSON.stringify({ v: 2, t: 1, cache: CACHE, ids, r });

test("a stale seed rebuilds into the runtime file and leaves the seed's bytes alone", (t) => {
  const { seedPath, cachePath, api, scans } = setup(t);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  const seed = dump("1", { [REGION]: { 1: [[1, 1, 0]] } });
  fs.writeFileSync(seedPath, seed);

  const index = createTraversalAssist(api, { objectIds: [TRACKED], cachePath, seedPath });
  assert.equal(index.initializePersistentIndex(), true);
  assert.equal(scans(), 1, "the stale seed was rescanned");
  assert.equal(fs.readFileSync(seedPath, "utf8"), seed, "the tracked seed is never written");
  const rebuilt = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  assert.equal(rebuilt.ids, String(TRACKED));
  assert.deepEqual(rebuilt.r, { [REGION]: { [TRACKED]: [[5, 7, 0]] } });
  assert.equal(fs.existsSync(`${cachePath}.tmp`), false);
});

test("a valid runtime copy is used before the seed, with no rescan", (t) => {
  const { seedPath, cachePath, api, scans } = setup(t);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  // Both are valid; only the runtime copy has a location at (9, 9).
  fs.writeFileSync(seedPath, dump(String(TRACKED), { [REGION]: { [TRACKED]: [[1, 1, 0]] } }));
  fs.writeFileSync(cachePath, dump(String(TRACKED), { [REGION]: { [TRACKED]: [[9, 9, 0]] } }));
  const before = fs.readFileSync(cachePath, "utf8");

  const logs = [];
  const index = createTraversalAssist({ ...api, log: (event, data) => logs.push({ event, data }) },
    { objectIds: [TRACKED], cachePath, seedPath });
  assert.equal(index.initializePersistentIndex(), true);
  assert.equal(scans(), 0);
  const loaded = logs.find((entry) => entry.event === "object_index_loaded");
  assert.equal(loaded?.data.source, "cache");
  assert.equal(loaded?.data.path, cachePath);
  assert.equal(fs.readFileSync(cachePath, "utf8"), before, "loading does not rewrite the runtime copy");
});

test("a valid seed is used when there is no runtime copy, and nothing is written", (t) => {
  const { seedPath, cachePath, api, scans } = setup(t);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  const seed = dump(String(TRACKED), { [REGION]: { [TRACKED]: [[1, 1, 0]] } });
  fs.writeFileSync(seedPath, seed);

  const index = createTraversalAssist(api, { objectIds: [TRACKED], cachePath, seedPath });
  assert.equal(index.initializePersistentIndex(), true);
  assert.equal(scans(), 0);
  assert.equal(fs.existsSync(cachePath), false);
  assert.equal(fs.readFileSync(seedPath, "utf8"), seed);
});

test("the plugin points its rebuild at an ignored runtime file, not the tracked seed", () => {
  const vm = require("node:vm");
  const { createRequire } = require("node:module");
  const filename = path.resolve(__dirname, "../plugins/bots/PlayerBots.plugin.js");
  const context = { require: createRequire(filename), module: { exports: {} }, process, console,
    __dirname: path.dirname(filename) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8") + "\nmodule.exports.config = BOT_CONFIG;", context, { filename });
  const config = context.module.exports.config;
  const server = path.resolve(__dirname, "..");
  assert.equal(path.resolve(config.objectIndexSeedPath), path.join(server, "plugins", "bots", "data", "object-index.json"));
  assert.equal(path.resolve(config.objectIndexCachePath), path.join(server, "data", "saves", "bot-object-index.json"));
  const ignored = require("node:child_process").spawnSync("git", ["check-ignore", "-q", config.objectIndexCachePath], { cwd: server });
  assert.equal(ignored.status, 0, "the runtime index is gitignored");
});
