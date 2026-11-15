// Run after `yarn build`: node --test tests/killerwatt.test.cjs
// Killerwatt hits against insulated boots (plugins/npcs/Killerwatt.plugin.js, docs/killerwatt.md).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const Killerwatt = require("../plugins/npcs/Killerwatt.plugin");

let core;
let handler = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  new NpcDefinitionLoader().load();
  Killerwatt.register({ core, onCombatHitDamage: (fn) => { handler = fn; } });
});

const npc = (name, maxHits = []) => ({ isNpc: () => true, getCurrentDefinition: () => ({ getName: () => name, getMaxHits: () => maxHits }) });
const killerwattIds = () => {
  const ids = [];
  for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) {
    if (CacheDefinitions.getNpc(id)?.name === "Killerwatt") ids.push(id);
  }
  return ids;
};
const real = (definition) => ({ isNpc: () => true, getCurrentDefinition: () => definition });
const wearing = (itemId) => {
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getEquipment: () => ({ get: (slot) => (slot === core.Equipment.FEET_SLOT && itemId ? new core.Item(itemId) : null) }),
  };
  return player;
};
const hit = (attacker, target, combatType, accurate = true) => {
  const damage = { value: 8, setDamage(v) { this.value = v; } };
  handler({ attacker, target, combatType, damage, accurate });
  return damage.value;
};
const peak = (attacker, target, combatType) => {
  let top = 0;
  for (let i = 0; i < 4000; i++) top = Math.max(top, hit(attacker, target, combatType));
  return top;
};

test("without insulated boots a Killerwatt's melee and ranged hits reach 15", () => {
  assert.equal(peak(npc("Killerwatt"), wearing(null), core.CombatType.MELEE), 15);
  assert.equal(peak(npc("Killerwatt"), wearing(null), core.CombatType.RANGED), 15);
});

test("insulated boots cap a Killerwatt's melee at 6 and leave its ranged roll alone", () => {
  const boots = wearing(ItemIdentifiers.INSULATED_BOOTS);
  assert.equal(peak(npc("Killerwatt"), boots, core.CombatType.MELEE), 6);
  assert.equal(hit(npc("Killerwatt"), boots, core.CombatType.RANGED), 8);
});

test("splashes and other monsters are untouched", () => {
  assert.equal(hit(npc("Killerwatt"), wearing(null), core.CombatType.MELEE, false), 8);
  assert.equal(hit(npc("Goblin"), wearing(null), core.CombatType.MELEE), 8);
});

test("the Killerwatt definitions expose the Wiki's labelled max hits from npc-max-hits.json", () => {
  const ids = killerwattIds();
  assert.ok(ids.length >= 2, `cache Killerwatts: ${ids}`);
  for (const id of ids) {
    const definition = NpcDefinition.forId(id);
    assert.equal(definition.getMaxHit(), 8, "the dump's single max hit is unchanged");
    assert.deepEqual(definition.getMaxHits().map(({ value, label, maxHit }) => ({ value, label, maxHit })), [
      { value: "8", label: "Ranged", maxHit: 8 },
      { value: "6", label: "Melee", maxHit: 6 },
      { value: "15", label: "Ranged/Melee; without insulated boots", maxHit: 15 },
    ], `Killerwatt ${id}`);
    assert.equal(peak(real(definition), wearing(ItemIdentifiers.INSULATED_BOOTS), core.CombatType.MELEE), 6);
    assert.equal(peak(real(definition), wearing(null), core.CombatType.MELEE), 15);
  }
});

test("the maxima follow the labelled entries, not constants in the plugin", () => {
  const listed = [
    { value: "8", label: "Ranged", maxHit: 8 },
    { value: "4", label: "Melee", maxHit: 4 },
    { value: "11", label: "Ranged/Melee; without insulated boots", maxHit: 11 },
  ];
  assert.equal(peak(npc("Killerwatt", listed), wearing(ItemIdentifiers.INSULATED_BOOTS), core.CombatType.MELEE), 4);
  assert.equal(peak(npc("Killerwatt", listed), wearing(null), core.CombatType.RANGED), 11);
});

test("the loader keeps only a record under the NPC's own cache name", () => {
  const read = (record, name) => {
    const definition = new NpcDefinition();
    NpcDefinitionLoader.applyMaxHits(definition, name, record);
    return definition.getMaxHits();
  };
  const record = { name: "Killerwatt", max_hits: [{ value: "6", label: "Melee", max_hit: 6 }, { value: "?", label: null, max_hit: null }] };
  assert.deepEqual(read(record, "Killerwatt"), [{ value: "6", label: "Melee", maxHit: 6 }, { value: "?", label: null, maxHit: null }]);
  assert.deepEqual(read(record, "Goblin"), [], "another cache name is not this NPC");
  assert.deepEqual(read(undefined, "Killerwatt"), []);
});
