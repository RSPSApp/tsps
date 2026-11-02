// Run after `yarn build`: node --test tests/league-pacts-ranged.test.cjs
// Demonic Pacts' ranged pacts (leaguepacts/Ranged.LeaguePacts.js): each effect for a Demonic Pacts
// character with the pact, and for nobody else.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { GameConstants } = require("../dist/game/GameConstants");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const EquipmentEffects = require("../dist/game/content/combat/EquipmentEffects");

let core;
let Common;
let Ranged;
const hooks = {};
const custom = {};
const providers = [];
/** The core's roll events, as the handlers left them. */
const rolls = [];
const realRandom = Math.random;
const restore = [];

const HILL_GIANT = 2098;
const RUNE_CROSSBOW = 9185;
const HEAVY_BALLISTA = 19481;
const MAGIC_SHORTBOW = 861;
const DRAGON_DART = 11230;
const ECLIPSE_ATLATL = 29000;
const TWO_HANDED_SWORD = 1319;
const RUNE_ARROW = 892;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      for (const attached of lists[name]) attached(event);
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? 6 : fallback), // a Demonic Pacts world
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand() {},
    onInterfaceActionButton() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
    // The formulas' modifiers and bonus providers are the core's own, so real max hits and rolls use them.
    registerCombatEffectiveLevelModifier: (modifier) => EquipmentEffects.registerCombatEffectiveLevelModifier(modifier),
    registerRangedHitModifier: (modifier) => EquipmentEffects.registerRangedHitModifier(modifier),
    registerMeleeHitModifier: (modifier) => EquipmentEffects.registerMeleeHitModifier(modifier),
    registerMagicHitModifier: (modifier) => EquipmentEffects.registerMagicHitModifier(modifier),
    registerMeleeAttackAccuracyModifier: (modifier) => EquipmentEffects.registerMeleeAttackAccuracyModifier(modifier),
    registerRangedAttackAccuracyModifier: (modifier) => EquipmentEffects.registerRangedAttackAccuracyModifier(modifier),
    registerMagicAttackAccuracyModifier: (modifier) => EquipmentEffects.registerMagicAttackAccuracyModifier(modifier),
    registerBonusProvider: (provider) => {
      providers.push(provider);
      PluginManager.registerBonusProviderInternal("LeaguePacts", provider);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  Ranged = require("../plugins/modes/leaguepacts/Ranged.LeaguePacts");
  // The core's own hooks and events reach the handlers attached above.
  const realCustom = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => {
    for (const handler of custom[name] ?? []) handler(payload);
    return realCustom.call(PluginManager, name, payload);
  };
  const realRoll = PluginManager.emitCombatHitRoll;
  PluginManager.emitCombatHitRoll = (event) => {
    hooks.onCombatHitRoll?.(event);
    rolls.push(event);
    return realRoll.call(PluginManager, event);
  };
  const realDamage = PluginManager.emitCombatHitDamage;
  PluginManager.emitCombatHitDamage = (event) => {
    hooks.onCombatHitDamage?.(event);
    return realDamage.call(PluginManager, event);
  };
});

afterEach(() => {
  Math.random = realRandom;
  while (restore.length) restore.pop()();
  rolls.length = 0;
});

/** Replaces `object[key]` for this test only. */
function stub(object, key, value) {
  const original = object[key];
  object[key] = value;
  restore.push(() => (object[key] = original));
}

/** Math.random answers from a queue, then `rest`. */
function randoms(values, rest = 0.5) {
  const queue = [...values];
  Math.random = () => (queue.length ? queue.shift() : rest);
}

function character(name, profile = "league") {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setRegistered(true);
  player.setLocation(new Location(3200, 3200, 0));
  const sent = { varbits: new Map(), graphics: [] };
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendVarbit" ? (id, value) => (sent.varbits.set(id, value), sender) : () => sender),
  });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getDialogueManager = () => ({ startDialogues() {} });
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  const perform = player.performGraphic.bind(player);
  player.performGraphic = (graphic) => (sent.graphics.push(graphic.id), perform(graphic));
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  // A new Demonic Pacts character starts with the starter kit; these tests bring their own items.
  player.getInventory().resetItems();
  return Object.assign(player, { sent });
}

/** Every node of these effects (or the first `count` of one). */
function nodesOf(varbit, count = Infinity) {
  return Common.nodes.filter((node) => node.varbit === varbit).slice(0, count).map((node) => node.index);
}

/** A Demonic Pacts character with the pacts, and a main character with the same saved pacts. */
function pair(name, nodes) {
  const pacts = character(`${name}-pacts`);
  const main = character(`${name}-main`, "main");
  Common.save(pacts, nodes);
  Common.save(main, nodes);
  return [pacts, main];
}

/** Wields an item as the weapon interface its item-gameplay entry names. */
function wield(player, itemId, weaponInterface) {
  const definition = core.ItemDefinition.forId(itemId);
  if (!definition.getWeaponInterface()) definition.weaponInterface = core.WeaponInterfaces[weaponInterface];
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(itemId));
  player.setWeapon(core.WeaponInterfaces[weaponInterface]);
  core.BonusManager.update(player);
}

function npc() {
  const target = new NPC(HILL_GIANT, new Location(3200, 3203, 0));
  const queued = [];
  target.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  return Object.assign(target, { queued });
}

const RANGED = () => core.CombatType.RANGED;
const rollEvent = (attacker, target, combatType = RANGED()) => ({ attacker, target, combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false });
const fakeHit = (overrides = {}) => ({ getCombatType: () => RANGED(), isAccurate: () => true, getTotalDamage: () => 5, ...overrides });

test("bows attack a tick faster and crossbows two slower (ballistae too), for a Demonic Pacts character only", () => {
  const [pacts, main] = pair("speed", [...nodesOf("talent_bow_fast_hits"), ...nodesOf("talent_crossbow_slow_big_hits")]);
  const speed = (player, combatType = RANGED()) => {
    const event = { attacker: player, target: npc(), combatType, speed: 5 };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  wield(main, MAGIC_SHORTBOW, "SHORTBOW");
  assert.equal(speed(pacts), 4);
  assert.equal(speed(main), 5);
  wield(pacts, ECLIPSE_ATLATL, "SHORTBOW");
  assert.equal(speed(pacts), 5, "the Eclipse atlatl is no bow to the pacts");
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  wield(main, RUNE_CROSSBOW, "CROSSBOW");
  assert.equal(speed(pacts), 7);
  assert.equal(speed(main), 5);
  wield(pacts, HEAVY_BALLISTA, "BALLISTA");
  assert.equal(speed(pacts), 7, "a ballista is a crossbow");
  assert.equal(speed(pacts, core.CombatType.MELEE), 5, "ranged attacks only");
});

test("the % ranged damage nodes and crossbows' +70% raise the ranged max hit; each node is +10% accuracy", () => {
  const [pacts, main] = pair("damage", [...nodesOf("talent_percentage_ranged_damage"), ...nodesOf("talent_crossbow_slow_big_hits")]);
  const nodes = nodesOf("talent_percentage_ranged_damage").length;
  assert.equal(Common.effect(pacts, "talent_percentage_ranged_damage"), nodes);
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  wield(main, MAGIC_SHORTBOW, "SHORTBOW");
  assert.equal(EquipmentEffects.applyRangedHitModifiers(pacts, 50), Math.floor((50 * (100 + nodes)) / 100));
  assert.equal(EquipmentEffects.applyRangedHitModifiers(main, 50), 50);
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  assert.equal(EquipmentEffects.applyRangedHitModifiers(pacts, 50), Math.floor((Math.floor((50 * (100 + nodes)) / 100) * 170) / 100));
  for (const apply of ["applyMeleeAttackAccuracyModifiers", "applyRangedAttackAccuracyModifiers", "applyMagicAttackAccuracyModifiers"]) {
    assert.equal(EquipmentEffects[apply](pacts, 1000), 1000 + 100 * nodes, apply);
    assert.equal(EquipmentEffects[apply](main, 1000), 1000, apply);
  }
});

test("ranged prayers are 30% more effective: Rigour's 20% accuracy and 23% strength become 26% and 29.9%", () => {
  const [pacts, main] = pair("prayers", nodesOf("talent_buffed_ranged_prayers"));
  stub(core.PrayerHandler, "isActivated", (player, prayer) => prayer === core.PrayerHandler.RIGOUR);
  const level = (player, purpose) => EquipmentEffects.applyCombatEffectiveLevelModifiers(player, 1000, { combatType: RANGED(), purpose });
  assert.equal(level(pacts, "accuracy"), 1000 + Math.floor(99 * 1.26) - Math.floor(99 * 1.2));
  assert.equal(level(pacts, "damage"), 1000 + Math.floor((99 * 1299) / 1000) - Math.floor(99 * 1.23));
  assert.equal(level(main, "accuracy"), 1000);
  assert.equal(EquipmentEffects.applyCombatEffectiveLevelModifiers(pacts, 1000, { combatType: core.CombatType.MELEE, purpose: "accuracy" }), 1000, "ranged only");
});

test("thrown weapons: +60 ranged accuracy and 80% of the melee strength as ranged strength, the atlatl included", () => {
  const [pacts, main] = pair("thrown-bonus", [...nodesOf("talent_thrown_weapon_accuracy"), ...nodesOf("talent_thrown_weapon_melee_str_scale")]);
  const bonuses = (player) => {
    const values = new Array(14).fill(0);
    values[10] = 51; // melee strength worn
    for (const provider of providers) provider.apply({ player, bonuses: values });
    return values;
  };
  wield(pacts, DRAGON_DART, "DART");
  wield(main, DRAGON_DART, "DART");
  assert.equal(bonuses(pacts)[4], 60);
  assert.equal(bonuses(pacts)[11], Math.floor(51 * 0.8));
  assert.deepEqual(bonuses(main).slice(4, 5).concat(bonuses(main)[11]), [0, 0]);
  wield(pacts, ECLIPSE_ATLATL, "SHORTBOW");
  assert.equal(bonuses(pacts)[4], 60, "the Eclipse atlatl is thrown to the pacts");
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  assert.equal(bonuses(pacts)[4], 0, "a bow is not");
});

test("ranged strength +1 per 10 hitpoints from the Hitpoints level, refreshed before a ranged roll", () => {
  const [pacts, main] = pair("hp-strength", nodesOf("talent_ranged_strength_hp_difference"));
  for (const player of [pacts, main]) {
    wield(player, MAGIC_SHORTBOW, "SHORTBOW");
    player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 64, false);
  }
  const before = pacts.getBonusManager().getOtherBonus()[1];
  hooks.onCombatHitRoll(rollEvent(pacts, npc()));
  hooks.onCombatHitRoll(rollEvent(main, npc()));
  assert.equal(pacts.getBonusManager().getOtherBonus()[1] - before, 3, "35 hitpoints below 99");
  assert.equal(main.getBonusManager().getOtherBonus()[1], before);
  pacts.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 120, false);
  hooks.onCombatHitRoll(rollEvent(pacts, npc()));
  assert.equal(pacts.getBonusManager().getOtherBonus()[1] - before, 2, "21 above it");
});

test("crossbow hits always max hit and roll accuracy twice, against NPCs", () => {
  const [pacts, main] = pair("crossbow", [...nodesOf("talent_crossbow_max_hit"), ...nodesOf("talent_crossbow_double_accuracy_roll")]);
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  wield(main, RUNE_CROSSBOW, "CROSSBOW");
  let second = false;
  stub(core.AccuracyFormulasDpsCalc, "rollAccuracy", () => second);
  let event = rollEvent(pacts, npc());
  hooks.onCombatHitRoll(event);
  assert.deepEqual([event.forceMaxHit, event.forceAccurate], [true, false], "the extra roll missed: the core's own decides");
  second = true;
  event = rollEvent(pacts, npc());
  hooks.onCombatHitRoll(event);
  assert.deepEqual([event.forceMaxHit, event.forceAccurate], [true, true]);
  event = rollEvent(main, npc());
  hooks.onCombatHitRoll(event);
  assert.deepEqual([event.forceMaxHit, event.forceAccurate], [false, false]);
  event = rollEvent(pacts, character("crossbow-victim", "main"));
  hooks.onCombatHitRoll(event);
  assert.deepEqual([event.forceMaxHit, event.forceAccurate], [false, false], "not against players");
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  event = rollEvent(pacts, npc());
  hooks.onCombatHitRoll(event);
  assert.deepEqual([event.forceMaxHit, event.forceAccurate], [false, false], "crossbows only");
});

test("crossbow attacks echo at the pact's chance: an ordinary ranged hit with the echo arrow, never from a special or an echo", () => {
  const [pacts, main] = pair("crossbow-echo", nodesOf("talent_crossbow_echo_reproc_chance"));
  const chance = Common.effect(pacts, "talent_crossbow_echo_reproc_chance") / 100;
  assert.equal(chance, 0.15);
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  wield(main, RUNE_CROSSBOW, "CROSSBOW");
  const target = npc();
  randoms([0.2]);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit() });
  assert.equal(target.queued.length, 0, "a 20 misses the 15%");
  randoms([0.1]);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit({ isAccurate: () => false }) });
  assert.equal(target.queued.length, 1, "a miss echoes too");
  const echo = target.queued[0];
  assert.ok(Ranged.isEcho(echo));
  assert.equal(echo.getCombatType(), RANGED());
  assert.equal(echo.getAttacker(), pacts);
  assert.ok(echo.getDelay() >= 1);
  const vfx = ["leagues_6_ranged_mastery_vfx_left", "leagues_6_ranged_mastery_vfx_right"].map((name) => CacheDefinitions.getSpotanimId(name));
  assert.ok(vfx.includes(pacts.sent.graphics.at(-1)), "the echo's vfx on the player");
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: echo });
  assert.equal(target.queued.length, 1, "an echo does not echo without the cyclical pact");

  const special = fakeHit();
  pacts.setSpecialActivated(true);
  hooks.onCombatHitDamage({ attacker: pacts, target, combatType: RANGED(), hit: special, damage: null, accurate: true });
  pacts.setSpecialActivated(false);
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: special });
  assert.equal(target.queued.length, 1, "never from a special attack");
  hooks.onCombatHitResolved({ attacker: pacts, target: character("echo-victim", "main"), hit: fakeHit() });
  hooks.onCombatHitResolved({ attacker: main, target, hit: fakeHit() });
  assert.equal(target.queued.length, 1, "not against players, nor for a main character");
});

test("cyclical echoes chain at half the chance, up to four more", () => {
  const [pacts] = pair("cyclical", [...nodesOf("talent_crossbow_echo_reproc_chance"), ...nodesOf("talent_ranged_echo_cyclical")]);
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  const target = npc();
  randoms([0.1]);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit() });
  assert.equal(target.queued.length, 1);
  randoms([], 0.08);
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: target.queued[0] });
  assert.equal(target.queued.length, 1, "an 8 misses half of 15%");
  randoms([], 0.07);
  for (let chained = 1; chained <= 4; chained++) {
    hooks.onCombatHitResolved({ attacker: pacts, target, hit: target.queued.at(-1) });
    assert.equal(target.queued.length, 1 + chained);
  }
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: target.queued.at(-1) });
  assert.equal(target.queued.length, 5, "the fourth chained echo is the last");
});

test("echoes never miss with a bow (not the atlatl) and max hit a fifth of the time with a thrown weapon (the atlatl too)", () => {
  const [pacts, main] = pair("echo-weapons", [...nodesOf("talent_bow_echo_pass_accuracy"), ...nodesOf("talent_thrown_maxhit_echoes"), ...nodesOf("talent_ranged_regen_echo_chance")]);
  const target = npc();
  const echoRoll = (player) => {
    rolls.length = 0;
    custom["league:pact-ranged-echo"].forEach((handler) => handler({ player, target, source: "ranged" }));
    return rolls.at(-1);
  };
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  wield(main, MAGIC_SHORTBOW, "SHORTBOW");
  assert.equal(echoRoll(pacts).forceAccurate, true);
  assert.equal(echoRoll(main), undefined, "a main character fires no echo");
  wield(pacts, ECLIPSE_ATLATL, "SHORTBOW");
  randoms([0.19]);
  let roll = echoRoll(pacts);
  assert.deepEqual([roll.forceAccurate, roll.forceMaxHit], [false, true], "the atlatl: thrown, no bow");
  wield(pacts, DRAGON_DART, "DART");
  randoms([0.21]);
  roll = echoRoll(pacts);
  assert.equal(roll.forceMaxHit, false, "a 21 misses the 20%");
  // An ordinary dart throw is not an echo.
  roll = rollEvent(pacts, target);
  randoms([0.01]);
  hooks.onCombatHitRoll(roll);
  assert.equal(roll.forceMaxHit, false);
});

test("Regenerated ammo fires an echo at the pact's chance (5% a small node), not on a special", () => {
  const [pacts, main] = pair("regen-echo", nodesOf("talent_ranged_regen_echo_chance"));
  const chance = Common.effect(pacts, "talent_ranged_regen_echo_chance");
  assert.equal(chance, 35, "25 + 5 + 5");
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  const target = npc();
  const regenerate = (player, extra = {}) => custom["league:pact-regenerated"].forEach((handler) => handler({ player, kind: "ammo", target, ...extra }));
  randoms([0.36]);
  regenerate(pacts);
  assert.equal(target.queued.length, 0);
  randoms([0.34]);
  regenerate(pacts);
  assert.equal(target.queued.length, 1);
  assert.ok(Ranged.isEcho(target.queued[0]));
  randoms([0.01]);
  regenerate(pacts, { kind: "runes" });
  regenerate(pacts, { special: true });
  regenerate(main);
  assert.equal(target.queued.length, 1, "ammo only, never a special, only a Demonic Pacts character");
});

test("a melee echo rolls the melee stats against the ranged defence, with the bow pact as if a bow were wielded", () => {
  const [pacts] = pair("melee-echo", nodesOf("talent_bow_echo_pass_accuracy"));
  wield(pacts, TWO_HANDED_SWORD, "TWO_HANDED_SWORD");
  const target = npc();
  rolls.length = 0;
  custom["league:pact-ranged-echo"].forEach((handler) => handler({ player: pacts, target, source: "melee" }));
  assert.equal(target.queued.length, 1);
  const echo = target.queued[0];
  assert.ok(Ranged.isEcho(echo));
  assert.equal(echo.getCombatType(), core.CombatType.MELEE);
  assert.equal(echo.getCombatMethod().accuracyDefenceType(core.CombatType.MELEE), RANGED());
  assert.equal(rolls.at(-1).forceAccurate, true);
  assert.ok(echo.isAccurate());
  custom["league:pact-ranged-echo"].forEach((handler) => handler({ player: pacts, target: character("melee-echo-victim", "main"), source: "melee" }));
  assert.equal(target.queued.length, 1, "no echo against a player");
});

test("bow hits stack the min and max hit by one up to 15% of the max hit, sent to the client and halved by unprayed damage", () => {
  const [pacts, main] = pair("stacks", [...nodesOf("talent_bow_min_hit_stacking_increase"), ...nodesOf("talent_bow_max_hit_stacking_increase")]);
  const MIN = CacheDefinitions.getVarbitId("talent_bow_min_hit_stacks");
  const MAX = CacheDefinitions.getVarbitId("talent_bow_max_hit_stacks");
  for (const player of [pacts, main]) {
    player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, new core.Item(RUNE_ARROW, 100));
    wield(player, MAGIC_SHORTBOW, "SHORTBOW");
  }
  const base = core.DamageFormulas.calculateMaxRangedHit(main);
  const cap = Math.floor(base * 0.15);
  assert.ok(cap >= 2, `a cap to test (${base})`);
  const target = npc();
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit() });
  hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit({ isAccurate: () => false }) });
  hooks.onCombatHitResolved({ attacker: main, target, hit: fakeHit() });
  assert.deepEqual([pacts.sent.varbits.get(MIN), pacts.sent.varbits.get(MAX)], [1, 1], "a miss adds none");
  assert.equal(main.sent.varbits.get(MAX), undefined);
  assert.equal(core.DamageFormulas.calculateMaxRangedHit(pacts), base + 1);
  for (let i = 0; i < cap + 3; i++) hooks.onCombatHitResolved({ attacker: pacts, target, hit: fakeHit() });
  assert.deepEqual([pacts.sent.varbits.get(MIN), pacts.sent.varbits.get(MAX)], [cap, cap]);
  assert.equal(core.DamageFormulas.calculateMaxRangedHit(pacts), base + cap);
  const rolled = (player, damage) => {
    const event = { attacker: player, target, combatType: RANGED(), damage, minimum: 0, maximum: base + cap };
    custom["combat:hit-rolled"].forEach((handler) => handler(event));
    return event.damage;
  };
  assert.equal(rolled(pacts, 0), cap);
  assert.equal(rolled(main, 0), 0);

  const npcHit = (type, damage = 4) => ({ getTotalDamage: () => damage, getProtectionType: () => type, getCombatType: () => type, bypassesProtectionPrayer: () => false, isAccurate: () => true });
  stub(core.PrayerHandler, "isActivated", (player, prayer) => prayer === core.PrayerHandler.PROTECT_FROM_MELEE);
  hooks.onCombatHitResolved({ attacker: target, target: pacts, hit: npcHit(core.CombatType.MELEE) });
  assert.equal(pacts.sent.varbits.get(MAX), cap, "prayed against: kept");
  hooks.onCombatHitResolved({ attacker: target, target: pacts, hit: npcHit(core.CombatType.RANGED, 0) });
  assert.equal(pacts.sent.varbits.get(MAX), cap, "no damage: kept");
  hooks.onCombatHitResolved({ attacker: target, target: pacts, hit: npcHit(core.CombatType.RANGED) });
  assert.deepEqual([pacts.sent.varbits.get(MIN), pacts.sent.varbits.get(MAX)], [Math.floor(cap / 2), Math.floor(cap / 2)]);
  wield(pacts, RUNE_CROSSBOW, "CROSSBOW");
  assert.equal(rolled(pacts, 0), 0, "bows only");
});

test("a thrown attack throws again at the nearest other NPC nearby, once an attack, never on a special", () => {
  const [pacts, main] = pair("multi", nodesOf("talent_thrown_weapon_multi"));
  const target = npc();
  const nearby = npc();
  stub(core.World, "getNpcsNear", () => [target, nearby]);
  stub(core.CombatFactory, "canAttackSecondaryTarget", (attacker, primary, candidate) => candidate !== primary);
  const attack = (player, cycle) => {
    core.World.processCycle = cycle;
    hooks.onCombatHitDamage({ attacker: player, target, combatType: RANGED(), hit: {}, damage: null, accurate: true });
  };
  wield(pacts, DRAGON_DART, "DART");
  wield(main, DRAGON_DART, "DART");
  attack(pacts, 1);
  attack(pacts, 1);
  assert.equal(nearby.queued.length, 1, "one extra throw an attack");
  const extra = nearby.queued[0];
  assert.equal(extra.getCombatType(), RANGED());
  assert.equal(Ranged.isEcho(extra), false);
  attack(main, 2);
  pacts.setSpecialActivated(true);
  attack(pacts, 3);
  pacts.setSpecialActivated(false);
  wield(pacts, MAGIC_SHORTBOW, "SHORTBOW");
  attack(pacts, 4);
  assert.equal(nearby.queued.length, 1, "not for a main character, a special or a bow");
  assert.equal(target.queued.length, 0);
  core.World.processCycle = 0;
});
