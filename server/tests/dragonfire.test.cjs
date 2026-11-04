// Run with: node --test server/tests/dragonfire.test.cjs (after yarn build)
// Regular dragonfire against players: Wiki Dragonfire damage table + rsprox capture messages.
const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
const Dragonfire = require("../plugins/combat/DragonfireProtection");
const { DragonfireProtectionTier: Tier } = Dragonfire;

const { CombatEquipment, PrayerHandler, AccuracyFormulasDpsCalc, Item, ChatType } = core;
const original = {
  hasDragonProtectionGear: CombatEquipment.hasDragonProtectionGear,
  isActivated: PrayerHandler.isActivated,
  rollAccuracy: AccuracyFormulasDpsCalc.rollAccuracy,
  random: Math.random,
  now: Date.now,
};
let shield = false;
let prayer = false;
let accurate = false;

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(path.resolve(__dirname, ".."));
  CombatEquipment.hasDragonProtectionGear = () => shield;
  PrayerHandler.isActivated = (_player, id) => prayer && id === PrayerHandler.PROTECT_FROM_MAGIC;
  AccuracyFormulasDpsCalc.rollAccuracy = () => accurate;
  Dragonfire.initDragonfireProtectionCoreAccess({ core, getPrayerHandler: () => PrayerHandler, emitCustomEvent() {} });
});

after(() => {
  CombatEquipment.hasDragonProtectionGear = original.hasDragonProtectionGear;
  PrayerHandler.isActivated = original.isActivated;
  AccuracyFormulasDpsCalc.rollAccuracy = original.rollAccuracy;
  Math.random = original.random;
  Date.now = original.now;
});

function player({ potion = Tier.NONE, shieldId = -1 } = {}) {
  const attrs = new Map();
  const messages = [];
  const timer = { finished: () => true, start() {}, stop() {}, secondsRemaining: () => 0 };
  const p = {
    messages,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getCombat: () => ({ getFireImmunityTimer: () => timer }),
    getEquipment: () => ({ get: (slot) => new Item(slot === 5 ? shieldId : -1) }),
    sendMessage: (text) => messages.push({ text, spam: false }),
    getPacketSender: () => ({
      sendMessage: (text) => messages.push({ text, spam: false }),
      sendTypedMessage: (type, text) => messages.push({ text, spam: type === ChatType.SPAM }),
    }),
  };
  if (potion) {
    Dragonfire.setDragonfireProtection(p, { tier: potion, seconds: 360, label: potion === Tier.SUPER_ANTIFIRE ? "super antifire potion" : "antifire potion" });
  }
  return p;
}

/** Highest and lowest damage for one protection setup, with Math.random pinned to each end. */
function range(setup, options = {}) {
  ({ shield = false, prayer = false, accurate = false } = setup);
  const target = player({ potion: setup.potion });
  try {
    Math.random = () => 0.999999;
    const high = Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50, ...options }).damage;
    Math.random = () => 0;
    const low = Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50, ...options }).damage;
    return [low, high];
  } finally {
    Math.random = original.random;
  }
}

test("chromatic dragonfire max hits follow the Wiki damage table", () => {
  assert.deepEqual(range({ accurate: false }), [0, 50], "unprotected, failed accuracy roll");
  assert.deepEqual(range({ accurate: true }), [0, 30], "unprotected, won accuracy roll");
  assert.deepEqual(range({ shield: true }), [0, 5], "anti-dragon shield");
  assert.deepEqual(range({ prayer: true }), [0, 10], "Protect from Magic");
  assert.deepEqual(range({ shield: true, prayer: true }), [0, 5], "shield and Protect from Magic");
  assert.deepEqual(range({ potion: Tier.ANTIFIRE, accurate: false }), [0, 35], "antifire, failed roll");
  assert.deepEqual(range({ potion: Tier.ANTIFIRE, accurate: true }), [0, 15], "antifire, won roll");
  assert.deepEqual(range({ potion: Tier.SUPER_ANTIFIRE }), [0, 0], "super antifire");
  assert.deepEqual(range({ shield: true, potion: Tier.ANTIFIRE }), [0, 0], "shield and antifire");
  assert.deepEqual(range({ prayer: true, potion: Tier.ANTIFIRE }), [0, 0], "Protect from Magic and antifire");
});

test("metallic dragonfire ignores Protect from Magic", () => {
  assert.deepEqual(range({ prayer: true, accurate: false }, { prayerProtects: false }), [0, 50]);
  assert.deepEqual(range({ prayer: true, shield: true }, { prayerProtects: false }), [0, 5]);
});

test("registered chromatic and metallic providers keep their custom prayer damage through impact", () => {
  const registered = [];
  require("../plugins/npcs/Dragons.plugin").register({
    core,
    getPrayerHandler: () => PrayerHandler,
    getCombatFactory: () => core.CombatFactory,
    emitCustomEvent() {},
    registerNpcCombatMethodProvider: (_ids, method) => registered.push(method),
  });
  const [Chromatic, , Metallic] = registered;
  const originalBounds = core.DamageFormulas.sourceHitBounds;
  const originalRandomInclusive = core.Misc.randomInclusive;
  const originalGear = CombatEquipment.hasDragonProtectionGear;
  core.DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  core.Misc.randomInclusive = (_min, max) => max;
  CombatEquipment.hasDragonProtectionGear = () => false;
  ({ shield = false, prayer = true, accurate = false } = {});
  try {
    const victim = player();
    Object.assign(victim, {
      isPlayer: () => true,
      getHitpoints: () => 99,
      getAsPlayer: () => victim,
      getEquipment: () => ({ getItems: () => Array.from({ length: 14 }, () => ({ getId: () => -1 })) }),
      performGraphic() {},
      getLocation: () => new core.Location(3200, 3205, 0),
      getSize: () => 1,
    });
    const attacker = {
      isPlayer: () => false, isNpc: () => true, isRegistered: () => true, getHitpoints: () => 100,
      getLocation: () => new core.Location(3200, 3200, 0), getSize: () => 1,
    };
    const breath = (Method) => {
      const method = new Method();
      method.useDragonfire = true;
      method.currentAttackType = core.CombatType.MAGIC;
      const [pending] = method.hits(attacker, victim);
      core.CombatFactory.applyHitTimeDefences(pending);
      return pending;
    };
    assert.equal(breath(Chromatic).getTotalDamage(), 10, "chromatic prayer leaves its 0-10 table, not a second prayer cut");
    accurate = false;
    assert.equal(breath(Metallic).getTotalDamage(), 50, "metallic ignores prayer and keeps its custom 0-50 breath");
  } finally {
    core.DamageFormulas.sourceHitBounds = originalBounds;
    core.Misc.randomInclusive = originalRandomInclusive;
    CombatEquipment.hasDragonProtectionGear = originalGear;
  }
});

test("antifire is subtracted after the damage roll", () => {
  ({ shield, prayer, accurate } = { shield: false, prayer: false, accurate: false });
  const target = player({ potion: Tier.ANTIFIRE });
  try {
    Math.random = () => 20 / 51; // rolls 20 of 0-50
    assert.equal(Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50 }).damage, 5);
    Math.random = () => 14 / 51; // rolls 14: fully absorbed
    assert.equal(Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50 }).damage, 0);
  } finally {
    Math.random = original.random;
  }
});

test("dragonfire hits when the breath lands, at every range (#1862)", () => {
  const registered = [];
  require("../plugins/npcs/Dragons.plugin").register({
    core,
    getPrayerHandler: () => PrayerHandler,
    getCombatFactory: () => core.CombatFactory,
    emitCustomEvent() {},
    registerNpcCombatMethodProvider: (_ids, method) => registered.push(method),
  });
  const Brutal = registered[1];
  const originalCreate = core.Projectile.createProjectile;
  const originalBounds = core.DamageFormulas.sourceHitBounds;
  core.DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  const sent = [];
  core.Projectile.createProjectile = (_source, _victim, id, delay, end) => ({ sendProjectile: () => sent.push({ id, delay, end }) });
  ({ shield = false, prayer = false, accurate = false } = {});
  try {
    for (const [tiles, end, ticks] of [[2, 65, 3], [5, 95, 4], [8, 125, 5]]) {
      const victim = player();
      Object.assign(victim, {
        isPlayer: () => true,
        getAsPlayer: () => victim,
        getHitpoints: () => 99,
        getLocation: () => new core.Location(3200, 3200 + tiles, 0),
        getSize: () => 1,
      });
      const dragon = {
        isPlayer: () => false, isNpc: () => true, isRegistered: () => true, getHitpoints: () => 100, performAnimation() {},
        calculateDistance: () => tiles,
        getLocation: () => new core.Location(3200, 3200, 0), getSize: () => 1,
      };
      const method = new Brutal();
      sent.length = 0;
      method.start(dragon, victim);
      assert.deepEqual(sent, [{ id: 393, delay: 40, end }], `${tiles} tiles: 45 + 10 a tile`);
      const [pending] = method.hits(dragon, victim);
      assert.equal(pending.getDelay(), ticks, `${tiles} tiles: hit as it lands`);
      assert.equal(pending.getDelay(), core.Projectile.ticksToLand(end));
    }
  } finally {
    core.Projectile.createProjectile = originalCreate;
    core.DamageFormulas.sourceHitBounds = originalBounds;
  }
});

function messagesFor(setup) {
  ({ shield = false, prayer = false, accurate = false } = setup);
  const target = player({ potion: setup.potion });
  const result = Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50 });
  Dragonfire.sendDragonfireMessages(target, result.messages);
  return target.messages;
}

test("each protection layer sends the captured message", () => {
  assert.deepEqual(messagesFor({ accurate: true }), [{ text: "You manage to resist some of the dragon fire!", spam: false }]);
  assert.deepEqual(messagesFor({ accurate: false }), [{ text: "You're horribly burnt by the dragon fire!", spam: false }]);
  assert.deepEqual(messagesFor({ shield: true }), [{ text: "Your shield absorbs most of the dragon fire!", spam: true }]);
  assert.deepEqual(messagesFor({ prayer: true }), [{ text: "Your prayers resist some of the dragon fire!", spam: true }]);
  assert.deepEqual(messagesFor({ shield: true, potion: Tier.ANTIFIRE }), [
    { text: "Your shield absorbs most of the dragon fire!", spam: true },
    { text: "Your antifire potion helps to protect you from the dragon's breath!", spam: true },
  ]);
  assert.deepEqual(messagesFor({ accurate: false, potion: Tier.ANTIFIRE }), [
    { text: "You're horribly burnt by the dragon fire!", spam: false },
    { text: "Your antifire potion helps to protect you from the dragon's breath!", spam: true },
  ]);
  assert.deepEqual(messagesFor({ shield: true, potion: Tier.SUPER_ANTIFIRE }), [
    { text: "Your super antifire potion completely protects you from the dragon fire!", spam: true },
  ]);
});

test("every wearable anti-dragon shield variant protects", () => {
  CombatEquipment.hasDragonProtectionGear = original.hasDragonProtectionGear;
  try {
    const { ItemIdentifiers: Ids } = core;
    for (const id of [
      Ids.ANTI_DRAGON_SHIELD, Ids.ANTI_DRAGON_SHIELD_NZ_,
      Ids.DRAGONFIRE_SHIELD, Ids.DRAGONFIRE_SHIELD_2,
      Ids.DRAGONFIRE_WARD, Ids.DRAGONFIRE_WARD_2,
      Ids.ANCIENT_WYVERN_SHIELD, Ids.ANCIENT_WYVERN_SHIELD_2,
    ]) {
      assert.equal(CombatEquipment.hasDragonProtectionGear(player({ shieldId: id })), true, `item ${id}`);
    }
    assert.equal(CombatEquipment.hasDragonProtectionGear(player({ shieldId: Ids.RUNE_KITESHIELD })), false);
    assert.equal(CombatEquipment.hasDragonProtectionGear(player()), false);
  } finally {
    CombatEquipment.hasDragonProtectionGear = () => shield;
  }
});

test("expiry warnings come 30 ticks (antifire) and 20 ticks (super antifire) before the end", () => {
  let now = 1_000_000;
  Date.now = () => now;
  try {
    for (const [tier, label, warnTicks] of [[Tier.ANTIFIRE, "antifire potion", 30], [Tier.SUPER_ANTIFIRE, "super antifire potion", 20]]) {
      const target = player();
      Dragonfire.setDragonfireProtection(target, { tier, seconds: 360, label });
      const end = now + 360_000;
      now = end - (warnTicks + 1) * 600;
      Dragonfire.processDragonfireProtection(target);
      assert.deepEqual(target.messages, [], `${label}: no warning ${warnTicks + 1} ticks out`);
      now = end - warnTicks * 600;
      Dragonfire.processDragonfireProtection(target);
      assert.deepEqual(target.messages.map((m) => m.text), [`<col=7f007f>Your ${label} is about to expire.</col>`]);
      now = end;
      Dragonfire.processDragonfireProtection(target);
      assert.equal(target.messages[1].text, `<col=7f007f>Your ${label} has expired.</col>`);
    }
  } finally {
    Date.now = original.now;
  }
});

test("the expiry notice is sent once, even when dragonfire resolves on the expiry tick first", () => {
  let now = 1_000_000;
  Date.now = () => now;
  ({ shield = false, prayer = false, accurate = false } = {});
  const expired = "<col=7f007f>Your antifire potion has expired.</col>";
  const notices = (target) => target.messages.filter((m) => m.text === expired).length;
  try {
    const plain = player({ potion: Tier.ANTIFIRE });
    now += 360_000;
    Dragonfire.processDragonfireProtection(plain);
    Dragonfire.processDragonfireProtection(plain);
    assert.equal(notices(plain), 1, "player processing alone");
    assert.equal(Dragonfire.getDragonfireProtectionTier(plain), Tier.NONE);

    now = 1_000_000;
    const attacked = player({ potion: Tier.ANTIFIRE });
    now += 360_000;
    const { messages } = Dragonfire.resolveChromaticDragonfireDamage({}, attacked, { maxHit: 50 });
    assert.ok(!messages.some((m) => m.text.startsWith("Your antifire potion helps")), "protection has ended");
    Dragonfire.processDragonfireProtection(attacked);
    assert.equal(notices(attacked), 1, "dragonfire resolved before player processing");
  } finally {
    Date.now = original.now;
  }
});

test("every breath on a player, super antifire included, lets a worn shield add its lines", () => {
  const seen = [];
  const emitCustomEvent = (name, event) => {
    if (name !== Dragonfire.DRAGONFIRE_BREATH_EVENT) return;
    seen.push(event.player);
    event.messages.push({ text: "Your dragonfire shield glows more brightly.", spam: true });
  };
  Dragonfire.initDragonfireProtectionCoreAccess({ core, getPrayerHandler: () => PrayerHandler, emitCustomEvent });
  try {
    ({ shield, prayer, accurate } = { shield: true, prayer: false, accurate: false });
    const target = player();
    const { messages } = Dragonfire.resolveChromaticDragonfireDamage({}, target, { maxHit: 50 });
    assert.deepEqual(messages.map((line) => line.text), [
      "Your shield absorbs most of the dragon fire!",
      "Your dragonfire shield glows more brightly.",
    ]);
    const immune = player({ potion: Tier.SUPER_ANTIFIRE });
    const superMessages = Dragonfire.resolveChromaticDragonfireDamage({}, immune, { maxHit: 50 }).messages;
    assert.equal(superMessages.at(-1).text, "Your dragonfire shield glows more brightly.");
    assert.deepEqual(seen, [target, immune]);
  } finally {
    shield = false;
    Dragonfire.initDragonfireProtectionCoreAccess({ core, getPrayerHandler: () => PrayerHandler, emitCustomEvent() {} });
  }
});
