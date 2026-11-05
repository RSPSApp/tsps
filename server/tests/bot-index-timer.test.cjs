// Run after `yarn build`: node --test tests/bot-index-timer.test.cjs
//
// With a stale dump and no regions, the bots' object index retries until regions exist. That retry mustn't
// be what keeps a process alive: a test loading all plugins without regions would never exit. Each case
// runs in its own child process, with the real TraversalAssist, because the question is whether it exits.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const SERVER = path.resolve(__dirname, "..");
const DEFERRED = "object_index_init_deferred";
// Long enough to load dist, and well past the 5 second retry. A child still running then is the failure.
const BOUND_MS = 60000;
// Past the retry, so a live process sees a second attempt.
const LIVE_PROCESS_MS = 7000;

const CHILD = `
require("./dist/Server").Server.installProductionPathResolver();
const { createTraversalAssist } = require("./plugins/bots/lib/TraversalAssist.PlayerBots");
const [cachePath, hold] = process.argv.slice(1);
const api = {
  getRegionManager: () => ({ regions: new Map(), regionIdForTile: () => 0 }),
  log: (name) => console.log(name),
};
const index = createTraversalAssist(api, { objectIds: [2], cachePath });
index.initializePersistentIndex();
index.schedulePersistentIndexInitialization(0);
if (hold) setTimeout(() => process.exit(0), Number(hold));
`;

/** A dump built for other tracked ids, as a new rock or tree leaves the tracked one. */
function staleDump(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-index-timer-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "object-index.json");
  const cache = fs.readFileSync(path.join(SERVER, "target.txt"), "utf8").trim();
  fs.writeFileSync(file, JSON.stringify({ v: 2, cache, ids: "1", r: {} }));
  return file;
}

function run(t, hold = "") {
  const child = spawnSync(process.execPath, ["-e", CHILD, staleDump(t), hold], {
    cwd: SERVER,
    encoding: "utf8",
    timeout: BOUND_MS,
  });
  t.diagnostic(`status ${child.status} signal ${child.signal} error ${child.error?.code ?? "none"}`);
  return { ...child, deferrals: child.stdout.split(/\r?\n/).filter((line) => line === DEFERRED).length };
}

test("a stale dump with no regions leaves the process free to exit", (t) => {
  const child = run(t);
  assert.ok(child.deferrals >= 1, `it took the no-regions path: ${child.stderr}`);
  assert.equal(child.error?.code, undefined, "it exits by itself, inside the bound");
  assert.equal(child.status, 0);
});

test("control: a process that stays alive still retries", (t) => {
  const child = run(t, String(LIVE_PROCESS_MS));
  assert.equal(child.status, 0, child.stderr);
  assert.ok(child.deferrals >= 2, `retried after the backoff, deferred ${child.deferrals} times`);
});
