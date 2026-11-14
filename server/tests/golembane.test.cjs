// Run after `yarn build`: node --test tests/golembane.test.cjs
// Golembane (Wiki: Golembane, Barronite mace, Granite hammer): +15% (barronite mace) and +30%
// (granite hammer) melee accuracy and damage against monsters with the "golem" attribute.
const assert = require("node:assert/strict");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const EquipmentEffects = require("../plugins/combat/EquipmentEffects.plugin");

// Monster ids from monsters-complete.json: a Gargoyle, a Rock Golem and a Kurask.
const GARGOYLE = 412;
const ROCK_GOLEM = 6725;
const KURASK = 410;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  new NpcDefinitionLoader().load();
});

function npc(id) {
  const definition = NpcDefinition.forId(id);
  return { isNpc: () => true, getAsNpc: () => ({ getCurrentDefinition: () => definition, getAttribute: () => undefined }) };
}

function createPlayer(weapon, targetId) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
  const target = npc(targetId);
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    getCombat: () => ({ getTarget: () => target, getSelectedSpell: () => null }),
  };
}

// Registers the real EquipmentEffects plugin and chains every melee modifier it attaches.
const accuracyModifiers = [];
const hitModifiers = [];
const noop = () => {};
EquipmentEffects.register(new Proxy({
  registerMeleeAttackAccuracyModifier: (fn) => accuracyModifiers.push(fn),
  registerMeleeHitModifier: (fn) => hitModifiers.push(fn),
  onCustomEvent: noop,
  emitCustomEvent: noop,
}, { get: (api, name) => api[name] ?? noop }));
const chain = (modifiers, player, value) => modifiers.reduce((v, modifier) => modifier(player, v), value);
const accuracy = (player, roll) => chain(accuracyModifiers, player, roll);
const meleeHit = (player, maxHit) => chain(hitModifiers, player, maxHit);

test("the monster data marks gargoyles and rock golems as golems, kurasks not", () => {
  assert.equal(NpcDefinition.forId(GARGOYLE).hasAttribute("golem"), true);
  assert.equal(NpcDefinition.forId(ROCK_GOLEM).hasAttribute("golem"), true);
  assert.equal(NpcDefinition.forId(KURASK).hasAttribute("golem"), false);
});

test("a granite hammer adds 30% accuracy and damage against a golem", () => {
  const player = createPlayer(ItemIdentifiers.GRANITE_HAMMER, GARGOYLE);
  assert.equal(accuracy(player, 20000), 26000);
  assert.equal(meleeHit(player, 40), 52);
  assert.equal(meleeHit(player, 31), 40, "31 + floor(9.3)");
});

test("a barronite mace adds 15% accuracy and damage against a golem, the (l) copy too", () => {
  for (const weapon of [ItemIdentifiers.BARRONITE_MACE, ItemIdentifiers.BARRONITE_MACE_L_]) {
    const player = createPlayer(weapon, ROCK_GOLEM);
    assert.equal(accuracy(player, 20000), 23000);
    assert.equal(meleeHit(player, 40), 46);
  }
});

test("no golembane against other monsters, or with another weapon", () => {
  assert.equal(meleeHit(createPlayer(ItemIdentifiers.GRANITE_HAMMER, KURASK), 40), 40);
  assert.equal(accuracy(createPlayer(ItemIdentifiers.BARRONITE_MACE, KURASK), 20000), 20000);
  assert.equal(meleeHit(createPlayer(ItemIdentifiers.GRANITE_MAUL, GARGOYLE), 40), 40);
  assert.equal(accuracy(createPlayer(ItemIdentifiers.GRANITE_MAUL, GARGOYLE), 20000), 20000);
});
