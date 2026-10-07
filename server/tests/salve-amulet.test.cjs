// Run after `yarn build`: node --test tests/salve-amulet.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const registerSalve = require("../plugins/combat/effects/SalveAmulet");
const registerJusticiar = require("../plugins/combat/effects/JusticiarArmour");

// Gear is matched by item name; no cache is loaded here.
const NAMES = new Map([
  [ItemIds.SALVE_AMULET, "Salve amulet"],
  [ItemIds.SALVE_AMULET_E_, "Salve amulet (e)"],
  [ItemIds.SALVE_AMULET_I_, "Salve amulet(i)"],
  [ItemIds.SALVE_AMULET_EI_, "Salve amulet(ei)"],
  [ItemIdentifiers.SLAYER_HELMET, "Slayer helmet"],
]);
ItemDefinition.forId = (id) => ({ getName: () => NAMES.get(id) ?? "" });

function undeadTarget(undead) {
  const attributes = undead ? ["undead"] : [];
  return {
    isNpc: () => true,
    getAsNpc: () => ({
      getCurrentDefinition: () => ({ isUndead: () => undead, hasAttribute: (a) => attributes.includes(a) }),
    }),
  };
}

function createPlayer({ amulet = -1, head = -1, undead = true } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.AMULET_SLOT] = { getId: () => amulet };
  items[Equipment.HEAD_SLOT] = { getId: () => head };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ getItems: () => items, get: (slot) => items[slot] }),
    getCombat: () => ({ getTarget: () => undeadTarget(undead) }),
  };
}

/** A fake plugin api keeping each modifier and passing custom events between plugins. */
function fakeApi(extra = {}) {
  const modifiers = {};
  const listeners = new Map();
  const set = (kind) => (fn) => { modifiers[kind] = fn; };
  const api = {
    registerMeleeAttackAccuracyModifier: set("meleeAccuracy"),
    registerMeleeHitModifier: set("meleeHit"),
    registerRangedAttackAccuracyModifier: set("rangedAccuracy"),
    registerRangedHitModifier: set("rangedHit"),
    registerMagicAttackAccuracyModifier: set("magicAccuracy"),
    registerMagicHitModifier: set("magicHit"),
    registerMagicDamageBonusModifier: set("magicDamageBonus"),
    onCustomEvent: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
    emitCustomEvent: (name, payload) => { for (const fn of listeners.get(name) ?? []) fn(payload); },
    ...extra,
  };
  return { api, modifiers };
}

const { api: salveApi, modifiers: salve } = fakeApi();
registerSalve(salveApi);
void registerJusticiar;

test("salve amulets boost the right styles against undead only", () => {
  const base = createPlayer({ amulet: ItemIds.SALVE_AMULET });
  assert.equal(salve.meleeHit(base, 600), 700, "1/6 melee");
  assert.equal(salve.rangedHit(base, 100), 100, "plain salve does not help ranged");
  assert.equal(salve.magicDamageBonus(base, 0), 0);

  const enchanted = createPlayer({ amulet: ItemIds.SALVE_AMULET_E_ });
  assert.equal(salve.meleeHit(enchanted, 100), 120, "20% melee");
  assert.equal(salve.rangedHit(enchanted, 100), 100);

  const imbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_I_ });
  assert.equal(salve.rangedHit(imbued, 100), 116, "7/6, rounded down");
  assert.equal(salve.magicDamageBonus(imbued, 0), 150, "+15% magic damage, in permille");
  assert.equal(salve.magicAccuracy(imbued, 100), 115);

  const enchantedImbued = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_ });
  assert.equal(salve.rangedHit(enchantedImbued, 100), 120);
  assert.equal(salve.magicDamageBonus(enchantedImbued, 0), 200);

  const living = createPlayer({ amulet: ItemIds.SALVE_AMULET_EI_, undead: false });
  assert.equal(salve.meleeHit(living, 100), 100, "not undead, no bonus");
  assert.equal(salve.magicDamageBonus(createPlayer({ amulet: -1 }), 0), 0, "no amulet, no bonus");
});

test("a salve amulet suppresses the slayer helmet bonus on undead targets", () => {
  const { api, modifiers } = fakeApi({
    core: { ItemIdentifiers, Skill, Equipment, ItemDefinition },
    onItemOnItem() {},
    onItemAction() {},
  });
  api.onCustomEvent("slayer:on-task", (request) => { request.onTask = true; });
  registerSalve(api);
  const SlayerHelmet = require("../plugins/items/SlayerHelmet.plugin");
  SlayerHelmet.register(api);

  const undead = createPlayer({ amulet: ItemIdentifiers.SALVE_AMULET_E_, head: ItemIdentifiers.SLAYER_HELMET });
  // The last registered melee modifier is the helmet's; the salve's own bonus is tested above.
  assert.equal(modifiers.meleeHit(undead, 42), 42, "salve wins, no slayer helmet stack");

  const living = createPlayer({ amulet: ItemIdentifiers.SALVE_AMULET_E_, head: ItemIdentifiers.SLAYER_HELMET, undead: false });
  assert.equal(modifiers.meleeHit(living, 42), 49, "against living targets the helmet still applies");
});
