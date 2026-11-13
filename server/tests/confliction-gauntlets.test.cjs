// Run after `yarn build`: node --test tests/confliction-gauntlets.test.cjs
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PluginManager } = require("../dist/plugins/PluginManager");
const registerGauntlets = require("../plugins/combat/effects/ConflictionGauntlets.EquipmentEffects");

const GAUNTLETS = 31106;
const TORMENTED = 19544;
const WAND = 1;
const TWO_HANDED_STAFF = 2;
const names = { [GAUNTLETS]: "Confliction gauntlets", [TORMENTED]: "Tormented bracelet", [WAND]: "Kodai wand", [TWO_HANDED_STAFF]: "Tumeken's shadow" };
ItemDefinition.forId = (id) => ({ getName: () => names[id] ?? "", isDoubleHanded: () => id === TWO_HANDED_STAFF });

const core = PluginManager.getCoreApi();
const listeners = new Map();
registerGauntlets({
  core,
  onCustomEvent: (name, fn) => listeners.set(name, fn),
  onCombatHitDamage: (fn) => listeners.set("hit-damage", fn),
});

const BLOOD_BARRAGE = core.CombatSpells.BLOOD_BARRAGE;
const ICE_BARRAGE = core.CombatSpells.ICE_BARRAGE;
const FIRE_SURGE = core.CombatSpells.FIRE_SURGE;

function npc() {
  return { isPlayer: () => false, isNpc: () => true };
}

function player({ hands = GAUNTLETS, weapon = WAND, spell = BLOOD_BARRAGE, target = npc() } = {}) {
  const items = new Array(14).fill(null).map(() => ({ getId: () => -1 }));
  items[Equipment.HANDS_SLOT] = { getId: () => hands };
  items[Equipment.WEAPON_SLOT] = { getId: () => weapon };
  const self = {
    spell,
    target,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return self; },
    getEquipment: () => ({ getItems: () => items }),
    getCombat: () => ({ getSelectedSpell: () => self.spell, getTarget: () => self.target }),
  };
  return self;
}

/** One magic attack: its accuracy roll (missed unless the passive's roll lands), then the settled hit. */
function attack(p, { target = p.target, defenceRolled = 1000, attackRoll = 1000, accurate = false, combatType = CombatType.MAGIC } = {}) {
  const rolled = { attacker: p, target, combatType, attack: attackRoll, defence: 1000, attackRolled: 0, defenceRolled, accurate };
  listeners.get("combat:accuracy-rolled")(rolled);
  listeners.get("hit-damage")({ attacker: p, target, combatType, accurate: rolled.accurate });
  return rolled.accurate;
}

/** How often an attack that missed its first roll lands, after a miss, over many tries. */
function landsAfterMiss(p, over = {}) {
  let landed = 0;
  for (let i = 0; i < 2000; i++) {
    attack(p, { defenceRolled: 1000 }); // a certain miss arms the passive
    if (attack(p, { defenceRolled: 500, ...over })) landed++;
  }
  return landed;
}

let random;
beforeEach(() => {
  if (random) Math.random = random;
  random = Math.random;
});

test("after a miss, the same spell on the same target rolls accuracy a second time", () => {
  const landed = landsAfterMiss(player());
  // A second attack roll of 0..1000 beats a defence roll of 500 about half the time.
  assert.ok(landed > 850 && landed < 1150, `${landed}`);
});

test("the second roll is against the same defence roll, not a new one", () => {
  const p = player();
  attack(p);
  Math.random = () => 0.9999; // the highest attack roll
  assert.equal(attack(p, { defenceRolled: 999 }), true);
  attack(p);
  assert.equal(attack(p, { defenceRolled: 1000 }), false);
});

test("without a miss first there is only the one roll", () => {
  const p = player();
  Math.random = () => 0.9999;
  assert.equal(attack(p, { defenceRolled: 0 }), false);
});

test("a landed attack uses the passive up, and so does the next attack after a miss", () => {
  const p = player();
  attack(p);
  attack(p, { accurate: true });
  Math.random = () => 0.9999;
  assert.equal(attack(p, { defenceRolled: 0 }), false);
  attack(p);
  attack(p, { defenceRolled: 1000 }); // the boosted attack misses again: still armed
  assert.equal(attack(p, { defenceRolled: 0 }), true);
  assert.equal(attack(p, { defenceRolled: 0 }), false); // that one landed, so the next is plain
});

test("another spell or another target in between does not get the second roll", () => {
  Math.random = () => 0.9999;
  const p = player();
  attack(p);
  p.spell = FIRE_SURGE;
  assert.equal(attack(p, { defenceRolled: 0 }), false);

  const q = player();
  attack(q);
  q.target = npc();
  assert.equal(attack(q, { defenceRolled: 0 }), false);
});

test("a multi-target spell's secondary targets neither get nor set the passive", () => {
  Math.random = () => 0.9999;
  const p = player();
  const secondary = npc();
  attack(p, { target: secondary });
  assert.equal(attack(p, { defenceRolled: 0 }), false);
  attack(p);
  assert.equal(attack(p, { target: secondary, defenceRolled: 0 }), false);
  assert.equal(attack(p, { defenceRolled: 0 }), true);
});

test("no passive with a two-handed weapon, without the gauntlets, or for other combat styles", () => {
  Math.random = () => 0.9999;
  for (const p of [player({ weapon: TWO_HANDED_STAFF }), player({ hands: TORMENTED })]) {
    attack(p);
    assert.equal(attack(p, { defenceRolled: 0 }), false);
  }
  const ranged = player();
  attack(ranged, { combatType: CombatType.RANGED });
  assert.equal(attack(ranged, { combatType: CombatType.RANGED, defenceRolled: 0 }), false);
});

test("ice spells on players never get it; blood spells on players do", () => {
  Math.random = () => 0.9999;
  const victim = { isPlayer: () => true, isNpc: () => false };
  const ice = player({ spell: ICE_BARRAGE, target: victim });
  attack(ice);
  assert.equal(attack(ice, { defenceRolled: 0 }), false);
  const blood = player({ spell: BLOOD_BARRAGE, target: victim });
  attack(blood);
  assert.equal(attack(blood, { defenceRolled: 0 }), true);
  const iceOnNpc = player({ spell: ICE_BARRAGE });
  attack(iceOnNpc);
  assert.equal(attack(iceOnNpc, { defenceRolled: 0 }), true);
});

