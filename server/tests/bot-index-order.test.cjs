// Run after `yarn build`: node --test tests/bot-index-order.test.cjs
//
// The bots' object index is a tracked file that any bots-on run rewrites. Two scans of the same world
// must write the same bytes, however the map was read, or every run churns the file in Git.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { createTraversalAssist } = require("../plugins/bots/lib/TraversalAssist.PlayerBots");

const TRACKED = 2;
const REGION = 12850;
// The same placements, read in two different orders.
const PLACEMENTS = [
  { id: TRACKED, localX: 40, localY: 3, plane: 1 },
  { id: TRACKED, localX: 5, localY: 60, plane: 0 },
  { id: TRACKED, localX: 5, localY: 7, plane: 0 },
  { id: TRACKED, localX: 63, localY: 0, plane: 0 },
  { id: TRACKED, localX: 12, localY: 12, plane: 2 },
];

/** Scans a world whose template yields `chunks`, and returns the file written, minus its timestamp. */
function scanWith(t, chunks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-index-order-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "object-index.json");
  const api = {
    core: { readTemplateRegion: () => ({ chunks, settings: {} }) },
    getRegionManager: () => ({
      regions: new Map([[REGION, {}]]),
      getRegionid: () => ({ isLoaded: () => false }),
      regionIdForTile: () => REGION,
    }),
    log() {},
  };
  const index = createTraversalAssist(api, { objectIds: [TRACKED], cachePath: file });
  assert.equal(index.initializePersistentIndex({ forceRescan: true }), true, "the scan ran");
  return fs.readFileSync(file, "utf8").replace(/"t":\d+,/, "");
}

test("two scans in different orders write the same bytes, apart from t", (t) => {
  const forward = scanWith(t, [PLACEMENTS.slice(0, 2), PLACEMENTS.slice(2)]);
  const reversed = scanWith(t, [[...PLACEMENTS].reverse()]);
  assert.match(forward, /"r":\{"12850":\{"2":\[\[/, "the placements were indexed");
  assert.equal(forward, reversed);
});
