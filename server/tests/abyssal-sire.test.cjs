// Run after `yarn build`: node --test tests/abyssal-sire.test.cjs
// The Abyssal Sire (Wiki: Abyssal Sire, Unsired, The Overseer): the fight's hit rules, the
// miasma's damage, the Font's roll, the Overseer's wants and the chambers' own spawns.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const Common = require("../plugins/bosses/abyssalsire/Common.AbyssalSire");
const { Fight, PHASE, shadowSpellOf } = require("../plugins/bosses/abyssalsire/Fight.AbyssalSire");
const Miasma = require("../plugins/bosses/abyssalsire/Miasma.AbyssalSire");
const Font = require("../plugins/bosses/abyssalsire/Font.AbyssalSire");
const Overseer = require("../plugins/bosses/abyssalsire/Overseer.AbyssalSire");
const Lair = require("../plugins/bosses/abyssalsire/Lair.AbyssalSire");

const SHADOW_BARRAGE = { name: "Shadow Barrage" };
const ICE_BARRAGE = { name: "Ice Barrage" };
const ORPHAN = 13262;
const SPINE = 13274;
const CLAW = 13275;
const AXON = 13276;

const events = [];
const pending = [];
before(() => {
  Common.init({
    core: {
      Location,
      CombatType,
      CombatSpells: { SHADOW_RUSH: {}, SHADOW_BURST: {}, SHADOW_BLITZ: {}, SHADOW_BARRAGE, ICE_BARRAGE },
      ItemIdentifiers: { ABYSSAL_ORPHAN: ORPHAN },
      ItemDefinition: { forId: (id) => ({ getName: () => ({ [SPINE]: "Bludgeon spine", [CLAW]: "Bludgeon claw", [AXON]: "Bludgeon axon" })[id] }) },
      Animation: class { constructor(id) { this.id = id; } },
      Graphic: class { constructor(id, delay) { this.id = id; this.delay = delay; } },
      HitDamage: class { constructor(damage, mask) { this.damage = damage; this.mask = mask; } },
      HitMask: { BLUE: 0, RED: 1, GREEN: 2 },
      CombatFactory: { poisonEntity: (entity, severity) => events.push({ name: "poison", severity }) },
      Task: class {},
      TaskManager: { submit: () => {} },
    },
    emitCustomEvent: (name, payload) => {
      events.push({ name, payload });
      if (name === "pets:owns") payload.owns = payload.player.ownsOrphan === true;
    },
  });
});

function withRandom(value, action) {
  const random = Math.random;
  Math.random = typeof value === "function" ? value : () => value;
  try {
    return action();
  } finally {
    Math.random = random;
  }
}

function hitOf(damage, { attacker, type = CombatType.RANGED, spell = null } = {}) {
  const parts = [{ value: damage, getDamage() { return this.value; }, setDamage(value) { this.value = value; } }];
  return {
    total: damage,
    getAttacker: () => attacker,
    getCombatType: () => type,
    getSpell: () => spell,
    getHits: () => parts,
    getTotalDamage() { return this.total; },
    updateTotalDamage() { this.total = parts.reduce((sum, part) => sum + part.value, 0); },
  };
}

function attributes() {
  const values = {};
  return { getAttribute: (key) => values[key], setAttribute: (key, value) => { values[key] = value; } };
}

/** A fight with its world calls stubbed: the Sire's hitpoints, the player's tile, what it sends. */
function fightWith({ hitpoints = 425, phase = PHASE.AWAKE, playerAt = [2969, 4779], sireAt = [2967, 4781] } = {}) {
  const sire = {
    hp: hitpoints,
    getHitpoints() { return this.hp; },
    setHitpoints(value) { this.hp = value; },
    getMaxHitpoints: () => 425,
    getLocation: () => new Location(sireAt[0], sireAt[1], 0),
    getSize: () => 6,
    setNpcTransformationId: () => {},
    performAnimation: () => {},
    setMobileInteraction: () => {},
  };
  const sent = [];
  const player = {
    ...attributes(),
    getLocation: () => new Location(playerAt[0], playerAt[1], 0),
    sendMessage: (text) => sent.push(text),
    getPacketSender: () => ({ sendSoundEffect: () => {}, sendAreaSound: () => {}, sendGraphic: () => {} }),
    getHitpoints: () => 99,
    isRegistered: () => true,
  };
  const lair = { sire, players: () => [player], contains: () => true, setTentacles: () => {} };
  const fight = new Fight(lair, player);
  fight.phase = phase;
  fight.stun = function () { this.stunned_ = true; this.stunnedUntil = this.tick + 46; };
  fight.toPhase3 = function () { this.phase3_ = true; };
  fight.explode = function () { this.exploded_ = true; };
  return { fight, sire, player, sent };
}

test("a hit's shadow spell is named by its CombatSpells constant; other spells are not shadow spells", () => {
  assert.equal(shadowSpellOf(hitOf(0, { spell: SHADOW_BARRAGE })), "SHADOW_BARRAGE");
  assert.equal(shadowSpellOf(hitOf(0, { spell: ICE_BARRAGE })), null);
  assert.equal(shadowSpellOf(hitOf(0)), null);
});

test("phase 1: 75 ranged or magic damage stuns it, and no hit takes it below 1", () => {
  const { fight, sire, player } = fightWith({ hitpoints: 50 });
  fight.hitSire(hitOf(40, { attacker: player }));
  assert.equal(fight.stunned_, undefined);
  const hit = hitOf(60, { attacker: player });
  fight.hitSire(hit);
  assert.equal(fight.stunned_, true, "40 + 60 is past 75");
  assert.equal(hit.getTotalDamage(), sire.hp - 1, "phase 1 can't kill it");
});

test("phase 1: Shadow Barrage always stuns, even on a splash", () => {
  const { fight, player } = fightWith();
  withRandom(0.99, () => fight.hitSire(hitOf(0, { attacker: player, type: CombatType.MAGIC, spell: SHADOW_BARRAGE })));
  assert.equal(fight.stunned_, true);
});

test("a shadow spell that wakes it stuns it once it is up, 10 ticks on, not with the waking hit", () => {
  const { fight, player } = fightWith();
  const hit = hitOf(0, { attacker: player, type: CombatType.MAGIC, spell: SHADOW_BARRAGE });
  withRandom(0, () => {
    fight.wake("SHADOW_BARRAGE");
    fight.hitSire(hit);
  });
  assert.equal(fight.stunned_, undefined);
  const stun = fight.events.find((event) => event.tick === 10);
  assert.ok(stun, "the stun waits out its waking");
  stun.action();
  assert.equal(fight.stunned_, true);
});

test("another player's hits do nothing to it", () => {
  const { fight } = fightWith();
  const hit = hitOf(30, { attacker: { other: true } });
  fight.hitSire(hit);
  assert.equal(hit.getTotalDamage(), 0);
});

test("walking between phases its damage is halved (Wiki: Poll 84)", () => {
  const { fight, player } = fightWith({ phase: PHASE.TO_PHASE_2 });
  const hit = hitOf(31, { attacker: player });
  fight.hitSire(hit);
  assert.equal(hit.getTotalDamage(), 15);
});

test("phase 2: below half it heads for phase 3; a ranged hit from afar pulls the player in next", () => {
  const near = fightWith({ phase: PHASE.PHASE_2, hitpoints: 220, playerAt: [2969, 4779] });
  near.fight.hitSire(hitOf(10, { attacker: near.player }));
  assert.equal(near.fight.phase3_, true, "210 is below 212.5");
  assert.equal(near.fight.pullNext, false, "2 tiles away is in reach");
  const far = fightWith({ phase: PHASE.PHASE_2, playerAt: [2969, 4774] });
  far.fight.hitSire(hitOf(10, { attacker: far.player }));
  assert.equal(far.fight.pullNext, true, "7 tiles away");
});

test("phase 3: below 35% it explodes, and can't die before it has", () => {
  const { fight, player } = fightWith({ phase: PHASE.PANIC, hitpoints: 150 });
  const hit = hitOf(200, { attacker: player });
  fight.hitSire(hit);
  assert.equal(fight.exploded_, true);
  assert.equal(hit.getTotalDamage(), 149);
});

test("a miasma pool hurts on its 3rd to 5th ticks, less each time, and poisons with its first", () => {
  const { fight, player } = fightWith({ playerAt: [3000, 3000] });
  const hurt = [];
  player.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: ([hit]) => hurt.push(hit.damage) }) });
  fight.playerHere = () => true;
  const miasma = new Miasma(fight);
  miasma.place(new Location(3000, 3000, 0));
  events.length = 0;
  withRandom(0.999, () => {
    for (let tick = 1; tick <= 6; tick++) {
      fight.tick = tick;
      miasma.tick();
    }
  });
  assert.deepEqual(hurt, [26, 17, 9]);
  assert.deepEqual(events.filter((event) => event.name === "poison").map((event) => event.severity), [36],
    "severity 36, a first hit of 8 (rsprox_transcripts/227/00240.txt:9300)");
});

test("the Font leaves the orphan out for a player who owns it, and repeats no bludgeon piece in a set", () => {
  const owner = { ...attributes(), ownsOrphan: true };
  for (let i = 0; i < 200; i++) assert.notEqual(Font.roll(owner), ORPHAN);
  const player = attributes();
  const pieces = [Font.rollPiece(player), Font.rollPiece(player), Font.rollPiece(player)];
  assert.deepEqual([...pieces].sort(), [SPINE, CLAW, AXON].sort(), "all three before any twice");
  assert.ok([SPINE, CLAW, AXON].includes(Font.rollPiece(player)), "a new set starts after the third");
});

test("the Overseer names the parts he still wants", () => {
  const player = { ...attributes() };
  assert.equal(Overseer.stillWanted(player), "a bludgeon spine, a bludgeon claw and a bludgeon axon");
  player.setAttribute(Common.PARTS_ATTRIBUTE, 1 | 4);
  assert.equal(Overseer.stillWanted(player), "a bludgeon claw");
});

test("each chamber's Sire, lungs and tentacles are its own, not the world file's", () => {
  Common.data.lairs.forEach((def, index) => Lair.lairs.push(new Lair.Lair(def, index)));
  try {
    const sw = Common.data.lairs[0];
    assert.ok(Lair.lairAt(new Location(sw.sire[0], sw.sire[1], 0)));
    assert.equal(Lair.lairAt(new Location(3040, 4783, 0)), null, "the Overseer's room is no chamber");
  } finally {
    Lair.lairs.length = 0;
  }
});
