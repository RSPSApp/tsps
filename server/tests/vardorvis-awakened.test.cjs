// Run after `yarn build`: node --test tests/vardorvis-awakened.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { HitQueue } = require("../dist/game/content/combat/hit/HitQueue");
const Common = require("../plugins/bosses/vardorvis/Common.Vardorvis");
const { Fight, attachFight, dropChance, slayerEligible, UNIQUE_STAGE } = require("../plugins/bosses/vardorvis/Fight.Vardorvis");
const Drops = require("../plugins/npcs/NpcDrops.plugin");

class Location {
  constructor(x = 1128, y = 3417, z = 0) { Object.assign(this, { x, y, z }); }
  getX() { return this.x; }
  getY() { return this.y; }
  getZ() { return this.z; }
  clone() { return new Location(this.x, this.y, this.z); }
  equals(other) { return this.x === other.x && this.y === other.y && this.z === other.z; }
}

/** A fight with only what the awakened rules read: the boss, its fight and the event api. */
function fixture({ awakened = false } = {}) {
  const listeners = new Map();
  const tasks = [];
  const sender = new Proxy({}, { get: () => () => {} });
  const player = {
    hp: 1000,
    isRegistered: () => true,
    isPlayer: () => true,
    getHitpoints() { return this.hp; },
    getPacketSender: () => sender,
    getLocation: () => new Location(),
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    addTickHit() {},
    performAnimation() {},
    sendMessage() {},
  };
  const queue = new HitQueue(player);
  queue.addPendingHit = () => {};
  player.getCombat = () => ({ getHitQueue: () => queue, reset() {} });
  const boss = {
    hp: awakened ? 1400 : 700,
    getId: () => Common.data.npcs.boss,
    isRegistered: () => true,
    getHitpoints() { return this.hp; },
    getMaxHitpoints: () => awakened ? 1400 : 700,
    getLocation: () => new Location(),
    getMovementQueue: () => ({ reset() {}, setBlockMovement() {} }),
    setPositionToFace() {},
    performAnimation() {},
    setStatDrainImmune(value) { this.drainImmune = value; },
  };
  const api = {
    core: {
      HitDamage, HitMask, Location,
      Animation: class {}, Graphic: class {}, CombatMethod: class {}, CombatType: { MELEE: "melee" },
      PendingHit: class {
        constructor() { this.parts = [new HitDamage(20, HitMask.RED)]; }
        getHits() { return this.parts; }
        updateTotalDamage() {}
      },
      CombatFactory: { applyStyleDamage() {} },
      PrayerHandler: { PROTECT_FROM_MELEE: 0, isActivated: () => false },
      World: { getProcessCycle: () => 0 },
      Task: class { stop() { this.stopped = true; } },
      TaskManager: { submit: (task) => tasks.push(task) },
    },
    persistAttribute() {}, registerNpcCombatMethodProvider() {}, registerCommand() {},
    getItemOnGroundManager: () => ({}),
    onCombatHitResolved() {}, onNpcBeforeDeath() {}, onNpcDeath() {}, onPlayerLogin() {},
    onCustomEvent(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    emitCustomEvent(name, event) { for (const fn of listeners.get(name) ?? []) fn(event); },
    removeNpc() {}, log() {},
  };
  Common.init(api);
  attachFight(api);
  Drops.register(api);
  const session = {
    player,
    awakened,
    ended: false,
    area: { getBaseX: () => 1112, getBaseY: () => 3400 },
    tile: ([x, y, z]) => new Location(x, y, z),
  };
  const fight = new Fight(session, boss);
  session.fight = fight;
  boss.__vardorvisFight = fight;
  return { player, boss, fight, session, api };
}

test("the awakened fight is immune to stat drains; the normal one is not", () => {
  assert.equal(fixture({ awakened: true }).boss.drainImmune, true);
  assert.equal(fixture({ awakened: false }).boss.drainImmune, false);
});

test("awakened kills are excluded from Slayer credit and equipment task checks", () => {
  const awakened = fixture({ awakened: true });
  const eligible = { player: awakened.player, npc: awakened.boss, eligible: true };
  awakened.api.emitCustomEvent("slayer:target-eligible", eligible);
  assert.equal(eligible.eligible, false);

  const normal = fixture({ awakened: false });
  const ordinary = { player: normal.player, npc: normal.boss, eligible: true };
  normal.api.emitCustomEvent("slayer:target-eligible", ordinary);
  assert.equal(ordinary.eligible, true);
});

test("an awakened kill rolls the unique stage 3/136, a normal kill 1/136", (t) => {
  const normal = fixture({ awakened: false });
  const normalRules = [];
  normal.api.emitCustomEvent("npc-drops:chance", { player: normal.player, npc: normal.boss, rules: normalRules });
  assert.deepEqual(normalRules, [], "a normal kill adds no stage rule");

  const awakened = fixture({ awakened: true });
  const awakenedRules = [];
  awakened.api.emitCustomEvent("npc-drops:chance", { player: awakened.player, npc: awakened.boss, rules: awakenedRules });
  assert.deepEqual(awakenedRules.map((rule) => [rule.pattern.source, rule.multiplier]), [[`^${UNIQUE_STAGE}$`, 3]]);
  assert.equal(dropChance({ npc: awakened.boss, rules: [] }), undefined, "the rule is the observable result");
});

test("the stage rule is what turns the unique table 1/136 into 3/136", (t) => {
  // 0.02 * 136 = 2.72: past 1/136 and short of 3/136.
  t.mock.method(Math, "random", () => 0.02);
  const table = {
    table_id: "vardorvis-awakened-test",
    wiki_page: "Vardorvis",
    boss: false,
    entries: [],
    reward_chain: {
      type: "ordered_exclusive",
      state_domain: "vardorvis-awakened-test",
      stages: [{
        key: UNIQUE_STAGE,
        weight: 1,
        out_of: 136,
        main_max_roll: 1,
        entries: [{ item_id: 1607, name: "Sapphire", quantity: [7, 7], weight: 1 }],
      }],
    },
  };
  const roll = (f) => {
    f.api.onCustomEvent("npc-drops:reward-state", (event) => { event.state = {}; event.handled = true; });
    f.api.onCustomEvent("npc-drops:reward-state-commit", (event) => { event.committed = true; });
    return Drops.__internals.rollTable(table, f.player, f.boss);
  };

  assert.deepEqual(roll(fixture({ awakened: false })), []);
  assert.deepEqual(roll(fixture({ awakened: true })), [{ itemId: 1607, amount: 7, noted: false }]);
});
