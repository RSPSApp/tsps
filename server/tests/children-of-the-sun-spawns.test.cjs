// Run after `yarn build`: node --test tests/children-of-the-sun-spawns.test.cjs
//
// NPCs that left Kourend with the Favour system (Hosidius' ploughs and clerk, the Shayzien armourers and
// the architects at the castle statue) kept their spawns while the cache reused their ids for Children
// of the Sun's guards, knights, prince and bandits. Their varbits live in the quest's varp, so a player's
// own progress made them appear: "Guard" with Unmark all over the Hosidius ploughing field (issue 6471).
// The quest spawns its own actors, so no static spawn should read that varp.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const spawns = require("../data/definitions/npc-spawns.json");
const decisions = require("../data/definitions/npc-spawn-sync.json");

const CHILDREN_OF_THE_SUN_VARP = 4075; // "vmq1": the quest stage and the ten guard varbits
// Ids the Wiki still maps for NPCs that left.
const REMOVED_NPC_IDS = [6770, 6780, 6781, 6923, 7083, 7084, 7085, 7086, 7087];

let CacheDefinitions;
before(async () => {
  require("../dist/Server").Server.installProductionPathResolver();
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  ({ CacheDefinitions } = require("../dist/game/cache/CacheDefinitions"));
});

const readsQuestVarp = (id) => {
  const npc = CacheDefinitions.getNpc(id);
  if (!npc?.transforms) return false;
  if (npc.transformVarp === CHILDREN_OF_THE_SUN_VARP) return true;
  return npc.transformVarbit >= 0 && CacheDefinitions.getVarbit(npc.transformVarbit)?.baseVar === CHILDREN_OF_THE_SUN_VARP;
};

test("no static spawn changes with a player's Children of the Sun progress", () => {
  const wrong = spawns.filter((s) => Number.isInteger(s.id) && readsQuestVarp(s.id))
    .map((s) => `${s.name}@${s.x},${s.y},${s.level ?? 0} id ${s.id}`);
  assert.deepEqual(wrong, []);
});

test("Hosa still stands by the castle statue, under the id that shows Hosa", () => {
  const hosa = spawns.find((s) => s.name === "Hosa" && s.x === 1631 && s.y === 3670);
  assert.ok(hosa, "Hosa's spawn");
  assert.equal(CacheDefinitions.getNpc(hosa.id).name, "Hosa");
});

test("the spawn sync leaves out the removed NPCs the Wiki still maps", () => {
  assert.deepEqual(REMOVED_NPC_IDS.filter((id) => decisions.ids[id]?.skip !== true), []);
});
