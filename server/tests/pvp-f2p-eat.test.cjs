// Run after `yarn build`: node --test tests/pvp-f2p-eat.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TimerRepository } = require('../dist/util/timers/TimerRepository');
const Food = require('../plugins/items/Food.plugin');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { PvpCombatExecutionNode } = require('../plugins/bots/behaviours/nodes/pvp/PvpCombatExecutionNode.PlayerBots');
const Potions = require('../plugins/items/Potions.plugin');
let core, eatFood, drinkPotion;

// The bots ask the Food plugin what is food, and it reads item names from the cache.
before(async () => {
  await CachePipeline.initialize();
  core = { ...PluginManager.getCoreApi(), ItemActionPacketListener: {
    handleAction(player, interfaceId, itemId, slot) {
      if (Food.isFoodItem(itemId)) eatFood({ player, interfaceId, itemId, slot, clickType: 1 });
      else drinkPotion({ player, interfaceId, itemId, slot, clickType: 1 });
      return true;
    },
  } };
  Food.register({
    core, persistAttribute() {}, onPlayerLogin() {},
    onItemAction: handler => { eatFood = handler; },
    emitCanEat: player => player.canEat !== false,
    emitCustomEvent() {},
  });
  Potions.register(new Proxy({
    core,
    onItemFirstAction: handler => { drinkPotion = handler; },
    emitCanDrink: player => player.canDrink !== false,
    emitCanEat: player => player.canEat !== false,
    emitCustomEvent() {},
  }, { get: (object, key) => object[key] ?? (() => {}) }));
});

const filename = path.resolve(__dirname, '../plugins/bots/behaviours/nodes/actions/EatFoodActionNode.PlayerBots.js');
const localRequire = createRequire(filename);

function loadNode(comboEatChance, profileId) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    Math,
    require: (name) => {
      if (name.endsWith('/PvpAssignment.PlayerBots')) {
        const { getPvpProfile } = localRequire(name);
        return { getPvpProfile: () => ({ ...getPvpProfile(profileId), comboEatChance }) };
      }
      if (name.endsWith('/state/State.PlayerBots')) return {
        computeEatThreshold: (maxHp, ratio, f2p) =>
          f2p ? Math.min(24, Math.max(1, maxHp - 1)) : Math.max(1, Math.ceil(maxHp * ratio)),
      };
      if (name.endsWith('/NodeContext.PlayerBots')) return { resolveBotNodeContext: (ctx) => ctx };
      return localRequire(name);
    },
  }, { filename });
  return module.exports;
}

function buildHarness(comboEatChance = 0, profileId = 'standard') {
  let hp = 30;
  let target = {};
  let attacker = null;
  let following = null;
  let foodItems = [];
  const timers = new TimerRepository();
  const delays = [];
  const attributes = new Map();
  const combat = { getTarget: () => target, getAttacker: () => attacker, delayAttack: ticks => delays.push(ticks) };
  const player = {
    getSkillManager: () => ({ getCurrentLevel: () => hp, getMaxLevel: () => 60, stopSkillable() {} }),
    getCombat: () => combat,
    getCombatFollowing: () => following,
    getInventory: () => ({
      capacity: () => 28,
      getItems: () => foodItems,
      deleteAtSlot: (slot) => {
        const item = foodItems[slot];
        if ((item.getAmount?.() ?? 1) > 1) item.setAmount(item.getAmount() - 1);
        else foodItems[slot] = null;
      },
      refreshItems: () => {},
    }),
    getTimers: () => timers,
    getPacketSender: () => ({ sendInterfaceRemoval() {}, sendConfig() {} }),
    performAnimation: () => {},
    setHitpoints: value => { hp = value; },
    getAttribute: key => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    isPlayerBot: () => true,
    sendMessage() {},
    getUsername: () => 'f2p-test',
  };
  const state = {
    mode: 'pvp',
    virtualFoodChargesRemaining: 10,
    pvp: {
      loadoutId: 'f2p_strength_pure',
      profileId: 'standard',
      f2pFoodPending: false,
      f2pFoodPendingHp: null,
    },
  };
  const node = new (loadNode(comboEatChance, profileId).EatFoodActionNode)(null, { core, log: () => {} }, {});
  return {
    setHp: (value) => { hp = value; },
    getHp: () => hp,
    setFood: (count) => { foodItems = Array.from({ length: count }, () => new core.Item(ItemIdentifiers.SHARK, 1)); },
    engage: (value) => { target = value ? {} : null; attacker = null; following = null; },
    tick: () => node.tick({ player, state, nowMs: 1000 }),
    player, timers, delays,
    setItems: ids => { foodItems = ids.map(id => new core.Item(id, 1)); },
    state,
  };
}

test('F2P bot only eats once engaged and after HP actually drops', () => {
  const h = buildHarness();

  h.setHp(30);
  assert.equal(h.tick(), 'failure', 'above the F2P threshold nothing happens');
  assert.equal(h.state.pvp.f2pFoodPending, false);

  h.setHp(20);
  h.engage(false);
  assert.equal(h.tick(), 'failure', 'low HP without a target never eats');

  h.engage(true);
  assert.equal(h.tick(), 'failure', 'first engaged low-HP tick just arms the pending flag');
  assert.equal(h.state.pvp.f2pFoodPending, true);
  assert.equal(h.state.pvp.f2pFoodPendingHp, 20);

  assert.equal(h.tick(), 'failure', 'same HP does not consume food');
  assert.equal(h.state.pvp.f2pFoodPending, true);

  h.setHp(15);
  assert.equal(h.tick(), 'failure', 'HP drop proceeds to eat (fails here on empty inventory)');
  assert.equal(h.state.pvp.f2pFoodPending, false);
  assert.equal(h.state.pvp.f2pFoodPendingHp, null);
  assert.equal(h.state.virtualFoodChargesRemaining, 0, 'empty inventory zeroes the retreat budget');
});

test('non-F2P bots never touch the F2P pending flag', () => {
  const h = buildHarness();
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(20);
  h.engage(true);

  assert.equal(h.tick(), 'failure', 'below the member threshold with no food');
  assert.equal(h.state.pvp.f2pFoodPending, false);
  assert.equal(h.state.pvp.f2pFoodPendingHp, null);
});

test('PvP bots consume actual remaining food after virtual charges run out', () => {
  const h = buildHarness();
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.state.virtualFoodChargesRemaining = 0;
  h.setHp(20);
  h.setFood(2);
  assert.equal(h.tick(), 'success', 'real meals are usable despite a stale counter');
  assert.equal(h.state.virtualFoodChargesRemaining, 1);
  h.setHp(20);
  h.timers.cancel(core.TimerKey.FOOD);
  assert.equal(h.tick(), 'success', 'the last real meal is usable with a consumed empty slot');
  assert.ok(h.getHp() > 20, 'the final meal heals the bot');
  assert.equal(h.state.virtualFoodChargesRemaining, 0, 'the remaining supply now matches the empty inventory');
  h.setHp(20);
  assert.equal(h.tick(), 'failure', 'no food is invented after the last real meal');
});


test('low HP reacts with a real shark and karambwan in one turn, preserving food cooldowns and delays', () => {
  const h = buildHarness(1, 'veteran');
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(5);
  h.setItems([ItemIdentifiers.COOKED_KARAMBWAN, ItemIdentifiers.SHARK]);
  assert.equal(h.tick(), 'success');
  assert.equal(h.getHp(), 43, 'shark heals 20 and karambwan 18');
  assert.deepEqual(h.delays, [3, 2], 'normal food then combo food uses the real attack delays');
  assert.equal(h.state.pvp.lastComboEatAt, 1000);
  assert.equal(h.state.virtualFoodChargesRemaining, 0);
  assert.ok(h.timers.has(core.TimerKey.KARAMBWAN));
});

test('two normal foods cannot be combo eaten, and eating permissions/cooldowns still apply', () => {
  const h = buildHarness(1, 'veteran');
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(5);
  h.setFood(2);
  h.player.canEat = false;
  assert.equal(h.tick(), 'failure');
  assert.equal(h.getHp(), 5);
  h.player.canEat = true;
  assert.equal(h.tick(), 'success');
  assert.equal(h.getHp(), 25);
  assert.equal(h.state.virtualFoodChargesRemaining, 1);
  assert.equal(h.tick(), 'failure', 'a second shark must wait for the food timer');
  assert.equal(h.state.virtualFoodChargesRemaining, 1);
});

test('a combo food can save a low-HP bot while normal food is on cooldown', () => {
  const h = buildHarness(0);
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(5);
  h.setItems([ItemIdentifiers.SHARK, ItemIdentifiers.COOKED_KARAMBWAN]);
  h.timers.extendOrRegister(core.TimerKey.FOOD, 3);
  assert.equal(h.tick(), 'success');
  assert.equal(h.getHp(), 23);
  assert.deepEqual(h.delays, [2]);
  assert.equal(h.state.virtualFoodChargesRemaining, 1);
});


function prayerHarness({ prayer = 99, defence = 99, confidenceTier = 2 } = {}) {
  const player = new Player(null, new core.Location(3243, 3526));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.isPlayerBot = () => true;
  const skills = player.getSkillManager();
  for (const [skill, level] of [[core.Skill.PRAYER, prayer], [core.Skill.DEFENCE, defence], [core.Skill.HITPOINTS, 99]]) {
    skills.setMaxLevels(skill, level, false);
    skills.setCurrentLevel(skill, level, false);
  }
  const profile = { confidenceTier, prayerReviewMs: { min: 600, max: 600 } };
  const node = new PvpCombatExecutionNode({ api: {
    core,
    getCombatFactory: () => core.CombatFactory,
    getPrayerHandler: () => PrayerHandler,
    getServerPerf: () => ({ measurePhase: (_, fn) => fn() }),
  }, getProfile: () => profile });
  const state = { pvp: { preferredCombatStyle: 'melee' } };
  const target = { getUsername: () => 'opponent' };
  node.resolveObservedTargetCombatType = () => core.CombatType.MELEE;
  node.resolveProtectionPrayer = () => PrayerHandler.PROTECT_FROM_MELEE;
  return { player, skills, node, state, target, profile,
    review() { return node.reviewPrayers(player, state, target, 1000, profile); } };
}

test('Protect Item is a stable 40/50 percent engagement choice and considers valuable inventory items', t => {
  t.mock.method(Math, 'random', () => 0.45);
  const original = ItemDefinition.forId.bind(ItemDefinition);
  t.mock.method(ItemDefinition, 'forId', id => id === ItemIdentifiers.DRAGON_WARHAMMER
    ? { getGrandExchangeValue: () => 4_000_000 } : original(id));
  const ordinary = prayerHarness();
  ordinary.node.reviewItemProtection(ordinary.player, ordinary.state, ordinary.target);
  assert.equal(ordinary.state.pvp.protectItemWanted, false);
  const valuable = prayerHarness();
  valuable.player.getInventory().setItem(0, new core.Item(ItemIdentifiers.DRAGON_WARHAMMER));
  valuable.node.reviewItemProtection(valuable.player, valuable.state, valuable.target);
  assert.equal(valuable.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM], true);
  t.mock.method(Math, 'random', () => 0);
  ordinary.node.reviewItemProtection(ordinary.player, ordinary.state, ordinary.target);
  assert.equal(ordinary.state.pvp.protectItemWanted, false, 'failed rolls are not repeated each tick');
});

test('Protect Item respects Prayer level, depleted points and red skull restrictions, including novices', t => {
  t.mock.method(Math, 'random', () => 0);
  for (const prayer of [24, 25]) {
    const f = prayerHarness({ prayer, confidenceTier: 1 });
    f.review();
    assert.equal(f.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM] === true, prayer >= 25);
  }
  const drained = prayerHarness();
  drained.skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  drained.node.reviewItemProtection(drained.player, drained.state, drained.target);
  assert.equal(drained.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM] === true, false);
  drained.skills.setCurrentLevel(core.Skill.PRAYER, 10, false);
  drained.node.reviewItemProtection(drained.player, drained.state, drained.target);
  assert.equal(drained.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM], true, 'restoring prayer re-enables the cached item-protection choice');
  const redSkull = prayerHarness();
  redSkull.player.setSkullTimer(100);
  redSkull.player.setSkullType(core.SkullType.RED_SKULL);
  redSkull.node.reviewItemProtection(redSkull.player, redSkull.state, redSkull.target);
  assert.equal(redSkull.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM] === true, false);
});

test('bots choose unlocked style prayers and retain Piety alongside Smite', () => {
  for (const [combatType, expected] of [[core.CombatType.MELEE, PrayerHandler.PIETY],
    [core.CombatType.RANGED, PrayerHandler.RIGOUR], [core.CombatType.MAGIC, PrayerHandler.AUGURY]]) {
    const f = prayerHarness();
    f.player.getWeapon = () => combatType === core.CombatType.RANGED ? core.WeaponInterfaces.SHORTBOW
      : combatType === core.CombatType.MAGIC ? core.WeaponInterfaces.STAFF : core.WeaponInterfaces.UNARMED;
    f.review();
    assert.equal(f.player.getPrayerActive()[expected], true);
  }
  const smiter = prayerHarness();
  smiter.node.shouldSmite = () => true;
  smiter.review();
  assert.equal(smiter.player.getPrayerActive()[PrayerHandler.SMITE], true);
  assert.equal(smiter.player.getPrayerActive()[PrayerHandler.PIETY], true);
  smiter.node.shouldSmite = () => false;
  smiter.review();
  assert.equal(smiter.player.getPrayerActive()[PrayerHandler.SMITE], false);
  assert.equal(smiter.player.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE], true);
});

test('every Edgeville kit uses only Smite as its overhead at every difficulty', () => {
  const { getEnabledWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  const kits = require('../plugins/modes/data/pvp-presets-players.json');
  const spots = getEnabledWildernessHotspots().filter(spot => spot.smiteOnly);
  assert.deepEqual(spots.map(spot => spot.id).sort(), ['edge_low', 'edge_mains', 'edge_mid']);
  for (const spot of spots) for (const kit of kits) {
    const prayer = kit.stats[5];
    for (const confidenceTier of [1, 2, 3, 4]) {
      const f = prayerHarness({ prayer, confidenceTier });
      f.state.pvp.hotspotId = spot.id;
      f.node.shouldSmite = () => assert.fail('Edgeville Smite must not depend on random rolls or opponent risk');
      f.node.resolveProtectionPrayer = () => assert.fail('Edgeville must never choose a protection prayer');
      f.player.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
      f.review();
      const activeOverheads = PrayerHandler.OVERHEAD_PRAYERS.filter(id => f.player.getPrayerActive()[id]);
      assert.deepEqual(activeOverheads, prayer >= 52 ? [PrayerHandler.SMITE] : [], spot.id + '/' + kit.key + '/' + confidenceTier);
    }
  }
});

test('Edgeville Smite respects the level threshold and depleted prayer points', () => {
  const { getEnabledWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  const spot = getEnabledWildernessHotspots().find(spot => spot.smiteOnly);
  for (const prayer of [51, 52]) {
    const f = prayerHarness({ prayer, confidenceTier: 1 });
    f.state.pvp.hotspotId = spot.id;
    f.review();
    assert.equal(f.player.getPrayerActive()[PrayerHandler.SMITE] === true, prayer === 52);
  }
  const drained = prayerHarness();
  drained.state.pvp.hotspotId = spot.id;
  drained.skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  drained.review();
  assert.equal(drained.player.getPrayerActive()[PrayerHandler.SMITE] === true, false);
  drained.skills.setCurrentLevel(core.Skill.PRAYER, 10, false);
  drained.review();
  assert.equal(drained.player.getPrayerActive()[PrayerHandler.SMITE], true);
});

test('Edgeville visitors use Smite regardless of missing, stale or different spawn assignments', () => {
  for (const [x, y] of [[3036, 3486], [3090, 3490], [3068, 3531], [3135, 3583]]) {
    for (const hotspotId of [null, 'edge_mains', 'varrock_ditch']) {
      for (const confidenceTier of [1, 2, 3, 4]) {
        const f = prayerHarness({ prayer: 52, confidenceTier });
        f.player.setLocation(new core.Location(x, y));
        f.state.pvp.hotspotId = hotspotId;
        f.node.resolveProtectionPrayer = () => assert.fail('location must override the spawn assignment');
        f.player.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
        f.review();
        assert.deepEqual(PrayerHandler.OVERHEAD_PRAYERS.filter(id => f.player.getPrayerActive()[id]),
          [PrayerHandler.SMITE], `${x},${y}/${hotspotId}/${confidenceTier}`);
      }
    }
  }
});

test('the location rule stops at Edgeville region boundaries and the surface plane', () => {
  const { usesSmiteOnlyPrayers } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  const f = prayerHarness();
  for (const [x, y, z, expected] of [[3008, 3456, 0, true], [3135, 3583, 0, true],
    [3007, 3490, 0, false], [3136, 3490, 0, false], [3090, 3455, 0, false],
    [3090, 3584, 0, false], [3090, 3490, 1, false]]) {
    f.player.setLocation(new core.Location(x, y, z));
    assert.equal(usesSmiteOnlyPrayers(f.player, f.state), expected, `${x},${y},${z}`);
  }
});

test('idle Edgeville visitors immediately clear existing protection without disabling other prayers', () => {
  const { ReplenishAfterKillNode } = require('../plugins/bots/behaviours/nodes/pvp/ReplenishAfterKillNode.PlayerBots');
  for (const prayerId of PrayerHandler.PROTECTION_PRAYERS) {
    const f = prayerHarness();
    f.player.setLocation(new core.Location(3090, 3531));
    PrayerHandler.activatePrayerPrayerId(f.player, PrayerHandler.PIETY);
    PrayerHandler.activatePrayerPrayerId(f.player, PrayerHandler.PROTECT_ITEM);
    PrayerHandler.activatePrayerPrayerId(f.player, prayerId);
    assert.equal(PrayerHandler.isActivated(f.player, prayerId), true);
    Object.assign(f.state.pvp, { replenishPrayerId: prayerId, replenishPrayerUntil: Date.now() + 10000,
      nextPrayerReviewAt: Date.now() + 10000 });
    const node = Object.create(ReplenishAfterKillNode.prototype);
    node.PrayerHandler = PrayerHandler;
    node.eatFoodActionNode = { tick() { assert.fail('idle cleanup must not eat'); } };
    node.tick(f);
    assert.deepEqual(PrayerHandler.PROTECTION_PRAYERS.filter(id => f.player.getPrayerActive()[id]), []);
    assert.equal(f.player.getPrayerActive()[PrayerHandler.PIETY], true);
    assert.equal(f.player.getPrayerActive()[PrayerHandler.PROTECT_ITEM], true);
    assert.equal(f.state.pvp.replenishPrayerId, null);
    assert.equal(f.state.pvp.replenishPrayerUntil, 0);
    assert.equal(f.state.pvp.nextPrayerReviewAt, 0, 'the next combat review can enable Smite immediately');
  }
});

test('post-kill protection is disabled at Edgeville and retained at other sites', () => {
  const { ReplenishAfterKillNode } = require('../plugins/bots/behaviours/nodes/pvp/ReplenishAfterKillNode.PlayerBots');
  const { getEnabledWildernessHotspots } = require('../plugins/bots/behaviours/pvp/WildernessHotspotRegistry.PlayerBots');
  const spots = getEnabledWildernessHotspots().filter(spot => spot.smiteOnly);
  for (const site of [...spots, { id: 'varrock_ditch', smiteOnly: false },
    { id: null, smiteOnly: true, location: new core.Location(3090, 3531) }]) {
    for (const profileId of ['veteran', 'elite']) {
      const f = prayerHarness();
      if (site.location) f.player.setLocation(site.location);
      Object.assign(f.state.pvp, { hotspotId: site.id, profileId, replenishAfterKillPending: true });
      const node = Object.create(ReplenishAfterKillNode.prototype);
      node.PrayerHandler = PrayerHandler;
      let meals = 0;
      node.eatFoodActionNode = { tick() { meals++; } };
      node.findClosestRealLocalPlayer = () => {
        assert.equal(site.smiteOnly, false, 'Edgeville must not choose a player to protect against');
        return f.target;
      };
      node.resolveProtectPrayerForTarget = () => PrayerHandler.PROTECT_FROM_MISSILES;
      node.tick(f);
      assert.equal(meals, 1);
      assert.equal(f.state.pvp.replenishAfterKillPending, false);
      const expected = site.smiteOnly ? [] : [profileId === 'elite'
        ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MELEE];
      assert.deepEqual(PrayerHandler.OVERHEAD_PRAYERS.filter(id => f.player.getPrayerActive()[id]), expected);
    }
  }
});

test('low prayer consumes real restore doses, obeys potion cooldowns and does not invent supplies', () => {
  for (const key of ['SUPER_RESTORE_4_', 'PRAYER_POTION_4_', 'SANFEW_SERUM_4_']) {
    const f = prayerHarness();
    f.skills.setCurrentLevel(core.Skill.PRAYER, 10, false);
    f.player.getInventory().setItem(0, new core.Item(ItemIdentifiers[key]));
    assert.equal(f.node.drinkPrayerPotion(f.player), true, key);
    assert.ok(f.skills.getCurrentLevel(core.Skill.PRAYER) > 10);
    assert.notEqual(f.player.getInventory().getItems()[0].getId(), ItemIdentifiers[key], 'one dose was consumed');
    const after = f.skills.getCurrentLevel(core.Skill.PRAYER);
    assert.equal(f.node.drinkPrayerPotion(f.player), false, 'potion cooldown blocks the next sip');
    assert.equal(f.skills.getCurrentLevel(core.Skill.PRAYER), after);
  }
  const full = prayerHarness();
  full.player.getInventory().setItem(0, new core.Item(ItemIdentifiers.SUPER_RESTORE_4_));
  assert.equal(full.node.drinkPrayerPotion(full.player), false, 'healthy prayer does not waste a restore');
  const empty = prayerHarness();
  empty.skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  assert.equal(empty.node.drinkPrayerPotion(empty.player), false, 'no supplies means no free prayer');
  empty.player.getInventory().setItem(0, new core.Item(ItemIdentifiers.SUPER_RESTORE_4_));
  empty.player.canDrink = false;
  assert.equal(empty.node.drinkPrayerPotion(empty.player), false, 'area potion bans preserve the dose');
  assert.equal(empty.skills.getCurrentLevel(core.Skill.PRAYER), 0);
});


test('a stacked food decrement is recognised as a successful eat', () => {
  const h = buildHarness();
  h.state.pvp.loadoutId = 'edge_main_melee';
  h.setHp(5);
  h.setItems([ItemIdentifiers.PURPLE_SWEETS]);
  h.player.getInventory().getItems()[0].setAmount(3);
  assert.equal(h.tick(), 'success');
  assert.equal(h.player.getInventory().getItems()[0].getAmount(), 2);
  assert.equal(h.state.virtualFoodChargesRemaining, 1, 'the occupied food slot remains available');
});


test('novice and standard bots stop safe eating and leave combo saves to veteran tiers', () => {
  for (const profileId of ['novice', 'standard', 'veteran', 'elite']) {
    const h = buildHarness(1, profileId);
    h.state.pvp.loadoutId = 'low_level_pure';
    h.setHp(30);
    h.setFood(2);
    assert.equal(h.tick(), 'failure', `${profileId} does not safe eat at half HP`);
    h.setHp(5);
    h.setItems([ItemIdentifiers.SHARK, ItemIdentifiers.COOKED_KARAMBWAN]);
    assert.equal(h.tick(), 'success');
    assert.equal(h.state.virtualFoodChargesRemaining, ['veteran', 'elite'].includes(profileId) ? 0 : 1,
      `${profileId} combo eating`);
  }
});

test('elite bots react to imminent lethal damage more reliably than veterans; lower tiers cannot', t => {
  t.mock.method(Math, 'random', () => 0.8);
  for (const profileId of ['novice', 'standard', 'veteran', 'elite']) {
    const h = buildHarness(0, profileId);
    h.state.pvp.loadoutId = 'low_level_pure';
    h.setHp(40);
    h.setFood(1);
    h.player.getHitpointsAfterPendingDamage = () => 0;
    assert.equal(h.tick(), profileId === 'elite' ? 'success' : 'failure', profileId);
  }
  t.mock.method(Math, 'random', () => 0.6);
  const veteran = buildHarness(0, 'veteran');
  veteran.state.pvp.loadoutId = 'low_level_pure';
  veteran.setHp(40);
  veteran.setFood(1);
  veteran.player.getHitpointsAfterPendingDamage = () => 0;
  assert.equal(veteran.tick(), 'success');
  const safe = buildHarness(0, 'elite');
  safe.state.pvp.loadoutId = 'low_level_pure';
  safe.setHp(40);
  safe.setFood(1);
  safe.player.getHitpointsAfterPendingDamage = () => 1;
  assert.equal(safe.tick(), 'failure', 'nonlethal pending damage does not trigger early eating');
});

test('restore timing follows bot skill and a one-Prayer pure never wastes a dose', () => {
  const { getPvpProfile } = require('../plugins/bots/behaviours/pvp/PvpProfileRegistry.PlayerBots');
  for (const [current, expected] of [[10, ['standard', 'veteran', 'elite']], [20, ['veteran', 'elite']], [26, ['elite']]]) {
    for (const profileId of ['novice', 'standard', 'veteran', 'elite']) {
      const f = prayerHarness();
      f.skills.setCurrentLevel(core.Skill.PRAYER, current, false);
      f.player.getInventory().setItem(0, new core.Item(ItemIdentifiers.SUPER_RESTORE_4_));
      assert.equal(f.node.drinkPrayerPotion(f.player, getPvpProfile(profileId)), expected.includes(profileId),
        `${profileId} at ${current} prayer`);
    }
  }
  const pure = prayerHarness({ prayer: 1 });
  pure.player.getInventory().setItem(0, new core.Item(ItemIdentifiers.SUPER_RESTORE_4_));
  assert.equal(pure.node.drinkPrayerPotion(pure.player, getPvpProfile('elite')), false);
  assert.equal(pure.player.getInventory().getItems()[0].getId(), ItemIdentifiers.SUPER_RESTORE_4_);
});
