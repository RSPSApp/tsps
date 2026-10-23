// node --test tests/nex.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const events = [];
const FAKE_TABLE = [
  { item_id: 532, always: true },
  { item_id: 565, amount: 100 },
  { item_id: 26235, separate_roll: true, section: "Uniques" },
  { item_id: 12073, section: "Tertiary" },
];
const fakeApi = {
  core: {
    Location: class {
      constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
      getX() { return this.x; }
      getY() { return this.y; }
      getZ() { return this.z; }
      transform(dx, dy) { return new this.constructor(this.x + dx, this.y + dy, this.z); }
    },
    ItemIdentifiers: new Proxy({ BIG_BONES: 532, CLUE_SCROLL_ELITE_: 12073, NEXLING: 26348 }, {
      get: (target, name) => target[name] ?? 1000 + String(name).length,
    }),
    ItemDefinition: { forId: (id) => ({ getName: () => ({ 1: "Ancient d'hide body", 2: "Ancient hilt", 3: "Torva platebody", 4: "Rune platebody", 5: "Zaryte vambraces", 6: "Ring of endurance", 7: "Gloves of darkness" })[id] ?? "" }) },
  },
  emitCustomEvent(name, payload) {
    events.push([name, payload]);
    // A stand-in for NpcDrops: every entry the filter keeps drops once.
    if (name === "npc-drops:roll-table") {
      for (const entry of FAKE_TABLE.filter((each) => !payload.entryFilter || payload.entryFilter(each))) {
        payload.drops.push({ itemId: entry.item_id, amount: entry.amount ?? 1, noted: false });
      }
    }
  },
};

const Common = require("../plugins/bosses/nex/Common.Nex");
Common.init(fakeApi);
const Loot = require("../plugins/bosses/nex/Loot.Nex");
const { Fight } = require("../plugins/bosses/nex/Fight.Nex");
const Specials = require("../plugins/bosses/nex/Specials.Nex");
const CombatAchievements = require("../plugins/bosses/nex/CombatAchievements.Nex");
const { Instance } = require("../plugins/bosses/nex/Instance.Nex");

test("Zarosian items by name, the ancient hilt excepted", () => {
  assert.equal(Common.isZarosian("Ancient d'hide body"), true);
  assert.equal(Common.isZarosian("Torva platebody"), true);
  assert.equal(Common.isZarosian("Zaryte vambraces"), true);
  assert.equal(Common.isZarosian("Gloves of darkness"), true);
  assert.equal(Common.isZarosian("Ring of endurance"), true);
  assert.equal(Common.isZarosian("Ancient hilt"), false);
  assert.equal(Common.isZarosian("Rune platebody"), false);
});

test("shares: present players over 1% of the damage, the MVP the biggest", () => {
  const [a, b, c, gone] = [{}, {}, {}, {}];
  const contribution = new Map([[a, 600], [b, 395], [c, 5], [gone, 1000]]);
  const { owed, mvp } = Loot.shares(contribution, [a, b, c]);
  assert.deepEqual(owed.map((entry) => entry.player), [a, b]);
  assert.equal(mvp, a);
  assert.equal(owed[0].share, 0.3);
});

test("loot: the MVP alone gets the big bones, the lump split by share, share-scaled rolls", () => {
  const [a, b] = [{}, {}];
  const loot = Loot.rollLoot(new Map([[a, 700], [b, 300]]), [a, b], () => 0.5);
  const of = (player) => loot.find((entry) => entry.player === player).drops;
  const ids = (player) => of(player).map((drop) => drop.itemId);
  assert.equal(ids(a).includes(532), true);
  assert.equal(ids(b).includes(532), false);
  // Two rolls of the main table (100 blood runes each): 70% (+10% MVP) and 30%.
  assert.equal(of(a).filter((drop) => drop.itemId === 565).reduce((sum, drop) => sum + drop.amount, 0), 2 * Math.floor(100 * 0.7 * 1.1));
  assert.equal(of(b).filter((drop) => drop.itemId === 565).reduce((sum, drop) => sum + drop.amount, 0), 2 * 30);
  // random() = 0.5: kept for the 70% player (0.77 for the unique), not for the 30% one.
  assert.equal(ids(a).includes(26235), true);
  assert.equal(ids(b).includes(26235), false);
});

/** A fight without the engine: the parts act() and the phase rules use. */
function bareFight() {
  const fight = Object.create(Fight.prototype);
  Object.assign(fight, {
    tick: 100, phaseIndex: 0, autosSinceSpecial: 0, specialDue: true, lane: 0, events: [], stage: "fighting",
    attacksOnTarget: 0, meleeChain: 0, noMeleeNext: false, curse: { form: null, attacks: 0, index: -1 },
    target: null, record: { siphonHealed: false, hitBy: new Map(), coughing: new Set() },
  });
  return fight;
}

test("specials: every sixth attack, alternating, the next phase carrying on the lane", () => {
  const ran = [];
  const original = Specials.run;
  Specials.run = (fight, name) => { ran.push(name); return 4; };
  const Attacks = require("../plugins/bosses/nex/Attacks.Nex");
  const originalAttack = Attacks.attack;
  Attacks.attack = () => true;
  try {
    const fight = bareFight();
    for (let i = 0; i < 12; i++) fight.act();
    assert.deepEqual(ran, ["virus", "dash"]);
    assert.equal(fight.autosSinceSpecial, 5);
    // The last was the dash: the shadow phase opens in its lane, with Shadow Smash.
    fight.say = () => {};
    fight.mages = new Map();
    fight.startPhase(1, 0);
    fight.act();
    assert.equal(ran.at(-1), "smash");
  } finally {
    Specials.run = original;
    Attacks.attack = originalAttack;
  }
});

test("the phases' calls and floors are the captured ones", () => {
  const phases = Common.data.fight.phases;
  assert.deepEqual(phases.map((phase) => [phase.call, phase.floor]), [[0.8, 0.75], [0.6, 0.55], [0.4, 0.35], [0.2, 0.15], [0, 0]]);
  assert.deepEqual(phases.map((phase) => phase.specials), [["virus", "dash"], ["darkness", "smash"], ["siphon", "sacrifice"], ["prison", "containment"], []]);
});

test("a hit takes her down to the phase's floor and no further", () => {
  const fight = bareFight();
  let hp = 2600;
  fight.immuneUntil = 0;
  fight.siphonUntil = 0;
  fight.contribution = new Map();
  fight.boss = { getHitpoints: () => hp };
  fight.arena = { players: () => [] };
  fight.areaSound = () => {};
  fight.centre = () => null;
  const parts = [{ damage: 80, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } }];
  const hit = { getAttacker: () => null, getTotalDamage: () => parts.reduce((sum, part) => sum + part.damage, 0), getHits: () => parts, updateTotalDamage() {} };
  fight.hitBoss(hit);
  assert.equal(parts[0].damage, 50);
  hp = 2550;
  parts[0].damage = 30;
  fight.hitBoss(hit);
  assert.equal(parts[0].damage, 0);
});

test("Zaros curses: Soul Split first, Deflect Melee four attacks later, then none", () => {
  const fight = bareFight();
  const forms = [];
  fight.transform = (id) => forms.push(id);
  fight.areaSound = () => {};
  for (let i = 0; i < 9; i++) fight.rotateCurse();
  const { npcs } = Common.data;
  assert.deepEqual(forms, [npcs.soulSplit, npcs.deflect, npcs.nex]);
});

test("the Combat Achievements judged after a clean duo kill", () => {
  events.length = 0;
  const fight = bareFight();
  fight.deaths = 0;
  fight.startPlayers = 2;
  const player = {};
  CombatAchievements.judge(fight, [player]);
  const tasks = events.filter(([name]) => name === "combat-achievements:complete").map(([, payload]) => payload.task);
  assert.deepEqual(tasks, ["Nex Survivors", "Nex Trio", "Nex Duo", "A siphon will solve this", "Contain this!", "There is no escape!", "Shadows Move...", "Perfect Nex"]);
  events.length = 0;
  fight.record.hitBy.set(player, new Set(["dash"]));
  fight.record.coughing.add(player);
  CombatAchievements.judge(fight, [player]);
  const second = events.map(([, payload]) => payload.task);
  assert.equal(second.includes("There is no escape!"), false);
  assert.equal(second.includes("Perfect Nex"), false);
  assert.equal(second.includes("I should see a doctor"), true);
});

test("an instance maps the real chamber onto its copy and back", () => {
  const instance = Object.create(Instance.prototype);
  instance.area = {
    getBaseX: () => 8000,
    getBaseY: () => 1600,
    tile: (x, y, z) => new fakeApi.core.Location(8000 + x, 1600 + y, z),
    contains: () => true,
  };
  const copy = instance.tile(Common.data.chamber.nexTile);
  assert.deepEqual([copy.getX(), copy.getY()], [8000 + 2924 - 360 * 8, 1600 + 5202 - 648 * 8]);
  assert.deepEqual(instance.real(copy), [2924, 5202]);
  assert.equal(instance.inChamber(copy), true);
  assert.equal(instance.inChamber(instance.tile([2905, 5203, 0])), false);
});

test("the data names every special and phase mage", () => {
  const { specials, fight, npcs, chamber } = Common.data;
  for (const phase of fight.phases) {
    for (const name of phase.specials) {
      assert.ok(Specials.SPECIALS[name], name);
      assert.ok(specials[name], name);
    }
    if (phase.mage) {
      assert.ok(npcs.mages[phase.mage]);
      assert.ok(chamber.mages[phase.mage]);
    }
  }
  assert.equal(chamber.aisles.length, 4);
});
