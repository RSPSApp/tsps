// Run after `yarn build`: node --test tests/league-pacts-melee.test.cjs
// Demonic Pacts' melee pacts (plugins/modes/leaguepacts/Melee.LeaguePacts.js): each effect for a
// Demonic Pacts character holding the pact, and for nobody else.
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
let Melee;
const hooks = {};
const custom = {};
const modifiers = {};
const emitted = [];
let worldLeague = 6;
let forceAccurate = false;
const realRandom = Math.random;
let realRandomInclusive;

const ITEMS = {
  runeKiteshield: 1201, dragonDefender: 12954, whip: 4151, runeScimitar: 1333, godsword: 11802,
  halberd: 3204, bulwark: 21015, graniteMaul: 4153, elderMaul: 21003, ringOfRecoil: 2550,
};
const HILL_GIANT = 2098;

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
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) on(`button:${id}`)(handler); },
    registerMeleeHitModifier: (modifier) => (modifiers.meleeHit ??= []).push(modifier),
    registerMeleeStrengthBonusModifier: (modifier) => {
      (modifiers.meleeStrength ??= []).push(modifier);
      require("../dist/game/content/combat/EquipmentEffects").registerMeleeStrengthBonusModifier(modifier);
    },
    registerMeleeAttackAccuracyModifier: (modifier) => (modifiers.meleeAccuracy ??= []).push(modifier),
    registerRangedAttackAccuracyModifier: (modifier) => (modifiers.rangedAccuracy ??= []).push(modifier),
    registerMagicAttackAccuracyModifier: (modifier) => (modifiers.magicAccuracy ??= []).push(modifier),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  Melee = require("../plugins/modes/leaguepacts/Melee.LeaguePacts");
  // Real PendingHits roll through the core: its custom events and roll hooks reach the handlers above.
  const realEmitCustomEvent = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => {
    for (const handler of custom[name] ?? []) handler(payload);
    return realEmitCustomEvent.call(PluginManager, name, payload);
  };
  const realEmitCombatHitRoll = PluginManager.emitCombatHitRoll;
  PluginManager.emitCombatHitRoll = (event) => {
    hooks.onCombatHitRoll?.(event);
    if (forceAccurate) event.forceAccurate = true;
    return realEmitCombatHitRoll.call(PluginManager, event);
  };
  realRandomInclusive = core.Misc.randomInclusive;
});

afterEach(() => {
  Math.random = realRandom;
  core.Misc.randomInclusive = realRandomInclusive;
  forceAccurate = false;
  emitted.length = 0;
  worldLeague = 6;
});

/** Math.random answers from a queue, then `rest`. */
function randoms(values, rest = 0.99) {
  const queue = [...values];
  Math.random = () => (queue.length ? queue.shift() : rest);
}

/** A logged-in character of `profile` on the world's league, holding the nodes of the named effects (each `count` times). */
function character(name, { profile = "league", pacts = {} } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setRegistered(true);
  player.setLocation(new Location(3200, 3200, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  // A new Demonic Pacts character starts with the starter kit; these tests bring their own items.
  player.getInventory().resetItems();
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  player.setHitpoints(99);
  const owned = [];
  for (const [effect, count] of Object.entries(pacts)) {
    const indices = Common.nodes.filter((node) => node.varbit === effect).map((node) => node.index);
    assert.ok(indices.length >= count, `${effect}: ${indices.length} nodes`);
    owned.push(...indices.slice(0, count));
  }
  if (owned.length) Common.save(player, owned);
  return player;
}

/** The same pacts on a Demonic Pacts character, a Raging Echoes one and a main. */
function cast(name, pacts) {
  const holder = character(name, { pacts });
  worldLeague = 5;
  const echoes = character(`${name}-echoes`, { pacts });
  worldLeague = 6;
  const main = character(`${name}-main`, { profile: "main", pacts });
  return { holder, others: [echoes, main] };
}

function equip(player, slot, id) {
  player.getEquipment().setItem(slot, new core.Item(id, 1));
  core.BonusManager.update(player);
  if (slot === core.Equipment.WEAPON_SLOT) player.setWeapon(id === ITEMS.halberd ? core.WeaponInterfaces.HALBERD : core.WeaponInterfaces.UNARMED);
}

const wield = (player, id) => equip(player, core.Equipment.WEAPON_SLOT, id);
const shield = (player, id) => equip(player, core.Equipment.SHIELD_SLOT, id);

/** A hill giant `tiles` north of the player's footprint (it is 2x2), whose queued hits are recorded. */
function giant(tiles = 1, hitpoints = 1000) {
  const npc = new NPC(HILL_GIANT, new Location(3200, 3200 + tiles, 0));
  npc.getHitpoints = () => hitpoints;
  const queue = npc.getCombat().getHitQueue();
  npc.queued = [];
  npc.damage = [];
  queue.addPendingHit = (hit) => npc.queued.push(hit);
  queue.addPendingDamage = (hits) => npc.damage.push(...hits.map((each) => each.getDamage()));
  return npc;
}

const effect = (name) => `talent_${name}`;
const modified = (list, entity, value) => list.reduce((each, modifier) => modifier(entity, each), value);
const hitRolled = (attacker, target, damage, maximum, minimum = 0) =>
  [custom["combat:hit-rolled"].reduce((event, handler) => (handler(event), event), { attacker, target, combatType: core.CombatType.MELEE, damage, minimum, maximum })]
    .map((event) => event.damage)[0];
const splat = (damage) => new core.HitDamage(damage, damage > 0 ? core.HitMask.RED : core.HitMask.BLUE);
const landed = (combatType, splats) => ({
  getCombatType: () => combatType, getHits: () => splats, getTotalDamage: () => splats.reduce((sum, each) => sum + each.getDamage(), 0),
  isAccurate: () => true, getDelay: () => 0,
});
const heals = () => emitted.filter(([name]) => name === "league:pact-heal").map(([, payload]) => payload.amount);
const cycle = (value) => (core.World.processCycle = value);

test("+1% melee max hit per melee damage pact", () => {
  const { holder, others } = cast("pact-damage", { [effect("percentage_melee_damage")]: 2 });
  assert.equal(modified(modifiers.meleeHit, holder, 100), 102);
  for (const other of others) assert.equal(modified(modifiers.meleeHit, other, 100), 100);
});

test("melee strength: +50% of the prayer bonus and +20% of Strength (light or one-handed) join the strength bonus at roll time", () => {
  const prayer = cast("pact-prayer", { [effect("melee_strength_prayer_bonus")]: 1 });
  const setBonuses = (player, strength, prayerBonus = 0) => {
    const other = player.getBonusManager().getOtherBonus();
    other[core.BonusManager.STRENGTH] = strength;
    other[core.BonusManager.PRAYER] = prayerBonus;
  };
  for (const player of [prayer.holder, ...prayer.others]) setBonuses(player, 36, 11);
  assert.equal(modified(modifiers.meleeStrength, prayer.holder, 36), 41, "+50% of 11 prayer bonus, rounded down: +5");
  for (const other of prayer.others) assert.equal(modified(modifiers.meleeStrength, other, 36), 36, "nobody else");
  assert.equal(modified(modifiers.meleeHit, prayer.holder, 100), 100, "no max-hit scaling any more: the bonus is in the formula");
  // The core's formula sees it: 99 Strength, no prayer, accurate style (+8): (107 * (41 + 64) + 320) / 640 = 18.
  for (const player of [prayer.holder, ...prayer.others]) player.getFightType = () => ({ getStyle: () => core.FightStyle.ACCURATE });
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(prayer.holder), 18);
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(prayer.others[0]), 17, "(107 * 100 + 320) / 640 without it");
  setBonuses(prayer.holder, 36, -4);
  assert.equal(modified(modifiers.meleeStrength, prayer.holder, 36), 36, "a negative prayer bonus adds nothing");

  const strength = cast("pact-strength", { [effect("multi_hit_str_increase")]: 1 });
  wield(strength.holder, ITEMS.runeScimitar);
  assert.equal(modified(modifiers.meleeStrength, strength.holder, 36), 55, "one-handed: 20% of 99 is 19");
  wield(strength.holder, ITEMS.godsword);
  assert.equal(modified(modifiers.meleeStrength, strength.holder, 36), 36, "a heavy two-hander");
  wield(strength.holder, ITEMS.whip);
  strength.holder.getSkillManager().setCurrentLevel(Skill.STRENGTH, 118, false);
  assert.equal(modified(modifiers.meleeStrength, strength.holder, 36), 59, "the boosted level: 23");
  for (const other of strength.others) {
    wield(other, ITEMS.whip);
    assert.equal(modified(modifiers.meleeStrength, other, 36), 36);
  }
});

test("melee min hit +3 and +3 per tile past the first; max hit +4% and +4% per 3 tiles", () => {
  const min = cast("pact-minhit", { [effect("distance_melee_minhit")]: 1 });
  core.Misc.randomInclusive = (low) => low;
  assert.equal(hitRolled(min.holder, giant(1), 5, 30), 3, "adjacent: 3");
  assert.equal(hitRolled(min.holder, giant(3), 5, 30), 9, "three tiles: 3 + 3 + 3");
  for (const other of min.others) assert.equal(hitRolled(other, giant(3), 5, 30), 5);
  // 237/01098: Strength 1, unarmed (max hit 1) with only this pact: a landed hit of 3, not 1.
  core.Misc.randomInclusive = (low, high) => (low > high ? Number.NaN : high);
  assert.equal(hitRolled(min.holder, giant(1), 1, 1), 3, "above the max hit of 1: the minimum, 3");
  assert.equal(hitRolled(min.holder, giant(1), 0, 1), 3, "any landed roll, a 0 too");
  for (const other of min.others) assert.equal(hitRolled(other, giant(1), 1, 1), 1, "nobody else: the max of 1");

  const max = cast("pact-maxhit", { [effect("percentage_melee_maxhit_distance")]: 1 });
  core.Misc.randomInclusive = (low, high) => high;
  assert.equal(hitRolled(max.holder, giant(1), 10, 50), 52, "adjacent: +4%");
  assert.equal(hitRolled(max.holder, giant(3), 10, 50), 54, "three tiles: +8%");
  assert.equal(hitRolled(max.holder, giant(6), 50, 50), 56, "a max roll stays the max: +12% at six tiles");
  for (const other of max.others) assert.equal(hitRolled(other, giant(3), 10, 50), 10);
});

test("a melee roll spends 5 overhealed hitpoints, if there are, for +5 min hit", () => {
  const { holder, others } = cast("pact-overheal", { [effect("overheal_consumption_boost")]: 1 });
  core.Misc.randomInclusive = (low) => low;
  holder.setHitpoints(103);
  assert.equal(hitRolled(holder, giant(1), 0, 30), 0, "4 over: nothing spent");
  assert.equal(holder.getHitpoints(), 103);
  holder.setHitpoints(110);
  assert.equal(hitRolled(holder, giant(1), 0, 30), 5);
  assert.equal(holder.getHitpoints(), 105);
  assert.equal(hitRolled(holder, giant(1), 0, 30), 5, "the same attack's next roll (a best-of roll, a re-roll) keeps it");
  assert.equal(holder.getHitpoints(), 105, "without paying again");
  for (const other of others) {
    other.setHitpoints(110);
    assert.equal(hitRolled(other, giant(1), 0, 30), 0);
    assert.equal(other.getHitpoints(), 110);
  }
});

test("melee range doubles with two-handers, then 4+ becomes 7; halberds at 5 ticks, light weapons a tick faster", () => {
  const { MELEE, RANGED } = core.CombatType;
  const reach = (attacker, distance, combatType = MELEE) => {
    const event = { attacker, target: giant(), combatType, manualCast: false, distance };
    hooks.onCombatAttackDistance(event);
    return event.distance;
  };
  const speed = (attacker, value, combatType = MELEE) => {
    const event = { attacker, target: giant(), combatType, speed: value };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  const both = cast("pact-range", { [effect("melee_range_multiplier")]: 1, [effect("melee_range_conditional_boost")]: 1 });
  wield(both.holder, ITEMS.halberd);
  assert.equal(reach(both.holder, 2), 7, "a halberd's 2, doubled to 4, becomes 7");
  assert.equal(reach(both.holder, 2, RANGED), 2);
  assert.equal(speed(both.holder, 7), 5);
  wield(both.holder, ITEMS.godsword);
  assert.equal(reach(both.holder, 1), 2);
  assert.equal(speed(both.holder, 6), 6, "not a halberd");
  wield(both.holder, ITEMS.runeScimitar);
  assert.equal(reach(both.holder, 1), 1);
  const boost = character("pact-range-boost", { pacts: { [effect("melee_range_conditional_boost")]: 1 } });
  wield(boost, ITEMS.halberd);
  assert.equal(reach(boost, 2), 2);
  assert.equal(reach(boost, 4), 7);

  const faster = cast("pact-faster", { [effect("light_weapon_faster")]: 1 });
  wield(faster.holder, ITEMS.whip);
  assert.equal(speed(faster.holder, 4), 3);
  wield(faster.holder, ITEMS.runeScimitar);
  assert.equal(speed(faster.holder, 4), 4, "1.8kg");
  for (const other of [...both.others, ...faster.others]) {
    wield(other, ITEMS.halberd);
    assert.equal(reach(other, 2), 2);
    assert.equal(speed(other, 7), 7);
    wield(other, ITEMS.whip);
    assert.equal(speed(other, 4), 4);
  }
});

test("a light weapon's melee attack adds a hit from 40% of the max hit; not on a special, once per attack", () => {
  const { holder, others } = cast("pact-double", { [effect("light_weapon_doublehit")]: 1 });
  const target = giant();
  wield(holder, ITEMS.whip);
  forceAccurate = true;
  core.Misc.randomInclusive = (low, high) => high;
  const max = core.DamageFormulas.sourceMaxHit(holder, core.CombatType.MELEE);
  const parent = landed(core.CombatType.MELEE, [splat(10)]);
  cycle(100);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: parent });
  assert.equal(target.queued.length, 1);
  assert.equal(target.queued[0].getTotalDamage(), Math.max(1, Math.floor(max * 0.4)));
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(10)]) });
  assert.equal(target.queued.length, 1, "a second hit of the same attack");
  cycle(101);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: target.queued[0] });
  assert.equal(target.queued.length, 1, "the extra hit adds none");
  holder.setSpecialActivated(true);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(10)]) });
  holder.setSpecialActivated(false);
  assert.equal(target.queued.length, 1, "a special");
  cycle(102);
  wield(holder, ITEMS.runeScimitar);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(10)]) });
  assert.equal(target.queued.length, 1, "a heavy weapon");
  for (const other of others) {
    wield(other, ITEMS.whip);
    hooks.onPlayerDealtDamage({ player: other, target, hit: landed(core.CombatType.MELEE, [splat(10)]) });
  }
  assert.equal(target.queued.length, 1);
});

test("Blindbag: a heavy weapon's attack may strike with a random heavy weapon carried; +2% chance and +2% max hit per unique one", () => {
  const pacts = {
    [effect("free_random_weapon_attack_chance")]: 1, [effect("unique_blindbag_chance")]: 1, [effect("unique_blindbag_damage")]: 1,
  };
  const { holder, others } = cast("pact-blindbag", pacts);
  const plain = character("pact-blindbag-plain", { pacts: { [effect("free_random_weapon_attack_chance")]: 1 } });
  for (const player of [holder, plain, ...others]) {
    wield(player, ITEMS.runeScimitar);
    player.getInventory().setItem(0, new core.Item(ITEMS.godsword, 1));
    player.getInventory().setItem(1, new core.Item(ITEMS.graniteMaul, 1));
    player.getInventory().setItem(2, new core.Item(ITEMS.graniteMaul, 1));
    player.getInventory().setItem(3, new core.Item(ITEMS.whip, 1));
  }
  assert.deepEqual(Melee._test.heavyWeaponsCarried(holder).sort(), [ITEMS.godsword, ITEMS.graniteMaul].sort(), "two unique heavy weapons; the whip is light");
  forceAccurate = true;
  core.Misc.randomInclusive = (low, high) => high;
  wield(holder, ITEMS.godsword);
  const godswordMax = core.DamageFormulas.sourceMaxHit(holder, core.CombatType.MELEE);
  wield(holder, ITEMS.runeScimitar);
  const bonuses = holder.getBonusManager().getAttackBonus().slice();
  const target = giant();
  cycle(200);
  randoms([0.18, 0], 0.99); // 18% < 15% + 2 x 2%; the first weapon carried
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(5)]) });
  assert.equal(target.queued.length, 1);
  assert.equal(Melee._test.derived.get(target.queued[0]), "blindbag");
  assert.equal(target.queued[0].getTotalDamage(), Math.floor(godswordMax * 104 / 100), "the godsword's max hit, +4% for two unique");
  assert.equal(holder.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getId(), ITEMS.runeScimitar, "the scimitar back in hand");
  assert.deepEqual(holder.getBonusManager().getAttackBonus(), bonuses);

  cycle(201);
  randoms([0.18], 0.99);
  hooks.onPlayerDealtDamage({ player: plain, target, hit: landed(core.CombatType.MELEE, [splat(5)]) });
  assert.equal(target.queued.length, 1, "15% alone misses 18%");
  cycle(202);
  randoms([0.1, 0], 0.99);
  holder.setSpecialActivated(true);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(5)]) });
  holder.setSpecialActivated(false);
  assert.equal(target.queued.length, 1, "not from a special");
  cycle(203);
  randoms([0.1, 0], 0.99);
  hooks.onPlayerDealtDamage({ player: holder, target: character("pact-blindbag-victim"), hit: landed(core.CombatType.MELEE, [splat(5)]) });
  assert.equal(target.queued.length, 1, "not against a player");
  cycle(204);
  randoms([0.1, 0], 0.99);
  wield(holder, ITEMS.whip);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: landed(core.CombatType.MELEE, [splat(5)]) });
  assert.equal(target.queued.length, 1, "a light weapon");
  wield(holder, ITEMS.runeScimitar);
  cycle(205);
  randoms([0.1, 0, 0.1, 0], 0.99);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: target.queued[0] });
  assert.equal(target.queued.length, 2, "a Blindbag attack may Blindbag again");
  for (const other of others) {
    cycle(206);
    randoms([0, 0], 0.99);
    hooks.onPlayerDealtDamage({ player: other, target, hit: landed(core.CombatType.MELEE, [splat(5)]) });
  }
  assert.equal(target.queued.length, 2);
});

test("a two-handed melee hit has a 5% chance of a Ranged echo; not on a special or a player", () => {
  const { holder, others } = cast("pact-echo", { [effect("2h_melee_echos")]: 1 });
  const target = giant();
  const echoes = () => emitted.filter(([name]) => name === "league:pact-ranged-echo");
  wield(holder, ITEMS.godsword);
  randoms([0.04]);
  hooks.onCombatHitResolved({ attacker: holder, target, hit: landed(core.CombatType.MELEE, [splat(4)]) });
  assert.equal(echoes().length, 1);
  assert.deepEqual({ ...echoes()[0][1] }, { player: holder, target, source: "melee" });
  randoms([0.06]);
  hooks.onCombatHitResolved({ attacker: holder, target, hit: landed(core.CombatType.MELEE, [splat(4)]) });
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: holder, target: character("pact-echo-victim"), hit: landed(core.CombatType.MELEE, [splat(4)]) });
  const special = landed(core.CombatType.MELEE, [splat(4)]);
  holder.setSpecialActivated(true);
  cycle(300);
  hooks.onPlayerDealtDamage({ player: holder, target, hit: special });
  holder.setSpecialActivated(false);
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: holder, target, hit: special });
  wield(holder, ITEMS.runeScimitar);
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: holder, target, hit: landed(core.CombatType.MELEE, [splat(4)]) });
  for (const other of others) {
    wield(other, ITEMS.godsword);
    randoms([0.01]);
    hooks.onCombatHitResolved({ attacker: other, target, hit: landed(core.CombatType.MELEE, [splat(4)]) });
  }
  assert.equal(echoes().length, 1);
});

test("each damaging melee hitsplat restores 2% special energy", () => {
  const { holder, others } = cast("pact-spec", { [effect("hit_restore_spec_energy")]: 1 });
  for (const player of [holder, ...others]) {
    player.setSpecialPercentage(50);
    hooks.onCombatHitResolved({ attacker: player, target: giant(), hit: landed(core.CombatType.MELEE, [splat(4), splat(0), splat(7)]) });
    hooks.onCombatHitResolved({ attacker: player, target: giant(), hit: landed(core.CombatType.RANGED, [splat(4)]) });
  }
  assert.equal(holder.getSpecialPercentage(), 54);
  for (const other of others) assert.equal(other.getSpecialPercentage(), 50);
});

test("a melee attack has a 10% chance to heal the tiles to the target", () => {
  const { holder, others } = cast("pact-distance-heal", { [effect("melee_distance_healing_chance")]: 1 });
  cycle(400);
  randoms([0.05]);
  hooks.onPlayerDealtDamage({ player: holder, target: giant(4), hit: landed(core.CombatType.MELEE, [splat(1)]) });
  cycle(401);
  randoms([0.2]);
  hooks.onPlayerDealtDamage({ player: holder, target: giant(4), hit: landed(core.CombatType.MELEE, [splat(1)]) });
  for (const other of others) {
    cycle(402);
    randoms([0]);
    hooks.onPlayerDealtDamage({ player: other, target: giant(4), hit: landed(core.CombatType.MELEE, [splat(1)]) });
  }
  assert.deepEqual(heals(), [4]);
});

test("Thorns: with a shield, an NPC's attack takes 3 per hitsplat, also on 0; twice at 50%; +1% of the defence bonuses; its heal chance", () => {
  const thorns = { [effect("thorns_damage")]: 1 };
  const { holder, others } = cast("pact-thorns", thorns);
  shield(holder, ITEMS.runeKiteshield);
  let attacker = giant();
  hooks.onCombatHitResolved({ attacker, target: holder, hit: landed(core.CombatType.MELEE, [splat(0), splat(5)]) });
  assert.deepEqual(attacker.damage, [3, 3]);
  hooks.onCombatHitResolved({ attacker: character("pact-thorns-pker"), target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  shield(holder, ITEMS.dragonDefender);
  hooks.onCombatHitResolved({ attacker, target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.deepEqual(attacker.damage, [3, 3], "not on a player's attack, nor with an off-hand");
  const bulwark = character("pact-thorns-bulwark", { pacts: thorns });
  wield(bulwark, ITEMS.bulwark);
  hooks.onCombatHitResolved({ attacker, target: bulwark, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.deepEqual(attacker.damage, [3, 3, 3], "the bulwark is a shield");

  const full = character("pact-thorns-full", { pacts: {
    ...thorns, [effect("thorns_double_hit")]: 1, [effect("defence_recoil_scaling")]: 1, [effect("melee_distance_healing_chance")]: 1,
  } });
  shield(full, ITEMS.runeKiteshield); // defence bonuses 44 + 48 + 46 - 1 + 46 = 183: +1
  attacker = giant(2);
  randoms([0.05]);
  hooks.onCombatHitResolved({ attacker, target: full, hit: landed(core.CombatType.MAGIC, [splat(2)]) });
  assert.deepEqual(attacker.damage, [4, 2]);
  assert.deepEqual(heals(), [2], "two tiles away");
  for (const other of others) {
    shield(other, ITEMS.runeKiteshield);
    hooks.onCombatHitResolved({ attacker, target: other, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  }
  assert.deepEqual(attacker.damage, [4, 2]);
});

test("a shield reflects an NPC's whole hit on 0.1% per Defence level", () => {
  const { holder, others } = cast("pact-reflect", { [effect("shield_reflect")]: 1 });
  const attacker = giant();
  const hitOn = (damage) => {
    const splats = [splat(damage)];
    return Object.assign(landed(core.CombatType.MELEE, splats), { getAttacker: () => attacker, updateTotalDamage() {} });
  };
  shield(holder, ITEMS.runeKiteshield);
  let hit = hitOn(12);
  randoms([0.098]); // under 9.9%
  hooks.onPlayerHitModify({ player: holder, hit });
  assert.equal(hit.getTotalDamage(), 0);
  assert.deepEqual(attacker.damage, [12]);
  hit = hitOn(12);
  randoms([0.1]);
  hooks.onPlayerHitModify({ player: holder, hit });
  assert.equal(hit.getTotalDamage(), 12);
  for (const other of others) {
    shield(other, ITEMS.runeKiteshield);
    hit = hitOn(12);
    randoms([0]);
    hooks.onPlayerHitModify({ player: other, hit });
    assert.equal(hit.getTotalDamage(), 12);
  }
  assert.deepEqual(attacker.damage, [12]);
});

test("0 damage taken with a two-handed shield or an off-hand heals 2 and restores 2 Prayer", () => {
  const { holder, others } = cast("pact-block", { [effect("shield_block_heal")]: 1 });
  const prayer = (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER);
  shield(holder, ITEMS.dragonDefender);
  holder.getSkillManager().setCurrentLevel(Skill.PRAYER, 50, false);
  hooks.onCombatHitResolved({ attacker: giant(), target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.deepEqual(heals(), [2]);
  assert.equal(prayer(holder), 52);
  hooks.onCombatHitResolved({ attacker: giant(), target: holder, hit: landed(core.CombatType.MELEE, [splat(3)]) });
  shield(holder, ITEMS.runeKiteshield);
  hooks.onCombatHitResolved({ attacker: giant(), target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.equal(prayer(holder), 52, "a hit, then a plain shield");
  holder.getEquipment().setItem(core.Equipment.SHIELD_SLOT, new core.Item(-1, 0));
  wield(holder, ITEMS.bulwark);
  hooks.onCombatHitResolved({ attacker: giant(), target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.equal(prayer(holder), 54, "Dinh's bulwark");
  for (const other of others) {
    shield(other, ITEMS.dragonDefender);
    hooks.onCombatHitResolved({ attacker: giant(), target: other, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  }
  assert.deepEqual(heals(), [2, 2]);
});

test("recoil from a ring of recoil lands with 1% of the wearer's defence bonuses", () => {
  const { holder, others } = cast("pact-recoil", { [effect("defence_recoil_scaling")]: 1 });
  const recoil = (player) => {
    const hit = splat(5).markReflected().setSource(player);
    for (const handler of custom["combat:damage-apply"]) handler({ target: giant(), hit });
    return hit.getDamage();
  };
  shield(holder, ITEMS.runeKiteshield);
  assert.equal(recoil(holder), 5, "no recoil ring");
  equip(holder, core.Equipment.RING_SLOT, ITEMS.ringOfRecoil);
  assert.equal(recoil(holder), 6);
  for (const other of others) {
    shield(other, ITEMS.runeKiteshield);
    equip(other, core.Equipment.RING_SLOT, ITEMS.ringOfRecoil);
    assert.equal(recoil(other), 5);
  }
});

test("Blindbag: the Dramen staff is no Blindbag weapon (Wiki, 6 May 2026)", () => {
  const DRAMEN_STAFF = 772;
  const { holder } = cast("pact-dramen", { [effect("free_random_weapon_attack_chance")]: 1 });
  holder.getInventory().add(new core.Item(DRAMEN_STAFF, 1));
  assert.deepEqual(Melee._test.heavyWeaponsCarried(holder), [], "1.8kg and a melee weapon, but left out");
  holder.getInventory().add(new core.Item(ITEMS.elderMaul, 1));
  assert.deepEqual(Melee._test.heavyWeaponsCarried(holder), [ITEMS.elderMaul]);
});

test("Thorns alone holds an NPC's regeneration timer through real queued damage and NPC turns", () => {
  const holder = character("pact-thorns-regen", { pacts: { [effect("thorns_damage")]: 1 } });
  holder.setAutoRetaliate(false);
  shield(holder, ITEMS.runeKiteshield);
  const npc = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
  npc.setRegistered(true);
  npc.setMaxHitpoints(100);
  npc.setHitpoints(100);
  npc.setScriptedMovement(true);
  cycle(10000);
  hooks.onCombatHitResolved({ attacker: npc, target: holder, hit: landed(core.CombatType.MELEE, [splat(0)]) });
  assert.equal(holder.getCombat().getTarget(), null, "no direct tag or auto-retaliation");
  npc.process();
  assert.equal(npc.getHitpoints(), 97, "the real Thorns hit survives the same NPC turn's healing check");
  assert.equal(npc.getCombat().getAttacker(), holder);
  assert.equal(npc.getCombat().getLastAttack().elapsed(), 0);
  assert.deepEqual(npc.getCombat().getRecentDamagers(), [], "PvM reflection keeps its existing credit policy");
  for (let tick = 10001; tick <= 10033; tick++) {
    cycle(tick);
    npc.process();
    assert.equal(npc.getHitpoints(), 97, "no fast healing before the existing timeout");
  }
  cycle(10034);
  npc.process();
  assert.equal(npc.getHitpoints(), 100, "ordinary healing resumes after the existing timer expires");
});

test("recoil and Vengeance share NPC combat bookkeeping without starting retaliation", () => {
  for (const producer of ["recoil", "vengeance"]) {
    const holder = character(`pact-regen-${producer}`);
    holder.setAutoRetaliate(false);
    const npc = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
    npc.setRegistered(true);
    npc.setScriptedMovement(true);
    npc.setMaxHitpoints(100);
    npc.setHitpoints(100);
    cycle(11000);
    if (producer === "recoil") core.CombatFactory.handleRecoil(holder, npc, 10);
    else core.CombatFactory.handleVengeance(holder, npc, 10);
    npc.process();
    const hp = producer === "recoil" ? 98 : 93;
    assert.equal(npc.getHitpoints(), hp, producer);
    assert.equal(npc.getCombat().getAttacker(), holder);
    assert.equal(holder.getCombat().getTarget(), null);
    cycle(11001);
    npc.getCombat().setUnderAttack(null);
    assert.equal(npc.getCombat().getAttacker(), null);
    assert.equal(npc.getCombat().getLastAttack().elapsed(), 0, "existing clear resets the clock");
    cycle(11034);
    npc.process();
    assert.equal(npc.getHitpoints(), hp);
    cycle(11035);
    npc.process();
    assert.equal(npc.getHitpoints(), 100);
  }
});

test("ordinary hits, undamaged NPCs and zero reflected damage keep their existing healing rules", () => {
  const holder = character("pact-regen-controls");
  for (const kind of ["ordinary", "undamaged", "zero", "sourceless"]) {
    const npc = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
    npc.setRegistered(true);
    npc.setScriptedMovement(true);
    npc.setMaxHitpoints(100);
    npc.setHitpoints(kind === "undamaged" ? 100 : 90);
    cycle(12000);
    if (kind === "ordinary") npc.getCombat().setUnderAttack(holder);
    if (kind === "zero") npc.getCombat().getHitQueue().addPendingDamage([splat(0).markReflected().setSource(holder)]);
    if (kind === "sourceless") npc.getCombat().getHitQueue().addPendingDamage([splat(1).markReflected()]);
    npc.process();
    assert.equal(npc.getHitpoints(), kind === "ordinary" ? 90 : kind === "sourceless" ? 99 : 100, kind);
    assert.equal(npc.getCombat().getAttacker(), kind === "ordinary" ? holder : null);
  }
});

/** A wounded hill giant beside the player's footprint, processed by its own NPC turns. */
function woundedGiant(location) {
  const npc = new NPC(HILL_GIANT, location);
  npc.setRegistered(true);
  npc.setScriptedMovement(true);
  npc.setMaxHitpoints(100);
  npc.setHitpoints(90);
  return npc;
}

const permission = (attacker, target) => core.CanAttackResponse[core.CombatFactory.canAttackPermission(attacker, target, true)];

test("a bystander's reflected hit pauses regeneration but leaves a single-way NPC with the player fighting it", () => {
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
  const fighter = character("pact-single-fighter");
  const bystander = character("pact-single-bystander");
  bystander.setLocation(new Location(3201, 3200, 0));
  const npc = woundedGiant(new Location(3200, 3201, 0));
  assert.equal(AreaManager.inMulti(npc), false, "single-way combat");
  cycle(13000);
  core.CombatFactory.executeHit(new PendingHit(fighter, npc, core.CombatFactory.getMethod(fighter), 0));
  npc.process(); // the fighter's own hit lands
  assert.equal(npc.getCombat().getAttacker(), fighter);
  const hp = npc.getHitpoints();
  cycle(13005);
  // Undying Retribution and recoil from someone the NPC is not fighting.
  core.CombatFactory.handleRecoil(bystander, npc, 10);
  npc.process();
  assert.equal(npc.getHitpoints(), hp - 2, "the bystander's recoil still lands");
  assert.equal(npc.getCombat().getAttacker(), fighter, "the fighter keeps the NPC");
  assert.equal(npc.getCombat().getLastAttack().elapsed(), 5 * GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE,
    "the fighter's own timer runs on; regeneration waits on it");
  assert.equal(permission(fighter, npc), "CAN_ATTACK");
  assert.equal(permission(bystander, npc), "TARGET_IN_COMBAT");
  // The fighter's own reflection still tags the NPC and holds its timer.
  cycle(13010);
  core.CombatFactory.handleRecoil(fighter, npc, 10);
  npc.process();
  assert.equal(npc.getHitpoints(), hp - 4);
  assert.equal(npc.getCombat().getAttacker(), fighter);
  assert.equal(npc.getCombat().getLastAttack().elapsed(), 0);
});

/** A fighter's single-way tag on a hill giant that targets a bystander wearing a ring of recoil; the fighter walks off. */
function staleTagScenario(name, start) {
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const { PendingHit } = require("../dist/game/content/combat/hit/PendingHit");
  const fighter = character(`${name}-fighter`);
  const bystander = character(`${name}-bystander`);
  bystander.setAutoRetaliate(false);
  equip(bystander, core.Equipment.RING_SLOT, ITEMS.ringOfRecoil);
  const npc = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
  npc.setRegistered(true);
  npc.setMaxHitpoints(100);
  npc.setHitpoints(100);
  assert.equal(AreaManager.inMulti(npc), false, "single-way combat");
  forceAccurate = true;
  randoms([], 0.99);
  cycle(start);
  return { fighter, bystander, npc, PendingHit };
}

/** The fighter's real hit tags the NPC, which keeps the bystander as its target. */
function fighterTags({ fighter, bystander, npc, PendingHit }) {
  core.CombatFactory.executeHit(new PendingHit(fighter, npc, core.CombatFactory.getMethod(fighter), 0));
  npc.process();
  assert.equal(npc.getCombat().getAttacker(), fighter);
  assert.equal(npc.getCombat().getTarget(), bystander, "a single-way NPC doesn't retarget");
  fighter.setLocation(new Location(3220, 3220, 0));
  return npc.getHitpoints();
}

test("ordinary single-way melee: the NPC waits out a fighter's tag before hitting a bystander", () => {
  const scenario = staleTagScenario("pact-stale-melee", 15000);
  const { bystander, npc } = scenario;
  npc.getCombat().attack(bystander);
  const tagged = fighterTags(scenario);
  for (let tick = 15001; tick <= 15060; tick++) {
    cycle(tick);
    bystander.getCombat().getHitQueue().process(tick);
    npc.process();
  }
  assert.ok(bystander.getHitpoints() < 99, "the NPC hit the bystander once the tag expired");
  assert.ok(npc.getHitpoints() < tagged - 5, "the bystander's recoil kept landing");
  assert.equal(npc.getCombat().getAttacker(), bystander, "the bystander's own recoil tags the untagged NPC");
  assert.equal(permission(bystander, npc), "CAN_ATTACK");
});

test("a bystander's recoil doesn't keep an absent fighter's single-way tag alive", () => {
  // NPC hits that land without the NPC's attack-permission check: one already in flight when the
  // fighter's tag lands, or a scripted/plugin attack that queues hits on players directly.
  const scenario = staleTagScenario("pact-stale-scripted", 16000);
  const { bystander, npc, PendingHit } = scenario;
  npc.getCombat().setTarget(bystander);
  const tagged = fighterTags(scenario);
  for (let tick = 16001; tick <= 16060; tick++) {
    cycle(tick);
    if ((tick - 16001) % 4 === 0) core.CombatFactory.executeHit(new PendingHit(npc, bystander, core.CombatFactory.getMethod(npc), 0));
    bystander.getCombat().getHitQueue().process(tick);
    npc.process();
    if (tick === 16005) assert.equal(npc.getCombat().getAttacker(), scenario.fighter, "the fighter's tag holds for 6 seconds");
  }
  assert.ok(bystander.getHitpoints() < 99 - 20, "the NPC kept hitting the bystander");
  assert.ok(npc.getHitpoints() < tagged - 10, "the bystander's recoil kept landing");
  assert.notEqual(npc.getCombat().getAttacker(), scenario.fighter, "the absent fighter's tag expires");
  assert.equal(permission(bystander, npc), "CAN_ATTACK");
});

test("a reflected hit from a dead or logged-out source pauses regeneration but tags nobody", () => {
  for (const gone of ["dead", "logged-out"]) {
    const source = character(`pact-gone-${gone}`);
    const other = character(`pact-gone-${gone}-other`);
    other.setLocation(new Location(3201, 3200, 0));
    const npc = woundedGiant(new Location(3200, 3201, 0));
    cycle(14000);
    core.CombatFactory.handleRecoil(source, npc, 10);
    if (gone === "dead") source.setHitpoints(0);
    else source.setRegistered(false);
    npc.process();
    assert.equal(npc.getHitpoints(), 88, `${gone}: the reflection still lands`);
    assert.equal(npc.getCombat().getAttacker(), null, gone);
    assert.equal(npc.getCombat().getLastAttack().elapsed(), 0, `${gone}: regeneration pauses`);
    assert.equal(permission(other, npc), "CAN_ATTACK", gone);
    for (let tick = 14001; tick <= 14033; tick++) {
      cycle(tick);
      npc.process();
      assert.equal(npc.getHitpoints(), 88, `${gone}: no healing before the existing timeout`);
    }
  }
});
