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
const Killerwatt = require("../plugins/npcs/Killerwatt.plugin");

let core;
let handler = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Killerwatt.register({ core, onCombatHitDamage: (fn) => { handler = fn; } });
});

const npc = (name) => ({ isNpc: () => true, getCurrentDefinition: () => ({ getName: () => name }) });
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
