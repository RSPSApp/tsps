// Run after `yarn build`: node --test tests/coastal-bird-spawn-ids.test.cjs
//
// Spawns whose id shows another NPC. 29 coastal birds named Gull, Seagull, Pelican or Cormorant stood in
// Rellekka, on the Fremennik Isles, along Karamja and the Port Sarim shore as a Shipyard Worker or
// Engineer, Joe, an Eagle, the Joint-Chief Mouser, Luke, Chartin' Charles McAtless or a Mercenary. Each now
// uses the id its name's other spawns use. Two NPCs that left OSRS are gone: the Account security tutor
// (3238,3200, id 9504, now Agitated bees in the cache) and Prifddinas' Ian (2161,3326, id 9195, now Floki).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const spawns = require("../data/definitions/npc-spawns.json");

const BIRDS = ["Gull", "Seagull", "Pelican", "Cormorant"];
const FIXED = [
  ["Gull", 2969, 3146], ["Gull", 2994, 3138], ["Gull", 2937, 3104], ["Gull", 2624, 3702], ["Gull", 2628, 3706],
  ["Gull", 2580, 3892], ["Gull", 2714, 3760], ["Seagull", 3037, 3146], ["Seagull", 3037, 3153],
  ["Pelican", 2914, 3106], ["Pelican", 2934, 3105], ["Cormorant", 2931, 3108],
];

let CacheDefinitions;
before(async () => {
  require("../dist/Server").Server.installProductionPathResolver();
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  ({ CacheDefinitions } = require("../dist/game/cache/CacheDefinitions"));
});

const shown = (id) => CacheDefinitions.resolveNpc(id, { getVarbit: () => 0, getVarp: () => 0 })?.name ?? null;
const spawnAt = (name, x, y) => spawns.find((s) => s.name === name && s.x === x && s.y === y && (s.level ?? 0) === 0);

test("every coastal bird spawn shows the bird it is named for", () => {
  const wrong = spawns.filter((s) => BIRDS.includes(s.name) && shown(s.id) !== s.name)
    .map((s) => `${s.name}@${s.x},${s.y},${s.level ?? 0} id ${s.id} shows ${shown(s.id)}`);
  assert.deepEqual(wrong, []);
});

test("the fixed spawns use the ids their names' other spawns use", () => {
  const expected = { Gull: 281, Seagull: 1338, Pelican: 283, Cormorant: 282 };
  for (const [name, x, y] of FIXED) {
    const spawn = spawnAt(name, x, y);
    assert.ok(spawn, `${name} still spawns at ${x},${y}`);
    assert.equal(spawn.id, expected[name], `${name}@${x},${y}`);
  }
});

test("the Account security tutor and Prifddinas' Ian are gone; the Wilderness Ian stays", () => {
  assert.equal(spawns.find((s) => s.name === "Account security tutor"), undefined);
  assert.equal(spawnAt("Ian", 2161, 3326), undefined);
  assert.equal(shown(9504) === "Account security tutor" || shown(9195) === "Ian", false, "neither id shows its old NPC");
  const wilderness = spawnAt("Ian", 2967, 3765);
  assert.ok(wilderness, "the Wilderness Cape Shop's Ian");
  assert.equal(shown(wilderness.id), "Ian");
});
