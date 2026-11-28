// Run after `yarn build`: node --test tests/wilderness-slayer-cave-npcs.test.cjs
// The Wilderness Slayer Cave has its own NPC ids, which carry its drop tables: it spawned the ordinary
// abyssal demon, dust devil and Greater Nechryael, one of eight nechryaels and no jellies.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");

const spawns = require("../data/definitions/npc-spawns.json");
const drops = require("../data/definitions/npc-drops.json");
const sounds = require("../data/definitions/npc-combat-sounds.json").npcs;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

// Cave id, the ordinary id of the same monster, spawns (the Wiki's pins), drop table.
const CAVE = [
  ["Abyssal demon", 11239, 415, 8, "abyssal_demon_drop_table_wilderness"],
  ["Dust devil", 11238, 423, 9, "dust_devil_drop_table_wilderness"],
  ["Greater Nechryael", 11240, 7278, 8, "greater_nechryael_2"],
  ["Jelly", 11241, 437, 14, "jelly_drop_table_wilderness"],
];

const inCave = (s) => s.level === 0 && s.x >= 3328 && s.x <= 3455 && s.y >= 10048 && s.y <= 10175;

test("the cave spawns each monster's cave id, which rolls the cave drop table", () => {
  for (const [name, id, , count, table] of CAVE) {
    const here = spawns.filter((s) => inCave(s) && s.name === name);
    assert.deepEqual(here.map((s) => s.id), Array(count).fill(id), name);
    assert.equal(new Set(here.map((s) => `${s.x},${s.y}`)).size, count, `${name} tiles`);
    assert.equal(CacheDefinitions.getNpc(id).name, name);
    assert.deepEqual(drops.npcs[id].tables, [table], name);
  }
});

test("no spawn outside the cave took a cave id", () => {
  const ids = new Set(CAVE.map(([, id]) => id));
  assert.deepEqual(spawns.filter((s) => ids.has(s.id) && !inCave(s)), []);
});

test("a cave id fights, animates and sounds as the ordinary monster does", () => {
  const resolved = (id) => {
    const def = NpcDefinition.forId(id);
    return {
      attack: def.getAttackAnim(),
      block: def.getDefenceAnim(),
      death: def.getDeathAnim(),
      deathTicks: def.getDeathTicks?.(),
      hitpoints: def.getHitpoints(),
      maxHit: def.getMaxHit(),
      speed: def.getAttackSpeed(),
      slayerLevel: def.getSlayerLevel(),
      task: CacheDefinitions.getNpc(id).params?.get?.(50) ?? CacheDefinitions.getNpc(id).params?.[50],
    };
  };
  for (const [name, id, ordinary] of CAVE) {
    assert.deepEqual(resolved(id), resolved(ordinary), name);
    // Greater Nechryael 11240 was recorded fighting, with an attack sound 7278 lacks.
    for (const kind of Object.keys(sounds[ordinary] ?? {})) {
      assert.deepEqual(sounds[id]?.[kind], sounds[ordinary][kind], `${name} ${kind} sound`);
    }
  }
});
