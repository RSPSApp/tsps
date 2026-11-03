// From server/: node --test tests/boss-fights-slayer-audit.test.cjs (no build needed).
//
// The rules the Slayer-boss audit (docs/audits/boss-fights-slayer.md) changed, checked against
// the OSRS Wiki:
// - Kraken: a ranged roll is divided by seven with a floor of one, not truncated to nothing
//   ("If you rolled 0 damage, it stays as 0. If you rolled >=1 damage, it's divided by 7, with a
//   floor of 1." - Mod Ash, 6 September 2023, cited on Kraken and Kraken/Strategies).
// - Alchemical Hydra: an incorrect vent empowers it for up to 50% more damage (35 -> 52 in the
//   Wiki's infobox), and the correct one clears that again.
const assert = require("node:assert/strict");
const { test } = require("node:test");

// --- Kraken

const Shared = require("../plugins/bosses/kraken/Shared.Kraken");
const MagicOnly = require("../plugins/bosses/kraken/MagicOnly.Kraken");

const COMBAT_TYPE = { MAGIC: 2, RANGED: 3, MELEE: 4 };

Shared.bind({
  core: {
    CombatType: COMBAT_TYPE,
    NpcIdentifiers: {
      WHIRLPOOL: 493,
      CAVE_KRAKEN: 492,
      WHIRLPOOL_2: 496,
      KRAKEN: 494,
      WHIRLPOOL_3: 5534,
      ENORMOUS_TENTACLE: 5535,
    },
  },
});

/** A landed hit, as onNpcHitModify sees it. */
function landedHit(type, damage) {
  const player = { messages: [], isPlayer: () => true, sendMessage: (text) => player.messages.push(text) };
  let total = damage;
  const hit = {
    player,
    getCombatType: () => type,
    getTotalDamage: () => total,
    setTotalDamage: (value) => {
      total = value;
    },
    getAttacker: () => player,
  };
  return hit;
}

function applyKrakenHit(type, damage) {
  const hit = landedHit(type, damage);
  MagicOnly.magicOnly({ npc: { getId: () => 494 }, hit });
  return hit;
}

test("a kraken ranged roll is divided by seven, with a floor of one", () => {
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 0).getTotalDamage(), 0, "a miss stays a miss");
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 1).getTotalDamage(), 1);
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 6).getTotalDamage(), 1, "1-6 become 1, not 0");
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 7).getTotalDamage(), 1);
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 14).getTotalDamage(), 2);
  assert.equal(applyKrakenHit(COMBAT_TYPE.RANGED, 48).getTotalDamage(), 6);
  assert.equal(MagicOnly.rangedDamage(3), 1);
});

test("magic lands whole, melee is refused with the Wiki's message", () => {
  assert.equal(applyKrakenHit(COMBAT_TYPE.MAGIC, 28).getTotalDamage(), 28);
  const melee = applyKrakenHit(COMBAT_TYPE.MELEE, 20);
  assert.equal(melee.getTotalDamage(), 0);
  assert.deepEqual(melee.player.messages, [MagicOnly.MELEE_MESSAGE]);
});

// --- Alchemical Hydra

const Common = require("../plugins/bosses/alchemicalhydra/Common.AlchemicalHydra");
const Fight = require("../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra");

/** Cache names to stable fake ids: the test only needs them distinct. */
function fakeCacheDefinitions() {
  const ids = new Map();
  const id = (name) => {
    if (!ids.has(name)) ids.set(name, 1000 + ids.size);
    return ids.get(name);
  };
  return { getNpcId: id, getLocId: id, getSeqId: id, getSpotanimId: id };
}

class Location {
  constructor(x, y, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  getX() {
    return this.x;
  }
  getY() {
    return this.y;
  }
  getZ() {
    return this.z;
  }
  transform(dx, dy) {
    return new Location(this.x + dx, this.y + dy, this.z);
  }
}

class Animation {
  constructor(id) {
    this.id = id;
  }
  getId() {
    return this.id;
  }
}

class Task {
  stop() {}
}

Common.init({
  core: {
    CacheDefinitions: fakeCacheDefinitions(),
    Location,
    Animation,
    Task,
    TaskManager: { submit: () => {} },
  },
});

function hydraAt(x, y) {
  const npc = {
    chats: [],
    getLocation: () => new Location(x, y),
    getSize: () => 6,
    getHitpoints: () => 1100,
    forceChat: (text) => npc.chats.push(text),
    setNpcTransformationId: () => {},
    performAnimation: () => {},
    getCombat: () => ({ setAttackDelay: () => {} }),
  };
  return npc;
}

function player() {
  const self = { messages: [] };
  self.sendMessage = (text) => self.messages.push(text);
  return self;
}

const lair = { contains: () => true, players: () => [] };

test("the wrong vent empowers the Hydra to the Wiki's 52, the right one clears it", () => {
  // Serpentine wants the red vent (1371, 10263); the green one (1371, 10272) is the wrong one.
  const npc = hydraAt(1371, 10272);
  const fight = new Fight.Fight(lair, npc);
  const watcher = player();
  assert.equal(fight.shielded, true);
  assert.equal(fight.maxHit(), 35);
  fight.eruptVents([watcher]);
  assert.equal(fight.empowered, true);
  assert.equal(fight.maxHit(), 52);
  assert.equal(fight.shielded, true, "a wrong vent does not drop the damage reduction");
  assert.ok(watcher.messages.some((text) => text.includes("empowering")));
});

test("the right vent drops the shield and roars; a phase change clears the empower", () => {
  const npc = hydraAt(1371, 10263);
  const fight = new Fight.Fight(lair, npc);
  const watcher = player();
  fight.eruptVents([watcher]);
  assert.equal(fight.shielded, false);
  assert.equal(fight.empowered, false);
  assert.equal(fight.maxHit(), 35);
  assert.deepEqual(npc.chats, ["Roaaaaaaaaaaar!"]);
  assert.ok(watcher.messages.some((text) => text.includes("neutralise")));

  fight.empowered = true;
  fight.changePhase();
  assert.equal(fight.phase, 1);
  assert.equal(fight.shielded, true, "each phase reapplies the reduction");
  assert.equal(fight.empowered, false);
  assert.equal(fight.maxHit(), 35);
});

test("enraged takes the max hit to 55 whatever the vents did", () => {
  const fight = new Fight.Fight(lair, hydraAt(1371, 10263));
  fight.empowered = true;
  fight.phase = 3;
  assert.equal(fight.maxHit(), 55);
});
