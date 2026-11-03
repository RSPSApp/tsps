// Run after `yarn build`: node --test tests/skotizo.test.cjs
// Skotizo (Wiki: Skotizo, Dark totem, Ancient shard, Awakened Altar): his drop table, the totem
// pieces and shards from the Catacombs, and the altars' damage reduction.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
const Common = require("../plugins/bosses/skotizo/Common.Skotizo");
const Totems = require("../plugins/bosses/skotizo/Totems.Skotizo");
const { Fight, _test: FightTest } = require("../plugins/bosses/skotizo/Fight.Skotizo");
const CombatAchievements = require("../plugins/bosses/skotizo/CombatAchievements.Skotizo");

const BASE = 19679;
const MIDDLE = 19681;
const TOP = 19683;
const TOTEM = 19685;
const SHARD = 19677;
const WEAPON_SLOT = 3;

const emitted = [];
before(() => {
  __internals.loadDrops();
  Common.init({
    core: {
      ItemIdentifiers: { DARK_TOTEM_BASE: BASE, DARK_TOTEM_MIDDLE: MIDDLE, DARK_TOTEM_TOP: TOP, DARK_TOTEM: TOTEM, ANCIENT_SHARD: SHARD },
      Equipment: { WEAPON_SLOT },
    },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
});

function player({ inventory = {}, bank = {}, weapon = null } = {}) {
  const container = (items) => ({ getAmount: (id) => items[id] ?? 0 });
  const worn = [];
  worn[WEAPON_SLOT] = weapon ? { isValid: () => true, getDefinition: () => ({ getName: () => weapon }) } : null;
  return {
    getInventory: () => container(inventory),
    getBanks: () => [container(bank)],
    getEquipment: () => ({ getItems: () => worn }),
    getAttribute: () => undefined,
    isPlayer: () => true,
    getAsPlayer() { return this; },
  };
}

function npc(name, x, y, hitpoints = 100) {
  const definition = { getName: () => name, getHitpoints: () => hitpoints };
  return {
    getLocation: () => new Location(x, y, 0),
    getDefinition: () => definition,
    getCurrentDefinition: () => definition,
    getMaxHitpoints: () => hitpoints,
  };
}

function withRandom(value, action) {
  const random = Math.random;
  Math.random = () => value;
  try {
    return action();
  } finally {
    Math.random = random;
  }
}

const skotizoTable = () => __internals.tablesByNpc.get(7286)[0];

test("Skotizo always drops one roll of ancient shards on top of his main table", () => {
  const table = skotizoTable();
  assert.equal(table.main_max_roll, 100);
  for (const [roll, shards] of [[0, 1], [0.8, 2], [0.92, 3], [0.97, 4], [0.995, 5]]) {
    const drops = withRandom(roll, () => __internals.rollTable(table, player(), null));
    const shardDrops = drops.filter((drop) => drop.itemId === SHARD);
    assert.equal(shardDrops.length, 1, `roll ${roll}`);
    assert.equal(shardDrops[0].amount, shards, `roll ${roll}`);
  }
});

test("his flat totem tertiaries are gone: the plugin rolls his totem table", () => {
  const ids = (skotizoTable().tertiary || []).map((entry) => entry.item_id);
  for (const id of [BASE, MIDDLE, TOP, TOTEM]) assert.equal(ids.includes(id), false);
});

test("a totem piece is the one the player has fewest of, base first on a tie", () => {
  const { nextPiece } = Totems._test;
  assert.equal(nextPiece(player()), BASE);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 1 } })), MIDDLE);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 1 }, bank: { [MIDDLE]: 1 } })), TOP);
  assert.equal(nextPiece(player({ inventory: { [BASE]: 2, [MIDDLE]: 1, [TOP]: 1 } })), MIDDLE);
});

test("Catacombs monsters but ghosts drop totem pieces and shards; elsewhere they don't", () => {
  const { addDrops } = Totems._test;
  const roll = (monster) => {
    const event = { player: player(), npc: monster, npcId: 1, drops: [] };
    withRandom(0, () => addDrops(event));
    return event.drops.map((drop) => drop.itemId);
  };
  assert.deepEqual(roll(npc("Hill Giant", 1660, 10040, 35)), [BASE, SHARD]);
  assert.deepEqual(roll(npc("Hill Giant", 1430, 9880, 35)), [BASE, SHARD], "Giants' Den");
  assert.deepEqual(roll(npc("Ghost", 1660, 10040, 25)), []);
  assert.deepEqual(roll(npc("Hill Giant", 3117, 9845, 35)), [], "Edgeville Dungeon");
});

test("each awake altar takes 25% off, 15% up to 60% with Arclight or Emberlight", () => {
  const fight = new Fight({ player: player() });
  for (const side of ["w", "e", "s", "n"]) fight.altars.set(side, { side, awake: false });
  const wake = (count) => [...fight.altars.values()].forEach((altar, index) => { altar.awake = index < count; });
  wake(0);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 0);
  wake(2);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 50);
  assert.equal(fight.reductionPercent(player({ weapon: "Arclight" })), 30);
  wake(4);
  assert.equal(fight.reductionPercent(player({ weapon: "Abyssal whip" })), 100);
  assert.equal(fight.reductionPercent(player({ weapon: "Emberlight" })), 60);
});

test("the altars' share comes off the max hit, so a low Skotizo can still be finished", () => {
  const fight = new Fight({ player: player() });
  fight.boss = { __skotizoLair: { fight } };
  for (const side of ["w", "e", "s", "n"]) fight.altars.set(side, { side, awake: false });
  [...fight.altars.values()].slice(0, 3).forEach((altar) => { altar.awake = true; });
  const attacker = (weapon, target) => ({ ...player({ weapon }), getCombat: () => ({ getTarget: () => target }) });
  assert.equal(FightTest.altarMaxHit(attacker("Abyssal whip", fight.boss), 40), 10);
  assert.equal(FightTest.altarMaxHit(attacker("Emberlight", fight.boss), 40), 22);
  assert.equal(FightTest.altarMaxHit(attacker("Abyssal whip", { }), 40), 40, "anything but Skotizo");
});

function achievementHitHook() {
  let resolved;
  CombatAchievements.attachCombatAchievements({
    onCombatHitResolved: (handler) => { resolved = handler; },
    onNpcHitModify() {},
    onCustomEvent() {},
  });
  return resolved;
}

test("Skotizo damage achievements ignore unrelated player fights, even those with their own stats", () => {
  const resolved = achievementHitHook(), target = player();
  const hit = { getTotalDamage: () => 12 };
  for (const fight of [{ player: target, stopped: false }, { player: target, stopped: false, stats: { damageTaken: 0 } }]) {
    target.getArea = () => ({ session: { fight } });
    assert.doesNotThrow(() => resolved({ target, hit }), "another boss's area must not enter Skotizo tracking");
    if (fight.stats) assert.equal(fight.stats.damageTaken, 0);
  }
  target.getArea = () => null;
  assert.doesNotThrow(() => resolved({ target, hit }));
  assert.doesNotThrow(() => resolved({ target: { isPlayer: () => false }, hit }));
});

test("Skotizo damage achievements still track positive hits only for their active fight's own player", () => {
  const resolved = achievementHitHook(), target = player(), fight = new Fight({ player: target });
  const area = { session: { fight } };
  target.getArea = () => area;
  const hit = (damage) => ({ getTotalDamage: () => damage });
  resolved({ target, hit: hit(12) });
  resolved({ target, hit: hit(0) });
  assert.equal(fight.stats.damageTaken, 12);
  const other = { ...player(), getArea: () => area };
  resolved({ target: other, hit: hit(7) });
  fight.stopped = true;
  resolved({ target, hit: hit(9) });
  assert.equal(fight.stats.damageTaken, 12, "stopped fights and another player cannot change the total");
  const before = emitted.length;
  CombatAchievements.judge(fight);
  assert.equal(emitted.slice(before).some(({ payload }) => payload.task === "Demon Evasion"), false);
});

test("the hellfire burst's hit lands on the tick the projectile does (#1862)", () => {
  const { Projectile } = require("../dist/game/model/Projectile");
  const previous = Common.core;
  const sent = [];
  class FakeProjectile {
    constructor(...args) { sent.push(args); }
    withAngle() { return this; }
    withProgress() { return this; }
    sendProjectile() {}
  }
  FakeProjectile.ticksToLand = Projectile.ticksToLand;
  Common.init({
    core: {
      ...previous,
      Location,
      Animation: class {},
      Graphic: class {},
      PendingHit: class { constructor(attacker, target, method, delay) { this.delay = delay; } },
      Projectile: FakeProjectile,
    },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
  try {
    const fight = new Fight({ player: player(), area: null });
    fight.boss = { getLocation: () => new Location(1690, 9880, 0), getSize: () => 5, performAnimation: () => {} };
    for (const tiles of [1, 4, 9]) {
      sent.length = 0;
      const target = {
        getLocation: () => new Location(1692 + tiles, 9882, 0),
        performGraphicInSlot: () => {},
        getPacketSender: () => ({ sendAreaSound: () => {} }),
      };
      const [hit] = fight.magic(target);
      const end = sent[0][5];
      assert.equal(end, Math.max(70, 30 + 10 * tiles), `${tiles} tiles: captured end`);
      assert.equal(hit.delay, Projectile.ticksToLand(end), `${tiles} tiles`);
      assert.ok(hit.delay * 30 >= end, `${tiles} tiles: no splat before the burst lands`);
    }
  } finally {
    Common.init({ core: previous, emitCustomEvent: (name, payload) => emitted.push({ name, payload }) });
  }
});
