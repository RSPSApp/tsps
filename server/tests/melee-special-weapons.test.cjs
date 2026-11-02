// Run after `yarn build`: node --test tests/melee-special-weapons.test.cjs
// Swords, longswords, claws, spears, hastas, halberds and the ancient mace: the registered specials
// (energy, rolls, variants), their one-shot drain, Shove's immunity rules, the claws' roll order,
// Sweep's large-target double hit, the specials that pierce NPC melee prayers, Favour's prayer
// transfer, and that hastas use no ammunition or charges.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { AccuracyFormulasDpsCalc } = require("../dist/game/content/combat/formula/AccuracyFormulasDpsCalc");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
const { SpecialAttackTargetingResolver } = require("../dist/game/content/combat/SpecialAttackTargeting");
const { CombatType } = require("../dist/game/content/combat/CombatType");
const { RangedWeapon } = require("../dist/game/content/combat/ranged/RangedData");
const { TimerKey } = require("../dist/util/timers/TimerKey");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const items = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "definitions", "item-gameplay.json"), "utf8"),
);

/** Death, logout and hit-roll handlers the specials register, by hook name. */
const hooks = {};

before(() => {
  // Only the specials registry and the death/logout/hit-roll hooks matter here; other hooks are no-ops.
  const api = {
    onCombatHitRoll: (handler) => (hooks.onCombatHitRoll ??= []).push(handler),
    onPlayerDefeated: (handler) => (hooks.onPlayerDefeated ??= []).push(handler),
    onPlayerLogout: (handler) => (hooks.onPlayerLogout ??= []).push(handler),
    onNpcDeath: (handler) => (hooks.onNpcDeath ??= []).push(handler),
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: CombatSpecial.register,
    getBonusManager: () => require("../dist/game/model/equipment/BonusManager").BonusManager,
  };
  require("../plugins/combat/SpecialAttacks.plugin").register(
    new Proxy(api, { get: (target, key) => (key in target ? target[key] : () => {}) }),
  );
});

/** A player-shaped attacker that records what the specials do to it. */
function fakeFighter({ special = 100, inDuelNoMovement = false } = {}) {
  const log = { drains: [], messages: [], animations: 0, graphics: 0, bars: 0, area: [] };
  const fighter = {
    log,
    special,
    activated: true,
    attackDelay: undefined,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    isPlayerBot: () => true,
    getSpecialPercentage() { return this.special; },
    decrementSpecialPercentage(amount) { this.special -= amount; log.drains.push(amount); },
    isRecoveringSpecialAttack: () => true, // no restore task in a unit test
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(value) { this.activated = value; },
    getPacketSender: () => ({
      updateSpecialAttackOrb() { log.bars++; },
      sendSpecialAttackState() {},
      sendString() {},
      sendInterfaceComponentMoval() {},
      sendInterfaceDisplayState() {},
      sendSoundEffect() {},
      sendAreaSound(...args) { log.area.push(args); },
    }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    performAnimation() { log.animations++; },
    performGraphic() { log.graphics++; },
    getAttackAnim: () => -1,
    getAttackSound: () => null,
    sendMessage(message) { log.messages.push(message); },
    getBaseAttackSpeed: () => 4,
    getLocation: () => ({ getX: () => 3199, getY: () => 3200, getZ: () => 0 }),
    getDueling: () => ({
      inDuel: () => inDuelNoMovement,
      getRules: () => ({ [require("../dist/game/content/Duelling").DuelRule.NO_MOVEMENT.getButtonId()]: true }),
    }),
    getCombat: () => ({ setAttackDelay(ticks) { fighter.attackDelay = ticks; } }),
  };
  return fighter;
}

/** A victim with real timers semantics for the stun rules. */
function fakeTarget({ size = 1, timers = [] } = {}) {
  const active = new Map(timers.map((key) => [key, 1]));
  const log = { stunned: false, animations: 0 };
  return {
    log,
    getSize: () => size,
    isPlayer: () => false,
    isNpc: () => true,
    getTimers: () => ({
      has: (key) => active.has(key),
      registers: (key, ticks) => { active.set(key, ticks); if (key === TimerKey.STUN) log.stunned = true; },
    }),
    getCombat: () => ({ reset() {} }),
    getMovementQueue: () => ({ reset() {} }),
    performAnimation() { log.animations++; },
    performGraphic() {},
    getLocation: () => ({
      getX: () => 3200, getY: () => 3200, getZ: () => 0,
      transform: () => ({ getX: () => 3201, getY: () => 3200, getZ: () => 0 }),
    }),
    getPrivateArea: () => null,
    isRegistered: () => true,
  };
}

function special(id) {
  const found = CombatSpecial.getById(id);
  assert.ok(found, `special ${id} is registered`);
  return found;
}

// --- registration: energy cost, roll traits, variants -------------------------------------

test("each melee special costs the wiki energy and carries its roll traits", () => {
  const expected = {
    dragon_sword: 40, // Wild Stab
    dragon_longsword: 25, // Cleave
    saradomin_sword: 100, // Saradomin's Lightning
    vestas_longsword: 25, // Feint
    dragon_claws: 50, // Slice and Dice
    shove: 25,
    dragon_halberd: 30, // Sweep
    burning_claws: 35, // Burning barrage (raised from 30% on 22 July 2026)
  };
  for (const [id, drain] of Object.entries(expected)) {
    assert.equal(special(id).getDrainAmount(), drain, `${id} energy`);
  }

  const wildStab = special("dragon_sword").getTraits();
  assert.equal(wildStab.accuracyMultiplier, 1.25);
  assert.equal(wildStab.damageMultiplier, 1.25);
  assert.equal(wildStab.meleeDefenceBonusIndex, 0, "rolls against stab defence");
  assert.equal(wildStab.ignoreProtectionPrayer, true);

  const cleave = special("dragon_longsword").getTraits();
  assert.equal(cleave.damageMultiplier, 1.25);
  assert.equal(cleave.meleeDefenceBonusIndex, 1, "rolls against slash defence");

  const lightning = special("saradomin_sword").getTraits();
  assert.equal(lightning.damageMultiplier, 1.1);
  assert.equal(lightning.meleeDefenceBonusIndex, 1);

  const feint = special("vestas_longsword").getTraits();
  assert.equal(feint.minimumDamageMultiplier, 0.2);
  assert.equal(feint.maximumDamageMultiplier, 1.2);
  assert.equal(feint.defenceRollMultiplier, 0.25);
  assert.equal(feint.meleeDefenceBonusIndex, 0, "rolls against stab defence");

  const sweep = special("dragon_halberd").getTraits();
  assert.equal(sweep.damageMultiplier, 1.1);
  assert.equal(sweep.meleeDefenceBonusIndex, 1);
  assert.equal(sweep.targeting.maxTargets, 10);
  assert.deepEqual(sweep.targeting.largeTargetExtraHit, { minimumSize: 2, accuracyMultiplier: 0.75 });
});

test("ornament and (cr) variants share their base weapon's special", () => {
  const shared = {
    dragon_claws: [ItemIdentifiers.DRAGON_CLAWS, ItemIdentifiers.DRAGON_CLAWS_OR_, ItemIdentifiers.DRAGON_CLAWS_CR_],
    dragon_sword: [ItemIdentifiers.DRAGON_SWORD, ItemIdentifiers.DRAGON_SWORD_CR_],
    dragon_longsword: [ItemIdentifiers.DRAGON_LONGSWORD, ItemIdentifiers.DRAGON_LONGSWORD_CR_],
    dragon_halberd: [ItemIdentifiers.DRAGON_HALBERD, ItemIdentifiers.DRAGON_HALBERD_CR_],
    shove: [
      ItemIdentifiers.DRAGON_SPEAR, ItemIdentifiers.DRAGON_SPEAR_CR_, ItemIdentifiers.DRAGON_SPEAR_P_CR_,
      ItemIdentifiers.DRAGON_SPEAR_P_CR__3, ItemIdentifiers.DRAGON_SPEAR_P_CR__5,
      ItemIdentifiers.ZAMORAKIAN_SPEAR, ItemIdentifiers.ZAMORAKIAN_HASTA,
    ],
    saradomin_sword: [ItemIdentifiers.SARADOMIN_SWORD],
    vestas_longsword: [ItemIdentifiers.VESTAS_LONGSWORD],
  };
  for (const [id, ids] of Object.entries(shared)) {
    for (const itemId of ids) {
      assert.equal(CombatSpecial.getForWeaponId(itemId), special(id), `item ${itemId} has ${id}`);
    }
  }
});

// --- specials that hit through melee protection prayers ------------------------------------

/** Runs the registered hit-roll hooks for an attack, as PendingHit does before rolling. */
function hitRoll(attacker, combatType = CombatType.MELEE) {
  const roll = { attacker, target: fakeTarget(), combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
  for (const handler of hooks.onCombatHitRoll ?? []) handler(roll);
  return roll.bypassProtectionPrayer;
}

/** A fighter holding the given weapon, its special on or off. */
function wielding(itemId, activated = true) {
  const fighter = fakeFighter();
  fighter.activated = activated;
  fighter.getCombatSpecial = () => CombatSpecial.getForWeaponId(itemId);
  return fighter;
}

test("Favour costs all the energy, rolls against crush defence and hits through Protect from Melee", () => {
  const favour = special("ancient_mace");
  assert.equal(CombatSpecial.getForWeaponId(ItemIdentifiers.ANCIENT_MACE), favour);
  assert.equal(favour.getDrainAmount(), 100);
  assert.equal(favour.getTraits().meleeDefenceBonusIndex, 2, "crush defence whatever the style (Spike is stab)");
  assert.equal(favour.getTraits().ignoreProtectionPrayer, true);
});

test("Favour plays the mace's special animation and graphic", () => {
  const animations = [];
  const graphics = [];
  const attacker = fakeFighter();
  attacker.performAnimation = (animation) => animations.push(animation.getId());
  attacker.performGraphic = (graphic) => graphics.push(graphic.getId());
  special("ancient_mace").getCombatMethod().start(attacker, fakeTarget());
  assert.deepEqual(animations, [6147], "slice_player_mace_special_attack");
  assert.deepEqual(graphics, [1052], "slice_player_mace_special_attack_spotanim");
  assert.deepEqual(attacker.log.drains, [100]);
});

test("the ancient mace and dragon sword specials pierce NPC melee prayers; the hasta's doesn't", () => {
  assert.equal(hitRoll(wielding(ItemIdentifiers.ANCIENT_MACE)), true, "Favour");
  assert.equal(hitRoll(wielding(ItemIdentifiers.DRAGON_SWORD)), true, "Wild Stab");
  assert.equal(hitRoll(wielding(ItemIdentifiers.DRAGON_SWORD_CR_)), true, "Wild Stab (cr)");
  assert.equal(hitRoll(wielding(ItemIdentifiers.DRAGON_HASTA)), false, "Unleash only ignores player prayers");
  assert.equal(hitRoll(wielding(ItemIdentifiers.ANCIENT_MACE, false)), false, "a normal mace hit");
  assert.equal(hitRoll(wielding(ItemIdentifiers.DRAGON_SWORD, false)), false, "a normal sword hit");
  assert.equal(hitRoll(wielding(ItemIdentifiers.ANCIENT_MACE), CombatType.RANGED), false, "melee only");
  assert.equal(hitRoll(fakeTarget()), false, "an NPC attacker");
});

test("Favour drains the target's Prayer by the damage and gives it to the user, above maximum by up to the damage", () => {
  const { Skill } = PluginManager.getCoreApi();
  const levels = (prayer, max) => {
    const state = { current: prayer };
    return {
      state,
      getCurrentLevel: (skill) => (skill === Skill.PRAYER ? state.current : 99),
      getMaxLevel: (skill) => (skill === Skill.PRAYER ? max : 99),
      setCurrentLevels: (skill, level) => { if (skill === Skill.PRAYER) state.current = level; },
    };
  };
  const person = (skills) => ({ isPlayer: () => true, getAsPlayer() { return this; }, getSkillManager: () => skills });
  const user = levels(90, 99);
  const victim = levels(20, 70);
  const landed = (damage, accurate = true) => ({
    isAccurate: () => accurate,
    getTotalDamage: () => damage,
    getTarget: () => person(victim),
    getAttacker: () => person(user),
  });
  const favour = special("ancient_mace").getCombatMethod();

  favour.handleAfterHitEffects(landed(30));
  assert.equal(victim.state.current, 0, "drained to 0, not below");
  assert.equal(user.state.current, 120, "90 + 30, above the 99 maximum");
  favour.handleAfterHitEffects(landed(25));
  assert.equal(user.state.current, 124, "capped at the maximum plus this hit's damage");
  favour.handleAfterHitEffects(landed(25, false));
  assert.equal(user.state.current, 124, "a miss transfers nothing");
});

// --- energy drains exactly once, the bar follows, toggling off cancels ---------------------

test("starting a melee special drains its energy exactly once and refreshes the bar", () => {
  for (const id of ["dragon_sword", "dragon_longsword", "saradomin_sword", "vestas_longsword", "dragon_claws", "dragon_halberd"]) {
    const attacker = fakeFighter();
    const method = special(id).getCombatMethod();
    method.start(attacker, fakeTarget());
    assert.deepEqual(attacker.log.drains, [special(id).getDrainAmount()], `${id} drains once`);
    assert.equal(attacker.special, 100 - special(id).getDrainAmount());
    assert.equal(attacker.log.bars, 1, `${id} updates the special orb once`);
  }
});

test("pressing the special bar again switches an activated special off", () => {
  const player = fakeFighter();
  player.getCombatSpecial = () => special("dragon_claws");
  CombatSpecial.activate(player);
  assert.equal(player.activated, false);
  assert.deepEqual(player.log.drains, [], "toggling off spends nothing");
  assert.equal(player.log.bars, 1);
});

test("a weapon with no registered special has no special state", () => {
  const sent = [];
  const player = fakeFighter();
  player.getEquipment = () => ({ get: () => ({ getId: () => ItemIdentifiers.BRONZE_HASTA }) });
  player.getWeapon = () => ({ getSpecialBar: () => 7, getSpecialMeter: () => 8 });
  player.getPacketSender = () => ({ sendInterfaceDisplayState: (id, hidden) => sent.push([id, hidden]), sendSpecialAttackState() {} });
  let assigned = "unset";
  player.setCombatSpecial = (value) => { assigned = value; };
  CombatSpecial.assign(player);
  assert.equal(assigned, null);
  assert.equal(player.activated, false);
  assert.deepEqual(sent, [[7, true]], "the special bar widget is hidden");
});

// --- Shove: knockback, stun and immunity ---------------------------------------------------

test("Shove stuns a normal target for 5 ticks, costs 25% once and sets the 5-tick swing", () => {
  const attacker = fakeFighter();
  const target = fakeTarget();
  special("shove").getCombatMethod().start(attacker, target);
  assert.deepEqual(attacker.log.drains, [25]);
  assert.equal(target.log.stunned, true);
  assert.equal(attacker.attackDelay, 5, "Shove takes 5 ticks against the spear's 4");
  assert.equal(attacker.activated, false);
});

test("Shove leaves large, stunned and stun-immune targets untouched and spends no energy", () => {
  const cases = [
    ["large target", fakeTarget({ size: 2 }), "That creature is too large to knock back!"],
    ["already stunned", fakeTarget({ timers: [TimerKey.STUN] })],
    ["stun grace period", fakeTarget({ timers: [TimerKey.STUN_IMMUNITY] })],
  ];
  for (const [label, target, message] of cases) {
    const attacker = fakeFighter();
    special("shove").getCombatMethod().start(attacker, target);
    assert.deepEqual(attacker.log.drains, [], `${label}: no energy`);
    assert.equal(target.log.stunned, false, `${label}: no stun`);
    assert.equal(target.log.animations, 0, `${label}: no state change`);
    assert.equal(attacker.log.animations, 0, `${label}: no swing`);
    assert.equal(attacker.activated, false, `${label}: special switched off`);
    assert.equal(attacker.attackDelay, undefined, `${label}: no extra delay`);
    if (message) assert.deepEqual(attacker.log.messages, [message]);
  }
});

test("Shove is refused in a duel that bans movement", () => {
  const attacker = fakeFighter({ inDuelNoMovement: true });
  const target = fakeTarget();
  special("shove").getCombatMethod().start(attacker, target);
  assert.deepEqual(attacker.log.drains, []);
  assert.equal(target.log.stunned, false);
  assert.equal(attacker.activated, false);
});

// --- Slice and Dice: roll order and damage distribution -----------------------------------

test("dragon claws distribute the first landing roll into the 4-2-1-1 chains", () => {
  const ranges = special("dragon_claws").getTraits().firstSuccessfulAccuracyDamageRanges;
  assert.equal(ranges.length, 4);
  // Wiki examples: 35-17-8-9, 0-30-15-16, 0-0-22-23, 0-0-0-46.
  assert.deepEqual(ranges[0].distributeDamage(35, 4), [35, 17, 8, 9]);
  assert.deepEqual(ranges[1].distributeDamage(30, 4), [0, 30, 15, 16]);
  assert.deepEqual(ranges[2].distributeDamage(22, 4), [0, 0, 22, 23]);
  assert.deepEqual(ranges[3].distributeDamage(46, 4), [0, 0, 0, 46]);
  assert.equal(ranges[0].minimumDamageMultiplier, 0.5);
  assert.equal(ranges[0].maximumDamageReduction, 1, "first branch maximum is one below the normal max");
  assert.equal(ranges[1].minimumDamageMultiplier, 3 / 8);
  assert.equal(ranges[1].maximumDamageMultiplier, 7 / 8);
  assert.equal(ranges[2].maximumDamageMultiplier, 3 / 4);
  assert.equal(ranges[3].maximumDamageMultiplier, 5 / 4);
  assert.deepEqual(special("dragon_claws").getTraits().hitDelayTicks, [0, 0, 1, 1]);
});

/** Runs PendingHit's claws branch with scripted accuracy rolls and a fixed base damage. */
function resolveClaws(rolls, baseDamage, random = 0.5, id = "dragon_claws") {
  const traits = special(id).getTraits();
  const realAccuracy = AccuracyFormulasDpsCalc.rollAccuracy;
  const realDamage = CombatFactory.getHitDamage;
  const realRandom = Math.random;
  const attempts = [];
  AccuracyFormulasDpsCalc.rollAccuracy = () => { attempts.push(rolls[attempts.length] ?? false); return attempts[attempts.length - 1]; };
  CombatFactory.getHitDamage = () => new HitDamage(baseDamage, 1);
  Math.random = () => random;
  try {
    const hit = Object.create(PendingHit.prototype);
    hit.attacker = {};
    hit.target = {};
    hit.combatType = CombatType.MELEE;
    hit.method = { accuracyDefenceType: () => undefined };
    const hits = hit.resolveFirstSuccessfulRanges(traits, (damage) => damage);
    return { hits: hits.map((h) => h.getDamage()), attempts, accurate: hit.accurate, hit };
  } finally {
    AccuracyFormulasDpsCalc.rollAccuracy = realAccuracy;
    CombatFactory.getHitDamage = realDamage;
    Math.random = realRandom;
  }
}

test("dragon claws roll up to four times and stop at the first landing roll", () => {
  const first = resolveClaws([true], 35);
  assert.deepEqual(first.hits, [35, 17, 8, 9]);
  assert.deepEqual(first.attempts, [true], "later rolls are not made once one lands");

  const second = resolveClaws([false, true], 30);
  assert.deepEqual(second.hits, [0, 30, 15, 16]);
  assert.equal(second.attempts.length, 2);

  const third = resolveClaws([false, false, true], 22);
  assert.deepEqual(third.hits, [0, 0, 22, 23]);

  const fourth = resolveClaws([false, false, false, true], 46);
  assert.deepEqual(fourth.hits, [0, 0, 0, 46]);
  assert.equal(fourth.attempts.length, 4);
});

test("four missed dragon claws rolls deal 0 or a 2-damage split, never anything else", () => {
  const outcomes = new Set();
  for (let i = 0; i < 6; i++) {
    const result = resolveClaws([], 0, (i + 0.5) / 6);
    outcomes.add(result.hits.join("-"));
    assert.ok(result.hits.reduce((a, b) => a + b, 0) <= 2);
  }
  assert.deepEqual([...outcomes].sort(), ["0-0-0-0", "0-0-1-1", "0-1-0-1", "1-0-1-0", "1-1-0-0"]);
});

// --- Burning barrage: three hitsplats from the first landing roll, then burns ------------------

test("burning claws split the first landing roll over three hitsplats and name the roll", () => {
  // Wiki (Burning claws), max hit 39: a first-roll 29 splits 7-7-14.
  const first = resolveClaws([true], 29, 0.5, "burning_claws");
  assert.deepEqual(first.hits, [7, 7, 14]);
  assert.equal(first.hit.getFirstSuccessfulRangeIndex(), 0);

  const second = resolveClaws([false, true], 20, 0.5, "burning_claws");
  assert.deepEqual(second.hits, [9, 9, 2]);
  assert.equal(second.hit.getFirstSuccessfulRangeIndex(), 1);

  const third = resolveClaws([false, false, true], 20, 0.5, "burning_claws");
  assert.deepEqual(third.hits, [1, 1, 18]);
  assert.equal(third.hit.getFirstSuccessfulRangeIndex(), 2);
  assert.equal(third.attempts.length, 3, "three accuracy rolls at most");

  const missed = resolveClaws([], 0, 0.5, "burning_claws");
  assert.equal(missed.hit.getFirstSuccessfulRangeIndex(), -1, "a full miss is not a landing roll");
  assert.ok(missed.hits.reduce((a, b) => a + b, 0) <= 2);
});

/** A burn victim whose queued burn damage is counted, with Math.random scripted per hitsplat. */
function burnVictim() {
  // Earlier tests leave Shove tasks aimed at fakes; they would abort every TaskManager.process().
  TaskManager.activeTasks.length = 0;
  while (TaskManager.pendingTasks.shift()) { /* drop */ }
  const queued = [];
  return {
    queued,
    hitpoints: 100,
    isRegistered: () => true,
    getHitpoints() { return this.hitpoints; },
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => queued.push(...hits) }) }),
  };
}

function burn(index, randoms, victim) {
  const method = special("burning_claws").getCombatMethod();
  const hit = { getFirstSuccessfulRangeIndex: () => index, getHits: () => [0, 0, 0], getTarget: () => victim };
  const realRandom = Math.random;
  let call = 0;
  Math.random = () => randoms[call++ % randoms.length];
  try {
    method.handleAfterHitEffects(hit);
  } finally {
    Math.random = realRandom;
  }
}

function runTicks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test("each burning claws hitsplat burns with the chance of the roll that landed, and a burn is 10 damage over 40 ticks", () => {
  const cases = [
    [0, 0.149, 0.15], // 15% on the first roll
    [1, 0.299, 0.3], // 30% on the second
    [2, 0.449, 0.45], // 45% on the third
  ];
  for (const [index, below, atChance] of cases) {
    const victim = burnVictim();
    burn(index, [below, atChance, atChance], victim);
    runTicks(45);
    assert.equal(victim.queued.length, 10, `roll ${index + 1}: one burn is ten 1-damage ticks`);
    assert.ok(victim.queued.every((hitsplat) => hitsplat.getDamage() === 1));
  }
});

test("a burn ticks every 4 ticks and a full miss never burns", () => {
  const victim = burnVictim();
  burn(0, [0], victim);
  runTicks(3);
  assert.equal(victim.queued.length, 0, "nothing in the first 3 ticks");
  runTicks(1);
  assert.equal(victim.queued.length, 3, "the three burns each deal 1 on tick 4");
  runTicks(45);
  assert.equal(victim.queued.length, 30);

  const missed = burnVictim();
  burn(-1, [0], missed);
  burn(undefined, [0], missed);
  runTicks(45);
  assert.equal(missed.queued.length, 0);
});

test("burns stack up to five at once and a finished burn frees its slot", () => {
  const victim = burnVictim();
  burn(2, [0], victim); // three burns
  burn(2, [0], victim); // three more: only two fit
  runTicks(4);
  assert.equal(victim.queued.length, 5, "five burns tick, not six");
  runTicks(45);
  assert.equal(victim.queued.length, 50);
  burn(2, [0], victim);
  runTicks(4);
  assert.equal(victim.queued.length, 53, "all three new burns start once the old ones ended");
  runTicks(45);
});

test("burns end with the target's life: a death before the next burn tick, a logout, an npc death", () => {
  // PlayerDeathTask restores hitpoints on its third run, before the burn's 4-tick check sees 0.
  const player = burnVictim();
  burn(2, [0], player);
  runTicks(4);
  assert.equal(player.queued.length, 3);
  player.hitpoints = 0; // killed on tick 5
  runTicks(2);
  // Respawned on tick 7: the restore emits onPlayerDefeated. onPlayerDeath is never reached here,
  // as when a safe-death respawn (Ferox free-for-all) handles it first.
  player.hitpoints = 99;
  hooks.onPlayerDefeated.forEach((handler) => handler({ killer: null, victim: player }));
  runTicks(45);
  assert.equal(player.queued.length, 3, "no burn damage after respawn");
  burn(2, [0], player);
  runTicks(4);
  assert.equal(player.queued.length, 6, "a new life burns afresh with all five slots free");
  runTicks(45);

  const leaver = burnVictim();
  burn(2, [0], leaver);
  hooks.onPlayerLogout.forEach((handler) => handler({ player: leaver, username: "leaver" }));
  runTicks(45);
  assert.equal(leaver.queued.length, 0, "a logout ends the burns");

  const npc = burnVictim();
  burn(2, [0], npc);
  hooks.onNpcDeath.forEach((handler) => handler({ npc, killer: null }));
  runTicks(45);
  assert.equal(npc.queued.length, 0, "an npc death ends the burns");

  const dying = burnVictim();
  dying.isDyingFunction = () => true; // killed with no killer: no onNpcDeath
  burn(2, [0], dying);
  runTicks(45);
  assert.equal(dying.queued.length, 0, "a dying target takes no burns");
});

// --- Saradomin's lightning -----------------------------------------------------------------

function lightningHit({ accurate, splashed = false }) {
  const queued = [];
  const oldBounds = PluginManager.getCoreApi().DamageFormulas.sourceHitBounds;
  PluginManager.getCoreApi().DamageFormulas.sourceHitBounds = () => ({ minimum: 0, maximum: 0 });
  const realQueue = CombatFactory.addPendingHit;
  CombatFactory.addPendingHit = (hit) => queued.push(hit);
  const target = {
    graphics: 0,
    isPlayer: () => splashed,
    isNpc: () => !splashed,
    getAsPlayer() { return this; },
    performGraphic() { this.graphics++; },
    getHitpoints: () => 50,
    getPrayerActive: () => [],
    getEquipment: () => ({ getItems: () => Array.from({ length: 14 }, () => ({ getId: () => -1 })) }),
  };
  const attacker = { isPlayer: () => false, isNpc: () => true };
  const hit = { getTarget: () => target, isAccurate: () => accurate, getAttacker: () => attacker };
  try {
    special("saradomin_sword").getCombatMethod().handleAfterHitEffects(hit);
  } finally {
    CombatFactory.addPendingHit = realQueue;
    PluginManager.getCoreApi().DamageFormulas.sourceHitBounds = oldBounds;
  }
  for (const hit of queued) {
    assert.equal(hit.getCombatType(), CombatType.MAGIC);
    assert.equal(hit.getDelay(), 1);
    assert.equal(hit.rewardsExperience(), false, "lightning pays its own Magic XP after immunity hooks");
  }
  return { target, queued: queued.flatMap((hit) => hit.getHits()), submitted: queued };
}

test("Saradomin's lightning only follows a landed melee hit and rolls 1-16", () => {
  const missed = lightningHit({ accurate: false });
  assert.equal(missed.submitted.length, 0);
  assert.equal(missed.target.graphics, 0);

  const realRandom = Math.random;
  try {
    for (const [roll, expected] of [[0, 1], [0.999999, 16]]) {
      Math.random = () => roll;
      const landed = lightningHit({ accurate: true });
      assert.equal(landed.target.graphics, 1);
      assert.equal(landed.queued.length, 1);
      assert.equal(landed.queued[0].getDamage(), expected);
    }
  } finally {
    Math.random = realRandom;
  }
});

test("Saradomin's lightning splashes against Protect from Magic", () => {
  const prayers = PluginManager.getCoreApi().PrayerHandler;
  const real = prayers.isActivated;
  prayers.isActivated = (_player, prayer) => prayer === prayers.PROTECT_FROM_MAGIC;
  try {
    const { queued } = lightningHit({ accurate: true, splashed: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].getDamage(), 0);
  } finally {
    prayers.isActivated = real;
  }
});

// --- Sweep -----------------------------------------------------------------------------------

test("Sweep hits a large target twice instead of sweeping, and the second hit rolls at 75% accuracy", () => {
  const sweep = special("dragon_halberd").getTraits().targeting;
  const attacker = { isPlayer: () => true, isNpc: () => false };
  const large = { isNpc: () => true, getAsNpc: () => ({ getSize: () => 3 }) };
  const small = { isNpc: () => true, getAsNpc: () => ({ getSize: () => 1 }), getLocation: () => ({}) };

  const onLarge = SpecialAttackTargetingResolver.resolve(attacker, large, sweep);
  assert.equal(onLarge.largeTargetExtraHit, true);
  assert.deepEqual(onLarge.secondaryTargets, []);
  // A 1x1 target is not double hit (it takes the multi-combat sweep path, empty outside multi).
  assert.equal(SpecialAttackTargetingResolver.resolve(attacker, small, { ...sweep, requiresMultiCombat: false, maxTargets: 1 }).largeTargetExtraHit, false);

  const rolls = [];
  const realAttack = AccuracyFormulasDpsCalc.attackMeleeRoll;
  const realDefence = AccuracyFormulasDpsCalc.defenseMeleeRoll;
  AccuracyFormulasDpsCalc.attackMeleeRoll = () => 1000;
  AccuracyFormulasDpsCalc.defenseMeleeRoll = () => 500;
  const entity = { isPlayer: () => false, isNpc: () => true, getAsNpc: () => ({ getRollFactor: () => 1 }) };
  try {
    rolls.push(AccuracyFormulasDpsCalc.specialRolls(entity, entity, CombatType.MELEE).attack);
    rolls.push(AccuracyFormulasDpsCalc.withAccuracyScale(sweep.largeTargetExtraHit.accuracyMultiplier,
      () => AccuracyFormulasDpsCalc.specialRolls(entity, entity, CombatType.MELEE).attack));
    rolls.push(AccuracyFormulasDpsCalc.specialRolls(entity, entity, CombatType.MELEE).attack);
  } finally {
    AccuracyFormulasDpsCalc.attackMeleeRoll = realAttack;
    AccuracyFormulasDpsCalc.defenseMeleeRoll = realDefence;
  }
  assert.deepEqual(rolls, [1000, 750, 1000], "scoped to the extra hit only");
});

// --- Hastas: no ammunition, no charges, nothing breakable ---------------------------------

test("every hasta is a melee SPEAR weapon with no ammunition or charges", () => {
  const hastas = items.filter((item) => /hasta/i.test(item.name) && !item.noted && item.equipmentType === "WEAPON");
  assert.ok(hastas.length >= 30, "bronze through dragon hastas plus poisoned and zamorakian variants");
  for (const hasta of hastas) {
    assert.equal(hasta.weaponInterface, "SPEAR", `${hasta.id} ${hasta.name}`);
    assert.equal(RangedWeapon.getSelfAmmo(hasta.id) ?? null, null, `${hasta.id} fires nothing`);
    assert.equal(hasta.charges, undefined);
  }
});

test("dragon claws play the four Slice and Dice sounds with the captured delays", () => {
  const attacker = fakeFighter();
  attacker.isPlayerBot = () => false;
  const target = fakeTarget();
  const original = World.getPlayers;
  World.getPlayers = () => [attacker];
  try {
    special("dragon_claws").getCombatMethod().start(attacker, target);
  } finally {
    World.getPlayers = original;
  }
  assert.deepEqual(
    attacker.log.area.map(([soundId, , , , , delay]) => [soundId, delay]),
    [[4138, 10], [4140, 30], [4141, 42], [4141, 60]],
    "rsprox recording 4014",
  );
});

test("broken dragon hastas are crafting items that cannot be equipped", async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
  const WEAPON_SLOT = 3;
  for (const id of [ItemIdentifiers.BROKEN_DRAGON_HASTA, ItemIdentifiers.BROKEN_DRAGON_HASTA_3]) {
    const row = items.find((item) => item.id === id);
    assert.ok(!row?.equipmentType || row.equipmentType === "NONE", `${id} has no equipment slot in item-gameplay.json`);
    assert.notEqual(CacheDefinitions.getItem(id).wearPos, WEAPON_SLOT, `${id} is not wieldable in the cache`);
    assert.equal(CombatSpecial.getForWeaponId(id), null, `${id} has no special`);
  }
});
