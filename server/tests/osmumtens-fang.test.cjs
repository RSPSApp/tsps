// Run after `yarn build`: node --test tests/osmumtens-fang.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const registerFang = require("../plugins/combat/effects/OsmumtensFang.EquipmentEffects");

const FANG = 26219;
const SWORD = 1;
ItemDefinition.forId = (id) => ({ getName: () => (id === FANG ? "Osmumten's fang" : id === SWORD ? "Rune sword" : "") });

const listeners = new Map();
let insideTombs = false;
registerFang({
  core: PluginManager.getCoreApi(),
  onCustomEvent: (name, fn) => listeners.set(name, fn),
  emitCustomEvent: (name, query) => { if (name === "toa:in-tombs") query.inside = insideTombs; },
});

function player({ weapon = FANG, bonus = BonusManager.ATTACK_STAB, area = "Wilderness" } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    isSpecialActivated: () => false,
    getEquipment: () => ({ getItems: () => items }),
    getFightType: () => ({ getBonusType: () => bonus }),
    getArea: () => ({ getName: () => area }),
  };
}

function accuracy(attacker, over = {}) {
  const rolled = { attacker, combatType: CombatType.MELEE, attack: 1000, defence: 1000, attackRolled: 0, defenceRolled: 600, accurate: false, ...over };
  listeners.get("combat:accuracy-rolled")(rolled);
  return rolled.accurate;
}

function hit(attacker, over = {}) {
  const rolled = { attacker, combatType: CombatType.MELEE, damage: 0, minimum: 0, maximum: 60, ...over };
  listeners.get("combat:hit-rolled")(rolled);
  return rolled.damage;
}

test("a normal fang hit deals 15% to 85% of the max hit", () => {
  const p = player();
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(hit(p));
  assert.equal(Math.min(...seen), 9);
  assert.equal(Math.max(...seen), 51);
});

test("the top of the range rounds up like the Wiki calculator (max 28 gives 4 to 24)", () => {
  const p = player();
  const seen = new Set();
  for (let i = 0; i < 4000; i++) seen.add(hit(p, { maximum: 28 }));
  assert.equal(Math.min(...seen), 4);
  assert.equal(Math.max(...seen), 24);
});

test("a forced max hit stays fixed and the range is narrowed for later listeners", () => {
  assert.equal(hit(player(), { minimum: 17, maximum: 17, damage: 17 }), 17);
  const rolled = { attacker: player(), combatType: CombatType.MELEE, damage: 0, minimum: 0, maximum: 28 };
  listeners.get("combat:hit-rolled")(rolled);
  assert.deepEqual([rolled.minimum, rolled.maximum], [4, 24]);
});

test("rollAccuracy sends combat:accuracy-rolled and returns the listener's verdict", () => {
  const original = AccuracyFormulasDpsCalc.specialRolls;
  const emit = PluginManager.emitCustomEvent;
  AccuracyFormulasDpsCalc.specialRolls = () => ({ attack: 0, defence: 1000 });
  PluginManager.emitCustomEvent = (name, rolled) => { if (name === "combat:accuracy-rolled") rolled.accurate = true; };
  try {
    assert.equal(AccuracyFormulasDpsCalc.rollAccuracy({}, {}, CombatType.MELEE), true);
  } finally {
    AccuracyFormulasDpsCalc.specialRolls = original;
    PluginManager.emitCustomEvent = emit;
  }
});

test("other weapons and Eviscerate keep their own range", () => {
  assert.equal(hit(player({ weapon: SWORD }), { damage: 3 }), 3);
  const original = CombatSpecial.activeTraitsFor;
  CombatSpecial.activeTraitsFor = () => ({});
  try {
    assert.equal(hit(player(), { damage: 60 }), 60);
  } finally {
    CombatSpecial.activeTraitsFor = original;
  }
});

test("a missed stab gets a second roll against the same defence roll", () => {
  const p = player();
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (accuracy(p, { attackRolled: 0, defenceRolled: 500 })) hits++;
  // attack 0..1000 > 500 is about half the time.
  assert.ok(hits > 1700 && hits < 2300, `${hits}`);
  assert.equal(accuracy(p, { defenceRolled: 1000 }), false);
});

test("the second roll needs a stab style and leaves a landed hit alone", () => {
  assert.equal(accuracy(player({ bonus: BonusManager.ATTACK_SLASH }), { defenceRolled: 0 }), false);
  assert.equal(accuracy(player(), { accurate: true, defenceRolled: 1000 }), true);
  assert.equal(accuracy(player({ weapon: SWORD }), { defenceRolled: 0 }), false);
});

test("inside the raid the defence roll is rolled again too", () => {
  const p = player();
  insideTombs = true;
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (accuracy(p, { defenceRolled: 1000 })) hits++;
  insideTombs = false;
  assert.ok(hits > 1700 && hits < 2300, `${hits}`);
});
