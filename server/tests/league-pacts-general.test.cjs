// Run after `yarn build`: node --test tests/league-pacts-general.test.cjs
// Demonic Pacts' general pact effects (General.LeaguePacts.js): Regenerate and its event, accuracy,
// Defence, the off-hand bonuses, pact heals and overhealing, free specials, prayer penetration,
// the max accuracy roll, the prayer restore, special energy from range and the style swap, each for
// a Demonic Pacts character with the pact and for nobody else.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { GameConstants } = require("../dist/game/GameConstants");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");

let core;
let Common;
const hooks = {};
const custom = {};
const modifiers = {};
const regenerated = [];
let worldLeague = 6;
const realRandom = Math.random;
let realRandomInclusive;
let realIsActivated;
/** Registering General.LeaguePacts.js: the other pact units register modifiers of their own. */
let attachingGeneral = false;
const mine = (key, modifier) => { if (attachingGeneral) modifiers[key] = modifier; };

const AIR_RUNE = 556;
const FIRE_RUNE = 554;
const RUNE_ARROW = 892;
const DRAGON_DEFENDER = 12954;
const RUNE_KITESHIELD = 1201;
const HILL_GIANT = 2098;

/** Node indices of the cache's tree for each effect used here. */
const NODES = {
  regenerate50: 0, regenerate30: 9, accuracy25: 6, accuracy50: 10, meleeDamage: 110, defence5: 5, defence15: 50,
  offhand: 11, overheal30: 48, freeSpec20: 70, penetration25: 55, penetration25b: 74, maxAccuracy: 8,
  prayerRestore: 85, distanceSpec: 73, styleSwap: 54,
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (answer !== undefined && answer !== false) result = answer;
        else if (result === undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMeleeAttackAccuracyModifier: (modifier) => mine("meleeAccuracy", modifier),
    registerRangedAttackAccuracyModifier: (modifier) => mine("rangedAccuracy", modifier),
    registerMagicAttackAccuracyModifier: (modifier) => mine("magicAccuracy", modifier),
    registerMeleeDefenseModifier: (modifier) => mine("meleeDefence", modifier),
    registerMagicDefenseModifier: (modifier) => mine("magicDefence", modifier),
    // The plugin's own attach registers it with the core; the second attach only captures it.
    registerRestingLevelModifier: (modifier) => (attachingGeneral ? mine("resting", modifier) : SkillManager.registerRestingLevelModifier(modifier)),
    registerBonusProvider: (provider) => mine("bonuses", provider),
    registerRangedAmmoHandler: () => {},
    registerRangedCombatModifier: () => {},
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) on(`button:${id}`)(handler); },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  // The modifiers this unit registers, captured from a second attach of it alone (its event
  // handlers are attached once, by the plugin above).
  attachingGeneral = true;
  require("../plugins/modes/leaguepacts/General.LeaguePacts")(new Proxy({ core }, {
    get: (target, key) => (key in target ? target[key] : String(key).startsWith("register") || key === "emitCustomEvent" ? api[key] : () => {}),
  }));
  attachingGeneral = false;
  custom["league:pact-regenerated"] = (custom["league:pact-regenerated"] ?? []).concat((event) => regenerated.push(event));
  realRandomInclusive = core.Misc.randomInclusive;
  realIsActivated = core.PrayerHandler.isActivated;
});

afterEach(() => {
  Math.random = realRandom;
  core.Misc.randomInclusive = realRandomInclusive;
  core.PrayerHandler.isActivated = realIsActivated;
  core.World.processCycle = 0;
  regenerated.length = 0;
});

/** Math.random answers from a queue, then `rest`. */
function randoms(values, rest = 0.5) {
  const queue = [...values];
  Math.random = () => (queue.length ? queue.shift() : rest);
}

function character(name, { league = 6, profile = "league", pacts = [] } = {}) {
  worldLeague = league;
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setRegistered(true);
  player.setLocation(new Location(3200, 3200, 0));
  const sender = new Proxy({}, { get: (target, key) => (key === "isSubInterfaceOpen" ? () => true : () => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getDialogueManager = () => ({ startDialogues() {} });
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  // A new Demonic Pacts character starts with the starter kit; these tests bring their own items.
  player.getInventory().resetItems();
  worldLeague = 6;
  if (pacts.length) Common.save(player, pacts);
  return player;
}

/** A Demonic Pacts character with `pacts`, a Raging Echoes one and a main, all holding the same pacts attribute. */
function cast(name, pacts) {
  return {
    pacts: character(`${name}-pacts`, { pacts }),
    others: [character(`${name}-echoes`, { league: 5, pacts }), character(`${name}-main`, { profile: "main", pacts })],
  };
}

const emit = (name, payload) => {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
};
const npcAt = (x, y, id = HILL_GIANT) => new NPC(id, new Location(x, y, 0));
const rollEvent = (attacker, target, combatType) => ({ attacker, target, combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false });
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };

/** A cast as Spell.canCast runs it: the cost, the saving question, then the commit. */
function castSpell(player, items, offensive = true) {
  const spell = { spellId: () => 1 };
  emit("magic:spell-cost", { player, spell, items });
  const saving = emit("magic:rune-saving", { player, offensive, saved: false, message: null });
  emit("magic:cast-committed", { player, spell, context: null, runesSaved: saving.saved });
  return saving.saved;
}

test("Regenerate: a value% chance to keep a cast's runes, a shot's ammunition or a charge, and the event for each", () => {
  const { pacts, others } = cast("regen", [NODES.regenerate50, NODES.regenerate30]);
  assert.equal(Common.effect(pacts, "talent_regen_ammo_chance"), 80);
  const runes = [new core.Item(AIR_RUNE, 3), new core.Item(FIRE_RUNE, 1), new core.Item(AIR_RUNE, 2)];
  randoms([0.79]);
  assert.equal(castSpell(pacts, runes), true, "79 < 80: the runes stay");
  assert.deepEqual(regenerated.map(({ player, kind, itemId, amount, combat }) => [player === pacts, kind, itemId, amount, combat]),
    [[true, "rune", AIR_RUNE, 5], [true, "rune", FIRE_RUNE, 1]].map((row) => [...row, true]));
  regenerated.length = 0;
  randoms([0.8]);
  assert.equal(castSpell(pacts, runes), false, "80 is not under 80");
  randoms([0.1]);
  assert.equal(castSpell(pacts, [], false), false, "a cast that spends no rune has nothing to Regenerate");
  randoms([0.1]);
  assert.equal(castSpell(pacts, runes, false), true);
  assert.equal(regenerated.at(-1).combat, false, "a teleport's runes are not a combat spell's");
  regenerated.length = 0;

  randoms([0.1, 0.9, 0.2]);
  const shots = emit("ranged:ammo-saving", { player: pacts, itemId: RUNE_ARROW, amount: 3, saved: 0 });
  assert.equal(shots.saved, 2);
  assert.deepEqual(regenerated.map(({ kind, itemId, amount }) => [kind, itemId, amount]), [["ammo", RUNE_ARROW, 2]]);
  regenerated.length = 0;
  randoms([0.1]);
  const charge = emit("combat:consume-charge", { player: pacts, itemId: 12899, skip: false });
  assert.equal(charge.skip, true);
  assert.deepEqual(regenerated.map(({ kind, itemId, weaponId, amount }) => [kind, itemId, weaponId, amount]), [["charge", -1, 12899, 1]]);
  regenerated.length = 0;

  for (const other of others) {
    randoms([], 0);
    assert.equal(castSpell(other, runes), false);
    assert.equal(emit("ranged:ammo-saving", { player: other, itemId: RUNE_ARROW, amount: 3, saved: 0 }).saved, 0);
    assert.equal(emit("combat:consume-charge", { player: other, itemId: 12899, skip: false }).skip, false);
  }
  assert.equal(regenerated.length, 0);
});

test("accuracy: +value% to all three attack rolls", () => {
  const { pacts, others } = cast("accuracy", [NODES.accuracy25, NODES.accuracy50]);
  for (const modifier of [modifiers.meleeAccuracy, modifiers.rangedAccuracy, modifiers.magicAccuracy]) {
    assert.equal(modifier(pacts, 10000), 17500, "25 + 50");
    for (const other of others) assert.equal(modifier(other, 10000), 10000);
  }
  assert.equal(modifiers.meleeAccuracy(npcAt(3200, 3201), 10000), 10000);
});

test("accuracy adds up: each small damage node's +10% beside the accuracy pact, never multiplied", () => {
  const Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  const nodesOf = (varbit, count) => Common.nodes.filter((node) => node.varbit === varbit).slice(0, count).map((node) => node.index);
  const melee = nodesOf("talent_percentage_melee_damage", 3);
  const ranged = nodesOf("talent_percentage_ranged_damage", 3);
  assert.deepEqual([melee.length, ranged.length], [3, 3]);
  const { pacts } = cast("accuracy-sum", [...melee, ...ranged, NODES.accuracy25]);
  for (const modifier of [modifiers.meleeAccuracy, modifiers.rangedAccuracy, modifiers.magicAccuracy]) {
    assert.equal(modifier(pacts, 10000), 18500, "60% from six damage nodes + 25%, one sum");
  }
});

test("Defence: a visible, permanent boost of value levels; decay and restoration rest at it; a reset takes it back", () => {
  const { pacts, others } = cast("defence", [NODES.defence5, NODES.defence15]);
  const level = (player) => player.getSkillManager().getCurrentLevel(Skill.DEFENCE);
  for (const player of [pacts, ...others]) emit("league:pact-unlocked", { player, node: NODES.defence15, effect: "talent_defence_boost" });
  assert.equal(level(pacts), 119, "99 + 5 + 15, shown in the skills tab (237/01170: 114 with 15)");
  assert.equal(pacts.getSkillManager().getRestingLevel(Skill.DEFENCE), 119);
  assert.equal(modifiers.meleeDefence, undefined, "no roll-time Defence: the rolls read the boosted level");
  assert.equal(modifiers.magicDefence, undefined);
  for (const other of others) {
    assert.equal(level(other), 99, "nobody else");
    assert.equal(other.getSkillManager().getRestingLevel(Skill.DEFENCE), 99);
  }
  // A drained level climbs back to the boost, not to the base, a point a restore.
  pacts.getSkillManager().setCurrentLevel(Skill.DEFENCE, 117, false);
  let cycle = 0;
  const restore = (player) => { cycle += 1000; player.processStatRestoration(cycle); };
  restore(pacts);
  restore(pacts);
  assert.equal(level(pacts), 118);
  restore(pacts);
  restore(pacts);
  assert.equal(level(pacts), 119, "and no further");
  // Buying again (a login after one) adds only what changed.
  emit("league:pact-unlocked", { player: pacts, node: NODES.defence5, effect: "talent_defence_boost" });
  assert.equal(level(pacts), 119);
  // A reset takes the boost back; a level drained below the base stays where it is.
  Common.save(pacts, []);
  emit("league:pacts-reset", { player: pacts });
  assert.equal(level(pacts), 99, "237/01158: 99 after the reset");
  Common.save(pacts, [NODES.defence15]);
  emit("league:pact-unlocked", { player: pacts, node: NODES.defence15, effect: "talent_defence_boost" });
  pacts.getSkillManager().setCurrentLevel(Skill.DEFENCE, 60, false);
  Common.save(pacts, []);
  emit("league:pacts-reset", { player: pacts });
  assert.equal(level(pacts), 60);
});

test("Defence: boost decay stops at the resting level", () => {
  const potions = require("../plugins/items/Potions.plugin");
  potions.register(new Proxy({ core, persistAttribute() {}, emitCustomEvent: () => {} }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const { pacts, others } = cast("defencedecay", [NODES.defence15]);
  for (const player of [pacts, ...others]) {
    emit("league:pact-unlocked", { player, node: NODES.defence15, effect: "talent_defence_boost" });
    player.getSkillManager().setCurrentLevel(Skill.DEFENCE, 118, false);
  }
  const decay = (player, times) => {
    for (let i = 0; i < times; i++) {
      player.setAttribute("potions:boost-cycle", 1);
      potions._test.processBoostDecay(player);
    }
  };
  decay(pacts, 10);
  assert.equal(pacts.getSkillManager().getCurrentLevel(Skill.DEFENCE), 114, "a super defence's 118 decays to 99 + 15, not 99");
  for (const other of others) {
    decay(other, 25);
    assert.equal(other.getSkillManager().getCurrentLevel(Skill.DEFENCE), 99);
  }
});

test("off-hand: a shield-slot item that is not a shield gives +5 melee and ranged strength and +2% magic damage", () => {
  const { pacts, others } = cast("offhand", [NODES.offhand]);
  const bonuses = (player) => {
    const event = { player, bonuses: new Array(14).fill(0) };
    modifiers.bonuses.apply(event);
    return event.bonuses.slice(10);
  };
  assert.deepEqual(bonuses(pacts), [0, 0, 0, 0], "nothing in the shield slot");
  pacts.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(RUNE_KITESHIELD, 1));
  assert.deepEqual(bonuses(pacts), [0, 0, 0, 0], "a shield is no off-hand (the block-heal pact names them apart)");
  for (const player of [pacts, ...others]) player.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(DRAGON_DEFENDER, 1));
  assert.deepEqual(bonuses(pacts), [5, 5, 2, 0]);
  for (const other of others) assert.deepEqual(bonuses(other), [0, 0, 0, 0]);
});

test("pact heals: league:pact-heal heals and overheals up to +value% of base Hitpoints with the pact", () => {
  const { pacts, others } = cast("overheal", [NODES.overheal30]);
  const heal = (player, amount) => emit("league:pact-heal", { player, amount }).healed;
  assert.equal(heal(pacts, 20), 20);
  assert.equal(pacts.getHitpoints(), 119);
  assert.equal(heal(pacts, 50), 9, "capped at 99 + 29");
  assert.equal(pacts.getHitpoints(), 128);
  const plain = character("overheal-none", { pacts: [NODES.regenerate50] });
  plain.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 90, false);
  assert.equal(heal(plain, 50), 9, "without the pact a heal stops at base");
  assert.equal(heal(plain, 5), 0);
  for (const other of others) {
    other.getSkillManager().setCurrentLevels(Skill.HITPOINTS, 95, false);
    assert.equal(heal(other, 50), 4, "anyone else: an ordinary heal");
  }
});

test("free specials: value% of drains cost nothing; the check still prices them", () => {
  const { pacts, others } = cast("freespec", [NODES.freeSpec20]);
  const cost = (player, phase) => emit("combat-special:cost", { player, specialId: null, cost: 50, available: 100, allow: false, phase }).cost;
  randoms([0.19]);
  assert.equal(cost(pacts, "drain"), 0);
  randoms([0.2]);
  assert.equal(cost(pacts, "drain"), 50);
  randoms([0]);
  assert.equal(cost(pacts, "check"), 50);
  for (const other of others) {
    randoms([0]);
    assert.equal(cost(other, "drain"), 50);
  }
});

test("prayer penetration: value% of what a protection prayer blocks gets through, not against players", () => {
  const { pacts, others } = cast("penetration", [NODES.penetration25, NODES.penetration25b]);
  const target = npcAt(3200, 3201);
  core.PrayerHandler.isActivated = (entity, prayer) => entity === target && prayer === core.PrayerHandler.PROTECT_FROM_MELEE;
  const event = rollEvent(pacts, target, core.CombatType.MELEE);
  hooks.onCombatHitRoll(event);
  assert.equal(event.bypassProtectionPrayer, true);
  const damage = new core.HitDamage(100, core.HitMask.RED);
  hooks.onCombatHitDamage({ attacker: pacts, target, combatType: core.CombatType.MELEE, damage, accurate: true });
  assert.equal(damage.getDamage(), 80, "50% of the blocked 40% gets through: 60 + 20");

  core.PrayerHandler.isActivated = () => false;
  randoms([0.49]);
  const pluginPrayer = rollEvent(pacts, target, core.CombatType.MELEE);
  hooks.onCombatHitRoll(pluginPrayer);
  assert.equal(pluginPrayer.bypassProtectionPrayer, true, "a plugin's prayer: bypassed on half the rolls");
  randoms([0.5]);
  const blocked = rollEvent(pacts, target, core.CombatType.MELEE);
  hooks.onCombatHitRoll(blocked);
  assert.equal(blocked.bypassProtectionPrayer, false);

  core.PrayerHandler.isActivated = () => true;
  const victim = character("penetration-victim");
  const pvp = rollEvent(pacts, victim, core.CombatType.MELEE);
  hooks.onCombatHitRoll(pvp);
  assert.equal(pvp.bypassProtectionPrayer, false, "not against a player");
  for (const other of others) {
    const event2 = rollEvent(other, target, core.CombatType.MELEE);
    hooks.onCombatHitRoll(event2);
    assert.equal(event2.bypassProtectionPrayer, false);
  }
});

test("max accuracy roll: 5% + 5% a tile; the max attack roll against a random defence roll, once per attack", () => {
  const { pacts, others } = cast("maxaccuracy", [NODES.maxAccuracy]);
  const target = npcAt(3203, 3200);
  core.Misc.randomInclusive = () => 0;
  core.World.processCycle = 10;
  randoms([0.199]);
  const first = rollEvent(pacts, target, core.CombatType.RANGED);
  hooks.onCombatHitRoll(first);
  assert.equal(first.forceAccurate, true, "3 tiles: 20%");
  const second = rollEvent(pacts, target, core.CombatType.RANGED);
  randoms([0.99]);
  hooks.onCombatHitRoll(second);
  assert.equal(second.forceAccurate, true, "the same attack's next hitsplat keeps the roll");
  core.World.processCycle = 11;
  randoms([0.2]);
  const missed = rollEvent(pacts, target, core.CombatType.RANGED);
  hooks.onCombatHitRoll(missed);
  assert.equal(missed.forceAccurate, false, "20 is not under 20");
  core.World.processCycle = 12;
  const realRolls = core.AccuracyFormulasDpsCalc.specialRolls;
  core.AccuracyFormulasDpsCalc.specialRolls = () => ({ attack: 100, defence: 200 });
  core.Misc.randomInclusive = (low, high) => high;
  randoms([0]);
  const beaten = rollEvent(pacts, npcAt(3201, 3200), core.CombatType.MELEE);
  hooks.onCombatHitRoll(beaten);
  assert.equal(beaten.forceAccurate, false, "a defence roll of 200 beats the max attack roll of 100");
  core.Misc.randomInclusive = (low, high) => 99;
  randoms([0]);
  core.World.processCycle = 14;
  const landed = rollEvent(pacts, npcAt(3201, 3200), core.CombatType.MELEE);
  hooks.onCombatHitRoll(landed);
  assert.equal(landed.forceAccurate, true, "a defence roll of 99 does not; adjacent is 10%");
  core.AccuracyFormulasDpsCalc.specialRolls = realRolls;
  core.Misc.randomInclusive = () => 0;
  core.World.processCycle = 15;
  core.World.processCycle = 13;
  randoms([0]);
  const pvp = rollEvent(pacts, character("maxaccuracy-victim"), core.CombatType.MELEE);
  hooks.onCombatHitRoll(pvp);
  assert.equal(pvp.forceAccurate, false, "not against a player");
  for (const other of others) {
    core.World.processCycle += 1;
    randoms([0]);
    const event = rollEvent(other, target, core.CombatType.RANGED);
    hooks.onCombatHitRoll(event);
    assert.equal(event.forceAccurate, false);
  }
});

test("prayer restore: a point every 15 ticks without a protection prayer, a tick sooner per 7 prayer bonus", () => {
  const { pacts, others } = cast("prayer", [NODES.prayerRestore]);
  const prayer = (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER);
  for (const player of [pacts, ...others]) {
    player.getSkillManager().setCurrentLevels(Skill.PRAYER, 50, false);
    emit("league:pact-unlocked", { player, node: NODES.prayerRestore, effect: "talent_prayer_restore_no_overhead" });
  }
  ticks(14);
  assert.equal(prayer(pacts), 50);
  ticks(1);
  assert.equal(prayer(pacts), 51, "15 ticks");
  pacts.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] = 14;
  ticks(15);
  assert.equal(prayer(pacts), 52, "the next one is due at the old pace");
  ticks(13);
  assert.equal(prayer(pacts), 53, "then 13 ticks with +14 prayer");
  core.PrayerHandler.isActivated = (entity, id) => entity === pacts && id === core.PrayerHandler.PROTECT_FROM_MAGIC;
  ticks(13);
  assert.equal(prayer(pacts), 53, "nothing while protecting");
  core.PrayerHandler.isActivated = realIsActivated;
  for (const other of others) assert.equal(prayer(other), 50);
  Common.save(pacts, []);
  ticks(30);
  assert.equal(prayer(pacts), 53, "the task ends with the pact");
});

test("special energy from range: an attack from 2+ tiles restores 2%, once per attack", () => {
  const { pacts, others } = cast("distancespec", [NODES.distanceSpec]);
  for (const player of [pacts, ...others]) player.setSpecialPercentage(50);
  core.World.processCycle = 20;
  hooks.onCombatHitRoll(rollEvent(pacts, npcAt(3202, 3200), core.CombatType.RANGED));
  hooks.onCombatHitRoll(rollEvent(pacts, npcAt(3202, 3200), core.CombatType.RANGED));
  assert.equal(pacts.getSpecialPercentage(), 52);
  core.World.processCycle = 21;
  hooks.onCombatHitRoll(rollEvent(pacts, npcAt(3201, 3200), core.CombatType.MELEE));
  assert.equal(pacts.getSpecialPercentage(), 52, "adjacent is 1 tile");
  core.World.processCycle = 22;
  pacts.setSpecialPercentage(99);
  hooks.onCombatHitRoll(rollEvent(pacts, npcAt(3205, 3200), core.CombatType.MAGIC));
  assert.equal(pacts.getSpecialPercentage(), 100);
  for (const other of others) {
    hooks.onCombatHitRoll(rollEvent(other, npcAt(3205, 3200), core.CombatType.MAGIC));
    assert.equal(other.getSpecialPercentage(), 50);
  }
});

test("style swap: a max hit from 3+ tiles makes the next hit in another style deal +25%", () => {
  const { pacts, others } = cast("styleswap", [NODES.styleSwap]);
  const far = npcAt(3203, 3200);
  const near = npcAt(3201, 3200);
  const rolled = (attacker, target, combatType, damage, maximum) =>
    emit("combat:hit-rolled", { attacker, target, combatType, damage, minimum: 0, maximum }).damage;
  const { MELEE, RANGED, MAGIC } = core.CombatType;
  assert.equal(rolled(pacts, near, RANGED, 30, 30), 30, "a max hit from 1 tile");
  assert.equal(rolled(pacts, near, MELEE, 20, 40), 20, "nothing pending");
  assert.equal(rolled(pacts, far, RANGED, 30, 30), 30, "a max hit from 3 tiles");
  assert.equal(rolled(pacts, near, RANGED, 20, 30), 20, "the same style keeps it waiting");
  assert.equal(rolled(pacts, near, MAGIC, 20, 30), 25);
  assert.equal(rolled(pacts, near, MELEE, 20, 30), 20, "used once");
  rolled(pacts, far, RANGED, 30, 30);
  assert.equal(rolled(pacts, character("styleswap-victim"), MELEE, 20, 30), 20, "not against a player");
  for (const other of others) {
    rolled(other, far, RANGED, 30, 30);
    assert.equal(rolled(other, near, MELEE, 20, 30), 20);
  }
});
