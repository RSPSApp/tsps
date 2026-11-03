// Run after `yarn build`: node --test tests/thrown-weapons.test.cjs
// Darts, throwing knives, throwing axes, chinchompas and the toxic blowpipe: specials, area hits,
// ammunition use. Hits are built with the real PendingHit; only its damage roll is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Ammunition, RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { RangedCombatMethod } = require("../dist/game/content/combat/method/impl/RangedCombatMethod");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { WeaponProfiles } = require("../dist/game/content/combat/WeaponProfile");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");
const { Projectile } = require("../dist/game/model/Projectile");
const { BonusManager } = require("../dist/game/model/equipment/BonusManager");
const { Sounds } = require("../dist/game/Sounds");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { Misc } = require("../dist/util/Misc");

const core = PluginManager.getCoreApi();
// Kept from before any test mocks so the real Tonalztics firing tests never inherit a no-op start.
const REAL_RANGED_START = RangedCombatMethod.prototype.start;
const REAL_DECREMENT_AMMO = CombatFactory.decrementAmmo;
const specialApi = { core, registerCombatSpecial: CombatSpecial.register, getBonusManager: () => BonusManager,
  emitCustomEvent: PluginManager.emitCustomEvent };

const gameplay = new Map(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/definitions/item-gameplay.json"), "utf8")).map((row) => [row.id, row]),
);
const WEAPON = Equipment.WEAPON_SLOT;

/** Keeps projectiles, sounds and special-bar packets out of the way and records special drains. */
function quiet(t) {
  const drains = [];
  t.mock.method(Projectile, "createProjectile", () => ({ withAngle() { return this; }, withProgress() { return this; }, sendProjectile() {} }));
  t.mock.method(Sounds, "sendSound", () => {});
  t.mock.method(CombatSpecial, "drain", (character, amount) => {
    drains.push(amount);
    character.special -= amount;
  });
  return drains;
}

/** Every PendingHit's accuracy comes off `outcomes` (true when its roll is skipped). */
function stubRolls(t, outcomes = []) {
  const rolled = [];
  t.mock.method(PendingHit.prototype, "prepareHits", function (amount, rollAccuracy) {
    rolled.push(rollAccuracy);
    this.accurate = rollAccuracy === false ? true : outcomes.length > 0 ? outcomes.shift() : true;
    return [];
  });
  return rolled;
}

function mobile(x, y, extra = {}) {
  return {
    isPlayer: () => false,
    isNpc: () => true,
    getLocation: () => new Location(x, y, 0),
    ...extra,
  };
}

function wielding(weapon, extra = {}) {
  const items = new Map([[WEAPON, weapon]]);
  const equipment = {
    get: (slot) => items.get(slot) ?? new Item(-1, 0),
    set: (slot, item) => items.set(slot, item),
    refreshItems() {},
  };
  const player = {
    special: 100,
    flags: [],
    messages: [],
    isPlayer: () => true,
    getAsPlayer: () => player,
    getLocation: () => new Location(3200, 3200, 0),
    getEquipment: () => equipment,
    getSpecialPercentage: () => player.special,
    getBaseAttackSpeed: () => 5,
    getUpdateFlag: () => ({ flag: (flag) => player.flags.push(flag) }),
    sendMessage: (message) => player.messages.push(message),
    performAnimation() {},
    performGraphic() {},
    ...extra,
  };
  return player;
}

// ------------------------------------------------------------------ darts

const DARTS = {
  [ItemIdentifiers.BRONZE_DART]: 1,
  [ItemIdentifiers.IRON_DART]: 2,
  [ItemIdentifiers.STEEL_DART]: 3,
  [ItemIdentifiers.BLACK_DART]: 6,
  [ItemIdentifiers.MITHRIL_DART]: 9,
  [ItemIdentifiers.ADAMANT_DART]: 17,
  [ItemIdentifiers.RUNE_DART]: 26,
  [ItemIdentifiers.AMETHYST_DART]: 28,
  [ItemIdentifiers.DRAGON_DART]: 35,
};

test("darts carry the Wiki ranged strength and no ranged attack bonus", () => {
  for (const [id, strength] of Object.entries(DARTS)) {
    const bonuses = gameplay.get(Number(id)).bonuses;
    assert.equal(bonuses[BonusManager.ATTACK_RANGE], 0, `item ${id} attack`);
    assert.equal(bonuses[10 + BonusManager.RANGED_STRENGTH], strength, `item ${id} strength`);
    assert.equal(Ammunition.getForItem(Number(id)).getStrength(), strength, `ammunition ${id}`);
  }
});

test("black and amethyst darts can be thrown, with their own cache spotanims", () => {
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.BLACK_DART), Ammunition.BLACK_DART);
  assert.equal(RangedWeapon.getSelfAmmo(ItemIdentifiers.AMETHYST_DART), Ammunition.AMETHYST_DART);
  assert.equal(Ammunition.AMETHYST_DART.getProjectileId(), 1936);
  assert.equal(Ammunition.DRAGON_DART.getProjectileId(), 1122);
  assert.equal(Ammunition.BLACK_DART.getProjectileId(), 34);
});

test("no dart has a special attack, so its special bar stays hidden and the special stays off", (t) => {
  require("../plugins/combat/SpecialAttacks.plugin").register(new Proxy(specialApi, {
    get: (target, name) => (name in target ? target[name] : () => ({})),
  }));
  const hidden = [];
  for (const id of Object.keys(DARTS)) {
    assert.equal(CombatSpecial.getForWeaponId(Number(id)), null, `item ${id} has no special`);
    const player = wielding(new Item(Number(id), 10), {
      special: 100,
      getWeapon: () => WeaponInterfaces.DART,
      setCombatSpecial(special) { player.combatSpecial = special; },
      setSpecialActivated(on) { player.activated = on; },
      getPacketSender: () => ({
        sendInterfaceDisplayState: (widget, hide) => hidden.push([widget, hide]),
        sendSpecialAttackState: () => {},
      }),
    });
    player.activated = true;
    CombatSpecial.assign(player);
    assert.equal(player.combatSpecial, null);
    assert.equal(player.activated, false, "a stale special is switched off");
  }
  assert.ok(hidden.length === Object.keys(DARTS).length && hidden.every(([, hide]) => hide === true));
  assert.equal(WeaponInterfaces.DART.getSpecialBar(), hidden[0][0]);
});

// ------------------------------------------------------------------ throwing knives

test("Duality throws two knives that roll separately, for 25% energy and two knives", (t) => {
  const drains = quiet(t);
  const rolled = stubRolls(t);
  t.mock.method(WeaponProfiles, "hitDelays", () => [2]);
  const consumed = [];
  t.mock.method(CombatFactory, "decrementAmmo", (player, pos, amount) => consumed.push(amount));
  t.mock.method(CombatFactory, "checkAmmo", () => true);
  require("../plugins/combat/specials/DragonKnife.SpecialAttack")(specialApi);

  const special = CombatSpecial.getById("dragon_knife");
  for (const id of [ItemIdentifiers.DRAGON_KNIFE, ItemIdentifiers.DRAGON_KNIFE_P_, ItemIdentifiers.DRAGON_KNIFE_P_PLUS_, ItemIdentifiers.DRAGON_KNIFE_P_PLUS_PLUS_]) {
    assert.equal(CombatSpecial.getForWeaponId(id), special, `item ${id}`);
  }
  const player = wielding(new Item(ItemIdentifiers.DRAGON_KNIFE, 50));
  const target = mobile(3203, 3200);
  const method = special.getCombatMethod();

  assert.equal(method.canAttack(player, target), true);
  assert.equal(method.canAttack(wielding(new Item(ItemIdentifiers.RUNE_KNIFE, 50)), target), false, "only dragon knives");
  method.start(player, target);
  const hits = method.hits(player, target);

  assert.deepEqual(drains, [25], "energy drains exactly once");
  assert.equal(player.special, 75);
  assert.deepEqual(consumed, [2]);
  assert.equal(hits.length, 2);
  assert.equal(rolled.length, 2, "each knife has its own accuracy and damage roll");
  assert.deepEqual(hits.map((hit) => hit.getDelay()), [2, 2]);
});

// ------------------------------------------------------------------ throwing axes

test("Momentum Throw costs 25% energy and bypasses the attack delay", () => {
  require("../plugins/combat/specials/DragonThrownaxe.SpecialAttack")(specialApi);
  const special = CombatSpecial.getById("dragon_thrownaxe");
  assert.equal(special.getDrainAmount(), 25);
  assert.equal(special.getTraits().accuracyMultiplier, 1.25);
  assert.equal(special.getTraits().bypassAttackDelay, true);
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.DRAGON_THROWNAXE), special);
});

/** A rune-axe wielder with `bounceTargets` possible opponents standing around the first target. */
function chainhitScene(t, { multi = true, special = 100, outcomes = [], bounceTargets = 6 } = {}) {
  const drains = quiet(t);
  t.mock.method(Misc, "randomElement", (candidates) => candidates[0]);
  const rolled = stubRolls(t, outcomes);
  const axe = new Item(ItemIdentifiers.RUNE_THROWNAXE, 100);
  axe.getDefinition = () => ({ getBonuses: () => [0, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 36, 0, 0] });
  const target = mobile(3205, 3200);
  const others = Array.from({ length: bounceTargets }, (_, index) => mobile(3205 + (index % 3) - 1, 3201 + Math.floor(index / 3)));
  const far = mobile(3210, 3200);
  const player = wielding(axe, {
    special,
    getSkillManager: () => ({ getCurrentLevel: () => 99 }),
    getCombat: () => ({ getAmmunition: () => Ammunition.RUNE_THROWNAXE }),
    getLocalNpcs: () => new Map([[1, target], [2, far], ...others.map((other, index) => [index + 3, other])]),
    getLocalPlayers: () => new Map(),
  });
  const styled = [];
  t.mock.method(CombatFactory, "multiCombatBetween", () => multi);
  t.mock.method(CombatFactory, "applyStyleDamage", (hit, maxHit) => styled.push([hit.getTarget(), maxHit]));
  t.mock.method(CombatFactory, "canAttackSecondaryTarget", (attacker, primary, candidate, radius) =>
    candidate !== primary && candidate.getLocation().getDistance(primary.getLocation()) <= radius);
  require("../plugins/combat/specials/RuneThrownaxe.SpecialAttack")(specialApi);
  const method = CombatSpecial.getById("rune_thrownaxe").getCombatMethod();
  t.mock.method(WeaponProfiles, "ranged", () => ({ projectiles: [{ delay: 32, lengthAdjustment: 0, stepMultiplier: 5 }] }));
  t.mock.method(CombatFactory, "decrementAmmo", () => {});
  t.mock.method(WeaponProfiles, "hitDelays", () => [1]);
  t.mock.method(RangedCombatMethod.prototype, "start", () => {});
  t.mock.method(RangedCombatMethod.prototype, "hits", () => [new PendingHit(player, target, method, 1)]);
  return { player, target, others, method, drains, styled, rolled };
}

test("Chainhit hits five targets total, never back to the first, for at most 50% energy", (t) => {
  const { player, target, method, drains, styled } = chainhitScene(t);
  method.start(player, target);
  const hits = method.hits(player, target);

  assert.equal(hits.length, 5);
  assert.deepEqual(hits.map((hit) => hit.getDelay()), [1, 3, 4, 4, 5]);
  const struck = hits.map((hit) => hit.getTarget());
  assert.equal(new Set(struck).size, 5, "nobody is hit twice");
  assert.equal(struck[0], target);
  assert.ok(struck.every((mob) => mob.getLocation().getDistance(target.getLocation()) <= 3), "within three tiles");
  assert.deepEqual(drains, [10, 10, 10, 10, 10], "10% for the throw and each of four bounces");
  // Wiki: floor(0.5 + (99 + 10) * (36 + 64) / 640)
  assert.ok(styled.length === 5 && styled.every(([, maxHit]) => maxHit === 17));
});

test("Chainhit selects random unused opponents instead of the nearest one", (t) => {
  const { player, target, method, others } = chainhitScene(t);
  Misc.randomElement.mock.mockImplementation((candidates) => candidates.at(-1));
  method.start(player, target);
  const hits = method.hits(player, target);
  assert.equal(hits[1].getTarget(), others.at(-1));
  assert.equal(new Set(hits.map((hit) => hit.getTarget())).size, hits.length);
});

test("Chainhit ends at the first miss, outside multicombat and when the energy runs out", (t) => {
  let scene = chainhitScene(t, { outcomes: [true, true, false] });
  scene.method.start(scene.player, scene.target);
  assert.equal(scene.method.hits(scene.player, scene.target).length, 3, "the missed bounce is the last");
  t.mock.restoreAll();

  scene = chainhitScene(t, { multi: false });
  scene.method.start(scene.player, scene.target);
  assert.equal(scene.method.hits(scene.player, scene.target).length, 1, "single-combat: no ricochet");
  t.mock.restoreAll();

  scene = chainhitScene(t, { outcomes: [false] });
  scene.method.start(scene.player, scene.target);
  assert.equal(scene.method.hits(scene.player, scene.target).length, 1, "a missed first throw does not chain");
  t.mock.restoreAll();

  scene = chainhitScene(t, { special: 25 });
  scene.method.start(scene.player, scene.target);
  assert.equal(scene.method.hits(scene.player, scene.target).length, 2, "25%: the throw and one bounce leave 5%");
  assert.equal(scene.player.special, 5);
});

test("Chainhit swings one tick slower than the axe's normal attack", (t) => {
  const { player, method } = chainhitScene(t);
  assert.equal(method.attackSpeed(player), 6);
});

// ------------------------------------------------------------------ morrigan's javelin

test("Phantom Strike drains 50% once, uses one javelin and bleeds 75% of the hit at 10 a tick", (t) => {
  const drains = quiet(t);
  const submitted = [];
  t.mock.method(TaskManager, "submit", (task) => submitted.push(task));
  t.mock.method(TaskManager, "cancelTasks", () => {});
  require("../plugins/combat/specials/MorrigansJavelin.SpecialAttack")(specialApi);
  const special = CombatSpecial.getById("morrigans_javelin");
  assert.equal(special.getDrainAmount(), 50);
  assert.equal(special.getAccuracyMultiplier(), 1.5);
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.MORRIGANS_JAVELIN), special);

  const javelins = new Item(ItemIdentifiers.MORRIGANS_JAVELIN, 5);
  const attribute = new Map();
  const player = wielding(javelins, {
    getAttribute: (key) => attribute.get(key),
    setAttribute: (key, value) => attribute.set(key, value),
  });
  const pending = [];
  const victim = {
    ...player,
    getAsPlayer: () => victim,
    isRegistered: () => true,
    getHitpoints: () => 99,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (damage) => pending.push(...damage) }) }),
  };
  const attacker = { ...player, isRegistered: () => true };
  const method = special.getCombatMethod();

  method.start(player, victim);
  assert.deepEqual(drains, [50]);
  assert.equal(javelins.getAmount(), 4, "one javelin per throw");

  const hit = { isAccurate: () => true, getTotalDamage: () => 40, getAttacker: () => attacker, getTarget: () => victim };
  method.handleAfterHitEffects(hit);
  assert.equal(submitted.length, 1);
  for (let tick = 0; tick < 3; tick++) submitted[0].execute();
  assert.deepEqual(pending.map((damage) => damage.getDamage()), [10, 10, 10], "75% of 40 is 30");

  method.handleAfterHitEffects({ ...hit, getTarget: () => ({ isPlayer: () => false }) });
  assert.equal(submitted.length, 1, "no effect on NPCs");
});

// ------------------------------------------------------------------ chinchompas

function chinchompas() {
  const hooks = {};
  require("../plugins/items/Chinchompas.plugin").register({
    emitCustomEvent: () => {},
    core,
    registerCombatMethodResolver: (resolver) => { hooks.resolver = resolver; },
    registerRangedCombatModifier: (modifier) => { hooks.modifier = modifier; },
    registerRangedAmmoHandler: (handler) => { hooks.ammo = handler; },
  });
  return hooks;
}

function thrower(id, amount = 10, childId = 0) {
  return wielding(new Item(id, amount), {
    getFightType: () => ({ getChildId: () => childId }),
    getLocalNpcs: () => new Map(),
    getLocalPlayers: () => new Map(),
  });
}

test("the chinchompa combat method belongs to chinchompa wielders only", () => {
  const { resolver } = chinchompas();
  for (const id of [ItemIdentifiers.CHINCHOMPA_2, ItemIdentifiers.RED_CHINCHOMPA_2, ItemIdentifiers.BLACK_CHINCHOMPA]) {
    assert.ok(resolver.resolve(thrower(id)), `item ${id}`);
  }
  assert.equal(resolver.resolve(thrower(ItemIdentifiers.RUNE_THROWNAXE)), null);
  assert.equal(resolver.resolve(mobile(0, 0)), null);
});

test("chinchompa accuracy follows the fuse and the distance thrown (Wiki)", () => {
  const { modifier } = chinchompas();
  const table = { 0: [100, 75, 50], 1: [75, 100, 75], 3: [50, 75, 100] };
  for (const [childId, percents] of Object.entries(table)) {
    const player = thrower(ItemIdentifiers.RED_CHINCHOMPA_2, 10, Number(childId));
    [[1, 0], [3, 0], [4, 1], [6, 1], [7, 2], [10, 2]].forEach(([distance, band]) => {
      const target = mobile(3200 + distance, 3200);
      assert.equal(modifier.modifyAttackRoll(player, target, 20000), 200 * percents[band], `fuse ${childId} at ${distance}`);
    });
  }
  assert.equal(modifier.modifyAttackRoll(thrower(ItemIdentifiers.RUNE_THROWNAXE), mobile(3201, 3200), 20000), null);
});

test("a chinchompa that lands explodes on everyone within a tile of its target in multicombat", (t) => {
  quiet(t);
  const outcomes = [true];
  const rolled = stubRolls(t, outcomes);
  const { resolver } = chinchompas();
  const player = thrower(ItemIdentifiers.BLACK_CHINCHOMPA);
  const target = mobile(3205, 3200);
  const beside = [mobile(3204, 3199), mobile(3206, 3201), mobile(3205, 3201)];
  const away = mobile(3207, 3200);
  player.getLocalNpcs = () => new Map([[1, target], ...beside.map((mob, index) => [index + 2, mob]), [9, away]]);
  let multi = true;
  t.mock.method(CombatFactory, "multiCombatBetween", () => multi);
  t.mock.method(CombatFactory, "canAttackSecondaryTarget", (attacker, primary, candidate, radius) =>
    candidate !== primary && candidate.getLocation().getDistance(primary.getLocation()) <= radius);
  t.mock.method(RangedCombatMethod.prototype, "hits", function (character, victim) {
    return [new PendingHit(character, victim, this, 2)];
  });
  const method = resolver.resolve(player);

  let hits = method.hits(player, target);
  assert.deepEqual(hits.map((hit) => hit.getTarget()), [target, ...beside], "the 3x3, not the tile two away");
  assert.deepEqual(hits.map((hit) => hit.getDelay()), [2, 2, 2, 2], "the blast lands together");
  assert.deepEqual(rolled, [true, false, false, false], "only the first target's accuracy is rolled");

  outcomes.push(false);
  assert.equal(method.hits(player, target).length, 1, "a missed throw explodes on nobody");
  multi = false;
  outcomes.push(true);
  assert.equal(method.hits(player, target).length, 1, "single-combat: the target only");
});

test("each throw uses one chinchompa for good, and the last one empties the hand", (t) => {
  const { ammo } = chinchompas();
  const assigned = [];
  t.mock.method(WeaponInterfaceManager, "assign", (player) => assigned.push(player));
  const player = thrower(ItemIdentifiers.CHINCHOMPA_2, 2);
  const stack = player.getEquipment().get(WEAPON);

  assert.equal(ammo.decrementAmmo(player, new Location(0, 0, 0), 1, 0), true);
  assert.equal(stack.getAmount(), 1);
  assert.equal(ammo.decrementAmmo(player, new Location(0, 0, 0), 1, 0), true);
  assert.equal(player.getEquipment().get(WEAPON).getId(), -1);
  assert.equal(assigned.length, 1);
  assert.ok(player.messages.includes("You have run out of ammunition!"));
  assert.equal(ammo.decrementAmmo(thrower(ItemIdentifiers.RUNE_THROWNAXE), null, 1, 0), false, "other ammunition is core's");

  const submitted = [];
  t.mock.method(TaskManager, "submit", (task) => submitted.push(task));
  const flying = thrower(ItemIdentifiers.RED_CHINCHOMPA_2, 5);
  ammo.decrementAmmo(flying, null, 1, 2);
  assert.equal(flying.getEquipment().get(WEAPON).getAmount(), 5, "counted when the throw lands");
  submitted[0].execute();
  assert.equal(flying.getEquipment().get(WEAPON).getAmount(), 4);
});

test("a chinchompa has no special bar and the medium fuse has no accuracy boost", () => {
  assert.equal(WeaponInterfaces.CHINCHOMPA.getSpecialBar(), -1);
  for (const id of [ItemIdentifiers.CHINCHOMPA_2, ItemIdentifiers.RED_CHINCHOMPA_2, ItemIdentifiers.BLACK_CHINCHOMPA]) {
    assert.equal(CombatSpecial.getForWeaponId(id), null);
  }
  const { FightType } = require("../dist/game/content/combat/FightType");
  const { FightStyle } = require("../dist/game/content/combat/FightStyle");
  assert.equal(FightType.CHINCHOMPA_SHORT_FUSE.getStyle(), FightStyle.ACCURATE, "short fuse: +3 Ranged");
  assert.notEqual(FightType.CHINCHOMPA_MEDIUM_FUSE.getStyle(), FightStyle.ACCURATE);
});

// ------------------------------------------------------------------ toxic blowpipe

const ZULRAH_SCALES = 12934;
const BLOWPIPE_STATE_KEY = "toxic-blowpipe";

/** The real plugin on a fake pipe holding `scales` scales and `darts` rune darts. */
function blowpipeScene(t, { scales, darts, recovery = 0, special = false }) {
  quiet(t);
  t.mock.method(CombatFactory, "ammoRecovery", () => recovery);
  let resolver = null;
  let damageHandler;
  const api = new Proxy({}, {
    get: (_, name) => {
      if (name === "core") return core;
      if (name === "onCombatHitDamage") return (handler) => { damageHandler = handler; };
      if (name === "registerCombatMethodResolver") return (entry) => { resolver = entry; };
      if (name === "getBonusManager") return () => BonusManager;
      if (name === "getCombatFactory") return () => CombatFactory;
      return () => {};
    },
  });
  require("../plugins/items/ToxicBlowpipe.plugin").register(api);

  const meta = new Map([[BLOWPIPE_STATE_KEY, { scales, dartId: ItemIdentifiers.RUNE_DART, dartAmount: darts }]]);
  let id = ItemIdentifiers.TOXIC_BLOWPIPE;
  const pipe = {
    getId: () => id,
    setId: (next) => { id = next; },
    getMetaValue: (key) => meta.get(key),
    setMetaValue: (key, value) => (value === undefined ? meta.delete(key) : meta.set(key, value)),
    getDefinition: () => ({ getBonuses: () => [] }),
  };
  const player = wielding(pipe, {
    getAttackAnim: () => -1,
    getCombat: () => ({ reset() {} }),
    getWeapon: () => WeaponInterfaces.BLOWPIPE,
    isSpecialActivated: () => special,
    getCombatSpecial: () => ({ getId: () => "toxic_blowpipe", getDrainAmount: () => 50 }),
    getEquipment: () => ({ get: (slot) => (slot === WEAPON ? pipe : new Item(-1, 0)), refreshItems() {}, getItems: () => [] }),
    getInventory: () => ({ refreshItems() {}, getItems: () => [] }),
    getSkillManager: () => ({}),
  });
  t.mock.method(WeaponInterfaceManager, "assign", () => {});
  t.mock.method(BonusManager, "update", () => {});
  return { player, pipe, meta, damageHandler, method: resolver.resolve(player), state: () => meta.get(BLOWPIPE_STATE_KEY) };
}

function throwOnce(scene) {
  scene.method.start(scene.player, mobile(3203, 3200));
}

test("the blowpipe spends a dart a shot, saves the Ava's share and two scales in three shots", (t) => {
  const scene = blowpipeScene(t, { scales: 100, darts: 100, recovery: 72 });
  const rolls = [[71, 0], [71, 1], [71, 2], [72, 0], [72, 1], [72, 2]];
  t.mock.method(Misc, "getRandom", () => { throw new Error("unexpected"); });
  const expectedDarts = [100, 100, 100, 99, 98, 97];
  const expectedScales = [100, 99, 98, 98, 97, 96];
  rolls.forEach(([dartRoll, scaleRoll], shot) => {
    Misc.getRandom.mock.mockImplementation((range) => (range === 99 ? dartRoll : scaleRoll));
    throwOnce(scene);
    assert.equal(scene.state().dartAmount, expectedDarts[shot], `darts after shot ${shot + 1}`);
    assert.equal(scene.state().scales, expectedScales[shot], `scales after shot ${shot + 1}`);
  });
});

test("with no Ava's the blowpipe spends a dart on every shot", (t) => {
  const scene = blowpipeScene(t, { scales: 10, darts: 10 });
  t.mock.method(Misc, "getRandom", (range) => (range === 99 ? 0 : 0));
  for (let shot = 1; shot <= 4; shot++) throwOnce(scene);
  assert.equal(scene.state().dartAmount, 6);
});

test("a blowpipe that runs out of scales or darts is emptied, shown uncharged and refuses to attack", (t) => {
  const scene = blowpipeScene(t, { scales: 1, darts: 1 });
  t.mock.method(Misc, "getRandom", () => 1);
  assert.equal(scene.method.canAttack(scene.player, mobile(3203, 3200)), true);
  throwOnce(scene);
  assert.equal(scene.pipe.getId(), ItemIdentifiers.TOXIC_BLOWPIPE_EMPTY_);
  assert.equal(scene.state(), undefined);
  assert.equal(scene.method.canAttack(scene.player, mobile(3203, 3200)), false);
});

test("a blowpipe hit envenoms 25% of the time with venom's 6 starting damage", (t) => {
  const scene = blowpipeScene(t, { scales: 10, darts: 10 });
  const poisoned = [];
  t.mock.method(CombatFactory, "poisonEntity", (...args) => poisoned.push(args));
  const target = mobile(3203, 3200);
  const hit = { getAttacker: () => scene.player, getTarget: () => target, getTotalDamage: () => 12, isAccurate: () => true };
  for (const roll of [0, 1, 2, 3]) {
    t.mock.method(Misc, "getRandom", () => roll);
    scene.method.handleAfterHitEffects(hit);
  }
  assert.deepEqual(poisoned, [[target, 6, 2]]);
  poisoned.length = 0;
  t.mock.method(Misc, "getRandom", () => 0);
  scene.method.handleAfterHitEffects({ ...hit, getTotalDamage: () => 0 });
  scene.method.handleAfterHitEffects({ ...hit, isAccurate: () => false });
  assert.deepEqual(poisoned, [], "a splash does not envenom");
});

test("Toxic siphon drains 50% once and heals half the damage, rounded down", (t) => {
  const scene = blowpipeScene(t, { scales: 10, darts: 10, special: true });
  t.mock.method(Misc, "getRandom", () => 1);
  const drains = [];
  CombatSpecial.drain.mock.mockImplementation((character, amount) => drains.push(amount));
  throwOnce(scene);
  assert.deepEqual(drains, [50]);

  const levels = { current: 60 };
  scene.player.getSkillManager = () => ({
    getMaxLevel: () => 99,
    getCurrentLevel: () => levels.current,
    setCurrentLevels: (skill, value) => { levels.current = value; },
    updateSkill() {},
  });
  const hit = { getAttacker: () => scene.player, getTarget: () => mobile(3203, 3200), getTotalDamage: () => 25, isAccurate: () => true };
  scene.method.handleAfterHitEffects(hit);
  assert.equal(levels.current, 72, "floor(25 / 2) = 12");
  const killingHit = { ...hit, getTotalDamage: () => 4 };
  scene.damageHandler({ attacker: scene.player, hit: killingHit, damage: { getDamage: () => 40 } });
  scene.method.handleAfterHitEffects(killingHit);
  assert.equal(levels.current, 92, "a 40 roll against 4 HP still heals 20");

  require("../plugins/combat/specials/ToxicBlowpipe.SpecialAttack")(specialApi);
  const siphon = CombatSpecial.getById("toxic_blowpipe");
  assert.equal(siphon.getDrainAmount(), 50);
  assert.equal(siphon.getAccuracyMultiplier(), 2);
  assert.equal(siphon.getStrengthMultiplier(), 1.5);
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.TOXIC_BLOWPIPE), siphon);
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.TOXIC_BLOWPIPE_EMPTY_), null, "an uncharged pipe has no special");
});

test('Chainhit replay fixtures preserve footprint gaps and the absolute client timeline', () => {
  const { footprintDistance, primaryProjectileEnd, bounceCycles } = require('../plugins/combat/specials/RuneThrownaxe.SpecialAttack')._test;
  const bossA = mobile(0, 0, { getSize: () => 3 }), bossB = mobile(-2, 0, { getSize: () => 3 });
  assert.equal(footprintDistance(bossA, bossB), 0);
  assert.equal(bounceCycles(bossA, bossB), 10, 'RSProx1863: overlapping Prime and Rex');
  const thrower = mobile(0, 0, { isNpc: () => false, isPlayer: () => true });
  const targets = [mobile(-2, -3), mobile(0, -1), mobile(0, -5), mobile(-2, -2)];
  const durations = targets.slice(1).map((target, index) => bounceCycles(targets[index], target));
  assert.deepEqual(durations, [16, 22, 19]);
  let elapsed = primaryProjectileEnd(thrower, targets[0]);
  const timeline = [elapsed];
  for (const duration of durations) timeline.push(elapsed += duration);
  assert.deepEqual(timeline, [61, 77, 99, 118], 'RSProx1851: four-target absolute arrival offsets');
});

test('Chainhit owns its projectile, sounds per hit and consumes only one axe', (t) => {
  const scene = chainhitScene(t);
  const projectiles = [], ammunition = [], sounds = [], graphics = [];
  t.mock.method(RangedCombatMethod.prototype, 'start', () => { throw new Error('duplicate default projectile'); });
  t.mock.method(Projectile, 'createProjectile', (...args) => {
    const entry = { args }; projectiles.push(entry);
    return { withAngle(value) { entry.angle = value; return this; },
      withProgress(value) { entry.progress = value; return this; }, sendProjectile() {} };
  });
  t.mock.method(CombatFactory, 'decrementAmmo', (...args) => ammunition.push(args));
  t.mock.method(Sounds, 'sendSound', (_player, sound) => sounds.push(sound.getId()));
  scene.player.performGraphic = (graphic) => graphics.push(graphic);
  scene.method.start(scene.player, scene.target);
  const hits = scene.method.hits(scene.player, scene.target);
  assert.equal(projectiles.length, hits.length);
  assert.deepEqual(projectiles[0].args.slice(2), [258, 41, 71, 40, 36]);
  for (const projectile of projectiles) {
    assert.equal(projectile.angle, 0);
    assert.equal(projectile.progress, 11);
  }
  for (let index = 1; index < projectiles.length; index++) {
    assert.equal(projectiles[index].args[3], projectiles[index - 1].args[4]);
  }
  assert.equal(ammunition.length, 1);
  assert.equal(ammunition[0][2], 1);
  assert.deepEqual(sounds, Array(hits.length).fill(2528));
  assert.equal(graphics[0].getId(), 257);
  assert.equal(graphics[0].getHeight(), 96);
});

// ------------------------------------------------------------------ Tonalztics of Ralos

const TONALZTICS_CHARGES = "tonalztics-of-ralos:charges";
const ROOT = path.resolve(__dirname, "..");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Skill } = require("../dist/game/model/Skill");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { AccuracyFormulasDpsCalc: Accuracy } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");

let registrationWarnings = [];
let nextIndex = 21000;

before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(ROOT);
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const pluginApi = PluginManager.createApi("TonalzticsOfRalos");
    require("../plugins/items/TonalzticsOfRalos.plugin").register(pluginApi);
    require("../plugins/combat/specials/TonalzticsOfRalos.SpecialAttack")(pluginApi);
  } finally {
    console.warn = originalWarn;
  }
  registrationWarnings = warnings;
});

function tonalzticsPlayer(location = new Location(3200, 3200, 0)) {
  const player = new Player({ sendClientPacket() { return true; }, write() { return true; } }, location);
  player.setIndex(nextIndex++);
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSkillManager().setMaxLevels(Skill.HITPOINTS, 1000).setCurrentLevels(Skill.HITPOINTS, 1000);
  player.getSkillManager().setMaxLevels(Skill.RANGED, 99).setCurrentLevels(Skill.RANGED, 99);
  player.getSkillManager().setMaxLevels(Skill.DEFENCE, 99).setCurrentLevels(Skill.DEFENCE, 99);
  player.getSkillManager().setMaxLevels(Skill.MAGIC, 99).setCurrentLevels(Skill.MAGIC, 99);
  return player;
}

function equipTonalztics(player, weaponId, charges = 0) {
  const item = new Item(weaponId, 1);
  if (charges > 0) item.setMetaValue(TONALZTICS_CHARGES, charges);
  player.getEquipment().setItem(WEAPON, item);
  WeaponInterfaceManager.assign(player);
  return item;
}

function tonalzticsTarget(npcId = core.NpcIdentifiers.MAN) {
  const target = new NPC(npcId, new Location(3205, 3200, 0));
  target.setIndex(nextIndex++);
  target.setRegistered(true);
  target.setHitpoints(1000);
  return target;
}

function choose(player, index) {
  return MultiChatboxPrompt.handleInterfaceActionClick({
    player,
    buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID,
    groupId: MultiChatboxPrompt.OPTIONS_WIDGET_ID >>> 16,
    slot: index + 1,
    action: index + 1,
    handled: false,
  });
}

function itemAction(player, item, slot, option, clickType) {
  return ItemActionPacketListener.handleAction(player, Inventory.INTERFACE_ID, item.getId(), slot, clickType, option);
}

/** The browser/native gateway's actual resume-count frame, through the connection dispatcher. */
async function submitCount(player, amount) {
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const RESUME_COUNTDIALOG = 192; // ClientPackets.ts const enum; also used by the browser encoder.
  const frame = Buffer.alloc(5); frame[0] = RESUME_COUNTDIALOG; frame.writeInt32BE(amount, 1);
  const packets = decodeClientPackets(frame);
  assert.deepEqual(packets, [{ type: "dialogue_amount", amount }]);
  const connection = new ClientConnection(channel); connection.player = player;
  await connection.dispatch(packets, true); connection.processTurnPackets();
}

function put(player, slot, id, amount = 1, meta = null) {
  const item = new Item(id, amount, meta);
  player.getInventory().setItem(slot, item);
  return item;
}

test("the production API accepts the Tonalztics 75% modifier and applies it once", () => {
  assert.deepEqual(registrationWarnings.filter((line) => /invalid ranged combat modifier/.test(line)), []);
  const player = tonalzticsPlayer();
  const target = tonalzticsTarget();
  equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS, 5);
  assert.equal(PluginManager.modifyRangedMaxHit(player, target, 100), 75);
  equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(PluginManager.modifyRangedMaxHit(player, target, 100), 75);
  equipTonalztics(player, ItemIdentifiers.RUNE_KNIFE);
  assert.equal(PluginManager.modifyRangedMaxHit(player, target, 100), 100, "other ranged weapons are untouched");
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.TONALZTICS_OF_RALOS).getId(), "tonalztics_of_ralos");
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_).getId(), "tonalztics_of_ralos");
});

test("a charged id with no stored charges is normalised to the one-hit uncharged weapon", () => {
  const player = tonalzticsPlayer();
  const target = tonalzticsTarget();
  const item = equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS);
  const method = CombatFactory.getMethod(player);

  assert.equal(item.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(WeaponProfiles.attackDistance(player, 6), 6);
  assert.equal(method.canAttack(player, target), true);
  assert.equal(method.hits(player, target)[0].getHits().length, 1);
  assert.equal(item.getMetaValue(TONALZTICS_CHARGES), undefined);
});

test("normal throws spend one charge, keep the final charged shot and honour ammo/charge saving", (t) => {
  t.mock.restoreAll();
  RangedCombatMethod.prototype.start = REAL_RANGED_START;
  CombatFactory.decrementAmmo = REAL_DECREMENT_AMMO;
  quiet(t);
  const target = tonalzticsTarget();

  const uncharged = tonalzticsPlayer();
  const unchargedItem = equipTonalztics(uncharged, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  let unchargedMethod = CombatFactory.getMethod(uncharged);
  unchargedMethod.start(uncharged, target);
  assert.equal(unchargedItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(unchargedItem.getAmount(), 1, "the weapon is not dropped as ammunition");
  assert.equal(unchargedMethod.hits(uncharged, target)[0].getHits().length, 1);

  const ordinary = tonalzticsPlayer();
  const ordinaryItem = equipTonalztics(ordinary, ItemIdentifiers.TONALZTICS_OF_RALOS, 2);
  let method = CombatFactory.getMethod(ordinary);
  assert.equal(method.canAttack(ordinary, target), true);
  assert.equal(ordinaryItem.getMetaValue(TONALZTICS_CHARGES), 2, "the eligibility check spends nothing");
  method.start(ordinary, target);
  assert.equal(ordinaryItem.getMetaValue(TONALZTICS_CHARGES), 1);
  assert.equal(method.hits(ordinary, target)[0].getHits().length, 2);

  const last = tonalzticsPlayer();
  const lastItem = equipTonalztics(last, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  method = CombatFactory.getMethod(last);
  method.start(last, target);
  assert.equal(lastItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(method.hits(last, target)[0].getHits().length, 2, "the last charge's throw is still charged");

  const miss = tonalzticsPlayer();
  const missItem = equipTonalztics(miss, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  method = CombatFactory.getMethod(miss);
  method.start(miss, target);
  t.mock.method(Accuracy, "rollAccuracy", () => false);
  const missed = method.hits(miss, target)[0];
  assert.equal(missed.getHits().length, 2);
  assert.equal(missed.getHits().every((hit) => hit.getDamage() === 0), true);
  assert.equal(missItem.getMetaValue(TONALZTICS_CHARGES), undefined, "a miss still spends the charge");

  const saved = tonalzticsPlayer();
  const savedItem = equipTonalztics(saved, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  method = CombatFactory.getMethod(saved);
  let ammoSaved = null;
  const emit = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, "emitCustomEvent", (name, event) => {
    if (event.player === saved && name === "combat:consume-charge") {
      event.skip = true;
      return;
    }
    if (event.player === ammoSaved && name === "combat:ammo-saving") {
      event.saved = true;
      return;
    }
    return emit(name, event);
  });
  method.start(saved, target);
  assert.equal(savedItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(savedItem.getMetaValue(TONALZTICS_CHARGES), 1);
  assert.equal(method.hits(saved, target)[0].getHits().length, 2);

  ammoSaved = tonalzticsPlayer();
  const ammoSavedItem = equipTonalztics(ammoSaved, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  method = CombatFactory.getMethod(ammoSaved);
  method.start(ammoSaved, target);
  assert.equal(ammoSavedItem.getMetaValue(TONALZTICS_CHARGES), 1, "core ammo saving also keeps the charge");
  assert.equal(method.hits(ammoSaved, target)[0].getHits().length, 2);
});

test("the last charge's hit profile is a snapshot even if the weapon is swapped before hits", (t) => {
  t.mock.restoreAll();
  RangedCombatMethod.prototype.start = REAL_RANGED_START;
  CombatFactory.decrementAmmo = REAL_DECREMENT_AMMO;
  quiet(t);
  const player = tonalzticsPlayer();
  const target = tonalzticsTarget();
  equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  const method = CombatFactory.getMethod(player);
  method.start(player, target);
  player.getEquipment().setItem(WEAPON, new Item(ItemIdentifiers.RUNE_KNIFE, 1));
  assert.equal(method.hits(player, target)[0].getHits().length, 2);
});

test("Division projects the first hit's Defence drain into the NPC second roll but snapshots PvP", (t) => {
  t.mock.restoreAll();
  RangedCombatMethod.prototype.start = REAL_RANGED_START;
  CombatFactory.decrementAmmo = REAL_DECREMENT_AMMO;
  quiet(t);
  t.mock.method(Misc, "randomInclusive", (min, max) => Math.max(min, max));
  const original = Accuracy.defenseRangedRoll.bind(Accuracy);
  const rolls = [];
  t.mock.method(Accuracy, "defenseRangedRoll", (enemy, type, projected) => {
    rolls.push(projected);
    return original(enemy, type, projected);
  });

  const player = tonalzticsPlayer();
  equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS, 5);
  const special = CombatSpecial.getForWeaponId(ItemIdentifiers.TONALZTICS_OF_RALOS);
  player.setCombatSpecial(special);
  player.setSpecialActivated(true);
  player.setSpecialPercentage(100);

  const npc = tonalzticsTarget(core.NpcIdentifiers.ZULRAH);
  const baseDefence = Math.min(npc.getMaxLevel(Skill.DEFENCE), 100);
  assert.ok(baseDefence >= 10, `Zulrah has ${baseDefence} base Defence`);
  npc.setCurrentLevels(Skill.DEFENCE, baseDefence);
  npc.setCurrentLevels(Skill.MAGIC, Math.min(npc.getMaxLevel(Skill.MAGIC), 160));
  const drain = Math.floor(npc.getCurrentLevel(Skill.MAGIC) / 8);
  assert.ok(drain > 0);

  const method = CombatFactory.getMethod(player);
  method.start(player, npc);
  const npcHit = method.hits(player, npc)[0];
  assert.equal(npcHit.getHits().length, 2);
  const expectedDefence = Accuracy.projectedEffectiveDefenceLevel(npc,
    npc.previewCurrentLevel(Skill.DEFENCE, baseDefence - drain));
  assert.equal(rolls[0], undefined, "the first roll uses the native Defence");
  assert.equal(rolls[1], expectedDefence, "the second roll sees the first hit's projected drain");
  assert.equal(npc.getDefenceLevel(), baseDefence, "rolling does not drain early");
  method.handleAfterHitEffects(npcHit);
  assert.equal(npc.getDefenceLevel(), Math.max(0, baseDefence - 2 * drain), "impact drains both damaging hits");

  rolls.length = 0;
  const pvpAttacker = tonalzticsPlayer();
  equipTonalztics(pvpAttacker, ItemIdentifiers.TONALZTICS_OF_RALOS, 5);
  pvpAttacker.setCombatSpecial(special);
  pvpAttacker.setSpecialActivated(true);
  pvpAttacker.setSpecialPercentage(100);
  const pvpTarget = tonalzticsPlayer(new Location(3205, 3200, 0));
  pvpTarget.getSkillManager().setMaxLevels(Skill.DEFENCE, 100).setCurrentLevels(Skill.DEFENCE, 100);
  const pvpDefence = pvpTarget.getSkillManager().getCurrentLevel(Skill.DEFENCE);
  const pvpMethod = CombatFactory.getMethod(pvpAttacker);
  pvpMethod.start(pvpAttacker, pvpTarget);
  const pvpHit = pvpMethod.hits(pvpAttacker, pvpTarget)[0];
  assert.equal(rolls.length, 2);
  assert.deepEqual(rolls, [undefined, undefined], "PvP keeps the same-tick Defence snapshot");
  assert.equal(pvpTarget.getSkillManager().getCurrentLevel(Skill.DEFENCE), pvpDefence);
  pvpMethod.handleAfterHitEffects(pvpHit);
  assert.ok(pvpTarget.getSkillManager().getCurrentLevel(Skill.DEFENCE) < pvpDefence);
});

test("Uncharge asks first, refunds all 20,000 into a compatible stack and keeps charges when the refund cannot fit", () => {
  const full = tonalzticsPlayer();
  const fullItem = put(full, 0, ItemIdentifiers.TONALZTICS_OF_RALOS);
  fullItem.setMetaValue(TONALZTICS_CHARGES, 20000);
  put(full, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 2147483647);

  assert.equal(itemAction(full, fullItem, 0, "Uncharge", 5), true);
  assert.deepEqual(MultiChatboxPrompt.getPending(full).options, ["Proceed.", "Cancel."]);
  assert.equal(fullItem.getMetaValue(TONALZTICS_CHARGES), 20000, "the prompt alone changes nothing");
  choose(full, 0);
  assert.equal(fullItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(fullItem.getMetaValue(TONALZTICS_CHARGES), 20000);
  assert.equal(full.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 2147483647);

  const compatible = tonalzticsPlayer();
  const compatibleItem = put(compatible, 0, ItemIdentifiers.TONALZTICS_OF_RALOS);
  compatibleItem.setMetaValue(TONALZTICS_CHARGES, 20000);
  put(compatible, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 100);
  itemAction(compatible, compatibleItem, 0, "Uncharge", 5);
  choose(compatible, 0);
  assert.equal(compatibleItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(compatibleItem.getMetaValue(TONALZTICS_CHARGES), undefined);
  assert.equal(compatible.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 20100);
  assert.equal(choose(compatible, 0), false, "a repeated/stale answer cannot refund twice");
  assert.equal(compatible.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 20100);

  const incompatible = tonalzticsPlayer();
  const incompatibleItem = put(incompatible, 0, ItemIdentifiers.TONALZTICS_OF_RALOS);
  incompatibleItem.setMetaValue(TONALZTICS_CHARGES, 500);
  put(incompatible, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 100, { untradeable: true });
  for (let slot = 2; slot < 28; slot++) put(incompatible, slot, ItemIdentifiers.COINS, 1);
  itemAction(incompatible, incompatibleItem, 0, "Uncharge", 5);
  choose(incompatible, 0);
  assert.equal(incompatibleItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(incompatibleItem.getMetaValue(TONALZTICS_CHARGES), 500);
  assert.equal(incompatible.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 100);

  const cancelled = tonalzticsPlayer();
  const cancelledItem = put(cancelled, 0, ItemIdentifiers.TONALZTICS_OF_RALOS);
  cancelledItem.setMetaValue(TONALZTICS_CHARGES, 500);
  put(cancelled, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 100);
  itemAction(cancelled, cancelledItem, 0, "Uncharge", 5);
  choose(cancelled, 1);
  assert.equal(cancelledItem.getMetaValue(TONALZTICS_CHARGES), 500);
  assert.equal(cancelled.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 100);

  const stale = tonalzticsPlayer();
  const staleItem = put(stale, 0, ItemIdentifiers.TONALZTICS_OF_RALOS);
  staleItem.setMetaValue(TONALZTICS_CHARGES, 500);
  put(stale, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 100);
  itemAction(stale, staleItem, 0, "Uncharge", 5);
  stale.getInventory().setItem(0, new Item(-1));
  stale.getInventory().setItem(2, staleItem);
  choose(stale, 0);
  assert.equal(staleItem.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(staleItem.getMetaValue(TONALZTICS_CHARGES), 500);
});

test("native Sunfire item-on-item asks before charging both ways, caps at 20,000 and ignores notes", async () => {
  const first = tonalzticsPlayer();
  const uncharged = put(first, 1, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  put(first, 0, ItemIdentifiers.SUNFIRE_SPLINTERS, 25000);
  UseItemPacketListener.itemOnItem(first, 0, 1);
  assert.equal(uncharged.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(first.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 25000, "nothing spent before amount input");
  assert.ok(first.getEnteredAmountAction());
  await submitCount(first, 25000);
  assert.equal(first.getEnteredAmountAction(), null, "the native count dispatcher releases the prompt");
  assert.equal(uncharged.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(uncharged.getMetaValue(TONALZTICS_CHARGES), 20000);
  assert.equal(first.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 5000);

  const second = tonalzticsPlayer();
  const weapon = put(second, 0, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  put(second, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 500);
  UseItemPacketListener.itemOnItem(second, 0, 1);
  assert.equal(second.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 500);
  await submitCount(second, 500);
  assert.equal(weapon.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS);
  assert.equal(weapon.getMetaValue(TONALZTICS_CHARGES), 500);
  assert.equal(second.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 0);

  const noted = tonalzticsPlayer();
  const notedWeapon = put(noted, 0, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  put(noted, 1, ItemIdentifiers.SUNFIRE_SPLINTERS_2, 500);
  UseItemPacketListener.itemOnItem(noted, 0, 1);
  assert.equal(notedWeapon.getId(), ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
  assert.equal(notedWeapon.getMetaValue(TONALZTICS_CHARGES), undefined);
});

test("native Check and Charge act on the clicked charged item and persist its metadata", async (t) => {
  const player = tonalzticsPlayer();
  const messages = [];
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  const weapon = put(player, 4, ItemIdentifiers.TONALZTICS_OF_RALOS);
  weapon.setMetaValue(TONALZTICS_CHARGES, 500);
  weapon.setMetaValue("tonalztics:test-marker", "kept");
  put(player, 5, ItemIdentifiers.SUNFIRE_SPLINTERS, 1000);

  itemAction(player, weapon, 4, "Check", 3);
  assert.match(messages.at(-1), /500 charges/);

  itemAction(player, weapon, 4, "Charge", 4);
  const action = player.getEnteredAmountAction();
  assert.ok(action, "Charge opens the enter-amount prompt");
  await submitCount(player, 200);
  assert.equal(weapon.getMetaValue(TONALZTICS_CHARGES), 700);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), 800);
  assert.equal(weapon.clone().getMetaValue(TONALZTICS_CHARGES), 700, "charge metadata survives cloning");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const restored = tonalzticsPlayer(); PlayerSave.fromPlayer(player).applyToPlayer(restored);
  const savedWeapon = restored.getInventory().getItems()[4];
  assert.equal(savedWeapon.getMetaValue(TONALZTICS_CHARGES), 700, "the charged item survives real save/load");
  assert.equal(savedWeapon.getMetaValue("tonalztics:test-marker"), "kept", "other metadata is preserved");
});


test("charge amount replies reject cancelled, moved, replaced, changed and superseded requests", async () => {
  for (const change of ["cancelled", "moved", "replaced", "changed-id", "changed-charges", "superseded", "zero", "duplicate"]) {
    const player = tonalzticsPlayer();
    const weapon = put(player, 0, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
    put(player, 1, ItemIdentifiers.SUNFIRE_SPLINTERS, 500);
    UseItemPacketListener.itemOnItem(player, 0, 1);
    const action = player.getEnteredAmountAction(); assert.ok(action);
    if (change === "cancelled") player.getPacketSender().sendInterfaceRemoval();
    if (change === "moved") {
      player.getInventory().setItem(0, new Item(-1, 0)); player.getInventory().setItem(2, weapon);
    }
    if (change === "replaced") put(player, 0, ItemIdentifiers.TONALZTICS_OF_RALOS_UNCHARGED_);
    if (change === "changed-id") weapon.setId(ItemIdentifiers.RUNE_KNIFE);
    if (change === "changed-charges") weapon.setMetaValue(TONALZTICS_CHARGES, 1);
    let otherReplies = 0;
    if (change === "superseded") player.setEnteredAmountAction({ execute() { otherReplies++; } });
    await submitCount(player, change === "zero" ? 0 : 100);
    action.execute(100); // A saved callback cannot regain ownership after native close/reply.
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.SUNFIRE_SPLINTERS), change === "duplicate" ? 400 : 500, change);
    assert.equal(otherReplies, change === "superseded" ? 1 : 0);
    if (change === "duplicate") {
      await submitCount(player, 100);
      assert.equal(weapon.getMetaValue(TONALZTICS_CHARGES), 100, "only the first answer can spend");
    }
  }
});

test("a final charged shot expires before the next special, and combat cancellation releases its snapshot", (t) => {
  t.mock.restoreAll(); RangedCombatMethod.prototype.start = REAL_RANGED_START; CombatFactory.decrementAmmo = REAL_DECREMENT_AMMO;
  quiet(t);
  const player = tonalzticsPlayer(), target = tonalzticsTarget();
  const item = equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  const normal = CombatFactory.getMethod(player); normal.start(player, target);
  assert.equal(normal.hits(player, target)[0].getHits().length, 2);
  normal.finished(player, target);
  player.setCombatSpecial(CombatSpecial.getForWeaponId(item.getId())); player.setSpecialActivated(true);
  assert.equal(CombatSpecial.activeTraitsFor(player).hitCount, 1, "next prospective special uses the empty weapon");
  const next = CombatFactory.getMethod(player); next.start(player, target);
  assert.equal(next.hits(player, target)[0].getHits().length, 1);
  next.finished(player, target);
  equipTonalztics(player, ItemIdentifiers.TONALZTICS_OF_RALOS, 1);
  assert.equal(CombatSpecial.activeTraitsFor(player).hitCount, 2, "fresh charged equipment is read between attacks");
  const cancelled = CombatFactory.getMethod(player); cancelled.start(player, target);
  player.getCombat().target = target; player.getCombat().method = cancelled;
  player.getCombat().reset();
  assert.equal(CombatSpecial.activeTraitsFor(player).hitCount, 1, "actual combat reset calls the shot's cancellation cleanup");
});

test("plain plugin combat methods without the optional projection hook still prepare two splats", (t) => {
  const player = tonalzticsPlayer(), target = tonalzticsTarget();
  const methods = Object.fromEntries(Object.getOwnPropertyNames(core.CombatMethod.prototype)
    .filter(name => name !== "constructor" && name !== "projectedDefenceLevel")
    .map(name => [name, core.CombatMethod.prototype[name]]));
  const plain = { ...methods, type: () => core.CombatType.RANGED,
    hits(source, victim) { return [new PendingHit(source, victim, this, { hitAmount: 2, rollAccuracy: false })]; } };
  PluginManager.createApi("plain-projection-control").registerCombatMethodResolver({ resolve: source => source === player ? plain : null });
  assert.equal(CombatFactory.getMethod(player), plain, "the production resolver accepts a plain JS object");
  t.mock.method(CombatFactory, "getHitDamage", () => new core.HitDamage(5, core.HitMask.RED));
  assert.equal(plain.hits(player, target)[0].getHits().length, 2);
});
