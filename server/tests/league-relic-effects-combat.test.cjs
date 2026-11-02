// Run after `yarn build`: node --test tests/league-relic-effects-combat.test.cjs
// The combat and XP relics (docs/leagues.md): Archer's Embrace, Brawler's Resolve, Soul Stealer,
// Weapon Master, Executioner (Trailblazer Reloaded), Specialist, Last Stand (Raging Echoes) and
// Equilibrium (both). Each works for a character of its league who chose it, and for nobody else:
// not a character of that league without it, not the other league's character with the same
// slots, not a main character.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");

let core;
const hooks = {};
const custom = {};
const modifiers = {};
const registered = { profiles: [], ammoHandlers: [] };
const realRandom = Math.random;
let realCycle;
let cycle = 1000;
let pluginApi;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a Trailblazer Reloaded world (the league type is the plugin config below)
  realCycle = core.World.getProcessCycle;
  core.World.getProcessCycle = () => cycle;
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(event);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const modifier = (name) => (fn) => ((modifiers[name] ??= []).push(fn));
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier: modifier("magicAccuracy"),
    registerMagicDamageBonusModifier: modifier("magicDamageBonus"),
    registerMeleeAttackAccuracyModifier: modifier("meleeAccuracy"),
    registerRangedAttackAccuracyModifier: modifier("rangedAccuracy"),
    registerMeleeDefenseModifier: modifier("meleeDefence"),
    registerRangedDefenseModifier: modifier("rangedDefence"),
    registerMagicDefenseModifier: modifier("magicDefence"),
    registerWeaponProfile: (profile) => registered.profiles.push(profile),
    registerRangedAmmoHandler: (handler) => registered.ammoHandlers.push(handler),
    registerCombatSpecial: (definition) => core.CombatSpecial.register(definition),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  pluginApi = api;
});

afterEach(() => {
  Math.random = realRandom;
});

/** Applies every registered modifier of a kind in turn, as EquipmentEffects does. */
function modify(name, entity, value) {
  return (modifiers[name] ?? []).reduce((current, fn) => fn(entity, current), value);
}

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot). */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

/** The owner, a same-league character without the relic, the other league's character with the same slots, and a main character. */
function cases(picks, league = 4) {
  return {
    relic: character("relic", "league", picks, league),
    without: character("without", "league", {}, league),
    other: character("other", "league", picks, league === 4 ? 5 : 4),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

function wield(player, itemId) {
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(itemId, 1));
  core.CombatFactory.getMethod(player);
}

/** A resolved hit as every relic unit reads it (they all see every hit). */
function fakeHit(overrides = {}) {
  return {
    getCombatType: () => core.CombatType.MELEE,
    isAccurate: () => true,
    getTotalDamage: () => 30,
    getCombatMethod: () => core.CombatFactory.MELEE_COMBAT,
    ...overrides,
  };
}

function fakeNpc(hitpoints, max) {
  return { isNpc: () => true, isPlayer: () => false, getHitpoints: () => hitpoints, getMaxHitpoints: () => max };
}

function strong(player) {
  const skills = player.getSkillManager();
  skills.setMaxLevels(Skill.STRENGTH, 99, false);
  skills.setCurrentLevels(Skill.STRENGTH, 99, false);
}

const ARCHERS = { 3: 1 };
const BRAWLERS = { 3: 2 };
const SOUL_STEALER = { 6: 2 };
const WEAPON_MASTER = { 6: 3 };
const EXECUTIONER = { 7: 1 };
const SPECIALIST = { 7: 1 };
const LAST_STAND = { 7: 3 };
const LAST_STAND_PREVIEW = { 5: 3 };
const EQUILIBRIUM_TRAILBLAZER = { 5: 1 };
const EQUILIBRIUM_ECHOES = { 3: 3 };

test("the special cost seam keeps the special's own cost when nobody answers", () => {
  const main = character("plain", "main");
  main.setSpecialPercentage(40);
  assert.deepEqual(core.CombatSpecial.cost(main, null, 50, "check"), { cost: 50, allow: false });
  assert.equal(core.CombatSpecial.affordable(main, null, 50), false);
  main.setSpecialPercentage(50);
  assert.equal(core.CombatSpecial.affordable(main, null, 50), true);
});

test("Archer's Embrace: ranged speed halved, accuracy doubled, an extra projectile, ammunition and charges saved, bolts proc twice", () => {
  const who = cases(ARCHERS);
  const { RANGED, MELEE } = core.CombatType;
  const speed = (attacker, combatType, base) => {
    const event = { attacker, target: who.main, combatType, speed: base };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  assert.deepEqual([7, 6, 5, 4, 3, 2, 1].map((base) => speed(who.relic, RANGED, base)), [3, 3, 2, 2, 2, 1, 1], "above 4 down, below 3 up");
  assert.equal(speed(who.relic, MELEE, 5), 5, "melee keeps its speed");
  for (const player of others(who)) assert.equal(speed(player, RANGED, 5), 5, `${player.getUsername()} keeps the speed`);

  assert.equal(modify("rangedAccuracy", who.relic, 1000), 2000);
  for (const player of others(who)) assert.equal(modify("rangedAccuracy", player, 1000), 1000);

  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  rolls.push(0.5, 0.95, 0.1);
  const arrows = core.ItemIdentifiers.RUNE_ARROW;
  assert.equal(emit("ranged:ammo-saving", { player: who.relic, itemId: arrows, amount: 3, saved: 0 }).saved, 2, "two of three shots kept");
  for (const player of others(who)) {
    assert.equal(emit("ranged:ammo-saving", { player, itemId: arrows, amount: 3, saved: 0 }).saved, 0);
  }

  wield(who.relic, core.ItemIdentifiers.RUNE_THROWNAXE);
  rolls.push(0.2);
  assert.equal(emit("combat:consume-charge", { player: who.relic, itemId: 1, skip: false }).skip, true, "a ranged weapon's charge is kept");
  who.relic.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  core.CombatFactory.getMethod(who.relic);
  rolls.push(0.2);
  assert.equal(emit("combat:consume-charge", { player: who.relic, itemId: 1, skip: false }).skip, false, "not a melee weapon's");
  for (const player of others(who)) {
    wield(player, core.ItemIdentifiers.RUNE_THROWNAXE);
    rolls.push(0.2);
    assert.equal(emit("combat:consume-charge", { player, itemId: 1, skip: false }).skip, false, `${player.getUsername()} spends the charge`);
  }

  const bolts = core.ItemIdentifiers.RUBY_BOLTS_E_;
  assert.equal(emit("combat:bolt-proc-chance", { player: who.relic, target: who.main, itemId: bolts, chance: 0.06 }).chance, 0.12);
  for (const player of others(who)) {
    assert.equal(emit("combat:bolt-proc-chance", { player, target: who.main, itemId: bolts, chance: 0.06 }).chance, 0.06);
  }

  wield(who.relic, core.ItemIdentifiers.RUNE_THROWNAXE);
  const queued = [];
  who.main.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  const hit = fakeHit({ getCombatType: () => RANGED, getCombatMethod: () => core.CombatFactory.RANGED_COMBAT });
  rolls.length = 0; // the melee and other-league charge cases rolled nothing
  rolls.push(0.5);
  hooks.onCombatHitResolved({ attacker: who.relic, target: who.main, hit });
  assert.equal(queued.length, 0, "a 50 misses the 10% chance");
  rolls.push(0.05);
  hooks.onCombatHitResolved({ attacker: who.relic, target: who.main, hit });
  assert.equal(queued.length, 1, "a 5 fires another");
  assert.equal(queued[0].getAttacker(), who.relic);
  assert.equal(queued[0].getTarget(), who.main);
  assert.equal(queued[0].getHits().length, 1, "one ordinary projectile");
  rolls.push(0.05);
  hooks.onCombatHitResolved({ attacker: who.relic, target: who.main, hit: queued[0] });
  assert.equal(queued.length, 1, "the extra projectile fires no extra of its own");
  // A special armed between the shot and its impact (Webweaver's four hits) is not borrowed.
  const activeTraitsFor = core.CombatSpecial.activeTraitsFor;
  core.CombatSpecial.activeTraitsFor = () => ({ hitCount: 4, hitDelayTicks: [0, 0, 1, 1] });
  try {
    rolls.push(0.05);
    hooks.onCombatHitResolved({ attacker: who.relic, target: who.main, hit });
    assert.equal(queued.length, 2);
    assert.equal(queued[1].getHits().length, 1, "still one ordinary projectile, not the special's four hits");
    assert.equal(queued[1].getHitDelays(), undefined, "nor its delays");
  } finally {
    core.CombatSpecial.activeTraitsFor = activeTraitsFor;
  }
  queued.length = 1;
  hooks.onCombatHitResolved({ attacker: who.relic, target: who.main, hit: fakeHit({ ...hit, isAccurate: () => false }) });
  assert.equal(queued.length, 1, "only a landed hit");
  for (const player of others(who)) {
    rolls.length = 0;
    rolls.push(0.05);
    hooks.onCombatHitResolved({ attacker: player, target: who.main, hit });
    assert.equal(queued.length, 1, `${player.getUsername()} fires no extra`);
  }
});

test("Archer's Embrace: the extra projectile is an ordinary shot: a special armed before its impact changes neither its accuracy nor its damage", () => {
  // The real specials: the toxic blowpipe's (more damage) and the Webweaver bow's (four weaker hits).
  require("../plugins/items/ToxicBlowpipe.plugin").register(pluginApi);
  require("../plugins/combat/specials/ToxicBlowpipe.SpecialAttack")(pluginApi);
  require("../plugins/combat/specials/WebweaverBow.SpecialAttack")(pluginApi);
  const who = cases(ARCHERS);
  const archer = who.relic;
  const target = who.main;
  const queued = [];
  target.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  const shot = (hit) => [hit.isAccurate(), hit.getHits().length, hit.getTotalDamage(), hit.getHitDelays()];
  archer.getSkillManager().setMaxLevels(Skill.RANGED, 99, false).setCurrentLevels(Skill.RANGED, 99, false);
  for (const weapon of [core.ItemIdentifiers.TOXIC_BLOWPIPE, core.ItemIdentifiers.WEBWEAVER_BOW]) {
    wield(archer, weapon);
    // A loaded blowpipe: rune darts and scales (its own item state).
    if (weapon === core.ItemIdentifiers.TOXIC_BLOWPIPE) {
      archer.getEquipment().get(core.Equipment.WEAPON_SLOT).setMetaValue("toxic-blowpipe", { scales: 1000, dartId: core.ItemIdentifiers.RUNE_DART, dartAmount: 1000 });
    }
    archer.setSpecialActivated(false);
    const method = core.CombatFactory.getMethod(archer);
    const special = core.CombatSpecial.getForWeaponId(weapon);
    assert.ok(special, `the ${weapon} special is registered`);
    for (const roll of [0.02, 0.35, 0.7, 0.999]) {
      // The control: an ordinary shot with nothing armed.
      archer.setSpecialActivated(false);
      Math.random = () => roll;
      const control = new core.PendingHit(archer, target, method, { delay: 0 });
      // The special is armed after the original shot left; the bonus procs (a 5) and rolls the same.
      archer.setCombatSpecial(special);
      archer.setSpecialActivated(true);
      archer.setSpecialPercentage(100);
      let first = true;
      Math.random = () => (first ? ((first = false), 0.05) : roll);
      queued.length = 0;
      hooks.onCombatHitResolved({ attacker: archer, target, hit: fakeHit({ getCombatType: () => core.CombatType.RANGED, getCombatMethod: () => method }) });
      assert.equal(queued.length, 1, `the bonus fires (${weapon}, roll ${roll})`);
      assert.deepEqual(shot(queued[0]), shot(control), `the bonus is the ordinary shot (${weapon}, roll ${roll})`);
      if (roll === 0.999) assert.ok(control.getTotalDamage() > 0 || !control.isAccurate(), "a real hit to compare");
      assert.equal(archer.isSpecialActivated(), true, "the special stays armed for the next attack");
      assert.equal(archer.getSpecialPercentage(), 100, "with its energy");
    }
  }
  archer.setSpecialActivated(false);
});

test("Brawler's Resolve: melee speed halved, +50% accuracy and defences, double damage, charges saved, status immunity", () => {
  const who = cases(BRAWLERS);
  const { RANGED, MELEE } = core.CombatType;
  const speed = (attacker, combatType, base) => {
    const event = { attacker, target: who.main, combatType, speed: base };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  assert.deepEqual([6, 5, 4, 3, 2].map((base) => speed(who.relic, MELEE, base)), [3, 2, 2, 2, 1]);
  assert.equal(speed(who.relic, RANGED, 5), 5);
  for (const player of others(who)) assert.equal(speed(player, MELEE, 5), 5);

  assert.equal(modify("meleeAccuracy", who.relic, 1000), 1500);
  assert.equal(modify("meleeDefence", who.relic, 100), 150);
  assert.equal(modify("magicDefence", who.relic, 100), 150);
  assert.equal(modify("rangedDefence", who.relic, 100), 100, "the ranged roll shares the melee level");
  for (const player of others(who)) {
    assert.equal(modify("meleeAccuracy", player, 1000), 1000);
    assert.equal(modify("meleeDefence", player, 100), 100);
    assert.equal(modify("magicDefence", player, 100), 100);
  }

  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const struck = (attacker, combatType, accurate, roll) => {
    const damage = new core.HitDamage(20, core.HitMask.RED);
    rolls.push(roll);
    hooks.onCombatHitDamage({ attacker, target: who.main, combatType, hit: null, damage, accurate });
    return damage.getDamage();
  };
  assert.equal(struck(who.relic, MELEE, true, 0.05), 40, "a 5 doubles");
  assert.equal(struck(who.relic, MELEE, true, 0.5), 20);
  assert.equal(struck(who.relic, MELEE, false, 0.05), 20, "a miss stays a miss");
  assert.equal(struck(who.relic, RANGED, true, 0.05), 20, "melee only");
  for (const player of others(who)) assert.equal(struck(player, MELEE, true, 0.05), 20);

  rolls.push(0.2);
  assert.equal(emit("combat:consume-charge", { player: who.relic, itemId: 1, skip: false }).skip, true, "unarmed is melee");
  wield(who.relic, core.ItemIdentifiers.RUNE_THROWNAXE);
  rolls.push(0.2);
  assert.equal(emit("combat:consume-charge", { player: who.relic, itemId: 1, skip: false }).skip, false, "not a ranged weapon's");
  for (const player of others(who)) {
    rolls.push(0.2);
    assert.equal(emit("combat:consume-charge", { player, itemId: 1, skip: false }).skip, false, `${player.getUsername()} spends the charge`);
  }

  for (const kind of ["poison", "venom", "dragonfire"]) {
    assert.equal(emit("combat:status-apply", { target: who.relic, kind, allow: true }).allow, false, `immune to ${kind}`);
    for (const player of others(who)) assert.equal(emit("combat:status-apply", { target: player, kind, allow: true }).allow, true);
  }
  assert.equal(emit("combat:status-apply", { target: who.relic, kind: "freeze", allow: true }).allow, true, "roots and stuns still take");
});

test("Soul Stealer: a minimum hit of 10% of the max, and a 50% restore of a tenth of a single-target hit", () => {
  const who = cases(SOUL_STEALER);
  const { MELEE } = core.CombatType;
  for (const player of Object.values(who)) strong(player);
  const max = core.DamageFormulas.sourceMaxHit(who.relic, MELEE);
  const floor = Math.floor(max * 0.1);
  assert.ok(floor > 0, `a max hit of ${max} gives a floor`);
  const rolled = (attacker, accurate, cycleAt) => {
    cycle = cycleAt;
    const damage = new core.HitDamage(0, core.HitMask.BLUE);
    const hit = fakeHit({ isAccurate: () => accurate });
    hooks.onCombatHitDamage({ attacker, target: who.main, combatType: MELEE, hit, damage, accurate });
    return [damage.getDamage(), hit];
  };
  assert.equal(rolled(who.relic, true, 1)[0], floor);
  assert.equal(rolled(who.relic, false, 2)[0], 0, "a miss is not raised");
  for (const player of others(who)) assert.equal(rolled(player, true, 3)[0], 0);

  const skills = who.relic.getSkillManager();
  skills.setMaxLevels(Skill.HITPOINTS, 99, false);
  skills.setMaxLevels(Skill.PRAYER, 70, false);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const resolved = (attacker, hit, roll) => {
    attacker.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 50, false);
    attacker.getSkillManager().setCurrentLevel(Skill.PRAYER, 0, false);
    rolls.push(roll);
    hooks.onCombatHitResolved({ attacker, target: who.main, hit });
    return [attacker.getHitpoints(), attacker.getSkillManager().getCurrentLevel(Skill.PRAYER)];
  };
  assert.deepEqual(resolved(who.relic, rolled(who.relic, true, 10)[1], 0.2), [53, 3], "a 20 restores ceil(3) of both");
  assert.deepEqual(resolved(who.relic, rolled(who.relic, true, 11)[1], 0.7), [50, 0], "a 70 misses the 50%");
  who.relic.setSpecialActivated(true);
  assert.deepEqual(resolved(who.relic, rolled(who.relic, true, 12)[1], 0.2), [50, 0], "not a special attack");
  who.relic.setSpecialActivated(false);
  cycle = 13;
  const first = rolled(who.relic, true, 13)[1];
  const second = new core.HitDamage(0, core.HitMask.BLUE);
  hooks.onCombatHitDamage({ attacker: who.relic, target: who.without, combatType: MELEE, hit: fakeHit(), damage: second, accurate: true });
  assert.deepEqual(resolved(who.relic, first, 0.2), [50, 0], "not an attack that struck two targets");
  for (const player of others(who)) {
    player.getSkillManager().setMaxLevels(Skill.HITPOINTS, 99, false);
    assert.deepEqual(resolved(player, rolled(player, true, 20)[1], 0.2), [50, 0]);
  }
});

test("Weapon Master: specials land on NPCs for at least 20% of the max, 30% energy a cycle, and 25 hitpoints buy a special", () => {
  const who = cases(WEAPON_MASTER);
  const { MELEE } = core.CombatType;
  for (const player of Object.values(who)) strong(player);
  const npc = fakeNpc(100, 100);
  const roll = (attacker, target, special) => {
    attacker.setSpecialActivated(special);
    const event = { attacker, target, combatType: MELEE, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
    hooks.onCombatHitRoll(event);
    return event.forceAccurate;
  };
  assert.equal(roll(who.relic, npc, true), true);
  assert.equal(roll(who.relic, npc, false), false, "an ordinary attack rolls");
  assert.equal(roll(who.relic, who.main, true), false, "never against a player");
  for (const player of others(who)) assert.equal(roll(player, npc, true), false);

  const max = core.DamageFormulas.sourceMaxHit(who.relic, MELEE);
  const floor = Math.floor(max * 0.2);
  assert.ok(floor > 0);
  const struck = (attacker, target, special, accurate) => {
    attacker.setSpecialActivated(special);
    const damage = new core.HitDamage(0, accurate ? core.HitMask.RED : core.HitMask.BLUE);
    hooks.onCombatHitDamage({ attacker, target, combatType: MELEE, hit: null, damage, accurate });
    return damage.getDamage();
  };
  assert.equal(struck(who.relic, npc, true, true), floor);
  assert.equal(struck(who.relic, npc, true, false), 0);
  assert.equal(struck(who.relic, npc, false, true), 0);
  assert.equal(struck(who.relic, who.main, true, true), floor, "the floor holds against players too; only the sure hit is NPC-only");
  for (const player of others(who)) assert.equal(struck(player, npc, true, true), 0);
  for (const player of Object.values(who)) player.setSpecialActivated(false);

  assert.equal(emit("combat-special:regenerate", { player: who.relic, amount: 10 }).amount, 30);
  for (const player of others(who)) assert.equal(emit("combat-special:regenerate", { player, amount: 10 }).amount, 10);

  const skills = who.relic.getSkillManager();
  skills.setMaxLevels(Skill.HITPOINTS, 99, false);
  skills.setCurrentLevel(Skill.HITPOINTS, 99, false);
  const ask = (player, phase, available) => emit("combat-special:cost", { player, specialId: "dragon_dagger", cost: 25, available, allow: false, phase });
  assert.equal(ask(who.relic, "check", 20).allow, true, "short of energy, the special is allowed");
  assert.equal(ask(who.relic, "check", 25).allow, false, "with the energy nothing changes");
  assert.equal(ask(who.relic, "check", 20).cost, 25, "the cost itself stands");
  skills.setCurrentLevel(Skill.HITPOINTS, 25, false);
  assert.equal(ask(who.relic, "check", 20).allow, false, "not with 25 hitpoints or fewer (ours)");
  skills.setCurrentLevel(Skill.HITPOINTS, 99, false);
  const drained = ask(who.relic, "drain", 20);
  assert.equal(who.relic.getHitpoints(), 74, "the drain costs 25 hitpoints");
  assert.equal(drained.cost, 0, "and no energy (the Wiki's instead)");
  assert.equal(ask(who.relic, "drain", 25).cost, 25, "a drain with the energy costs the energy");
  assert.equal(who.relic.getHitpoints(), 74, "and no hitpoints");
  for (const player of others(who)) {
    player.getSkillManager().setMaxLevels(Skill.HITPOINTS, 99, false);
    player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 99, false);
    assert.equal(ask(player, "check", 20).allow, false);
    ask(player, "drain", 20);
    assert.equal(player.getHitpoints(), 99);
  }
});

test("Specialist: specials cost a fifth with double accuracy, a miss refunds 10%, a kill restores 15%", () => {
  const who = cases(SPECIALIST, 5);
  assert.equal(emit("combat-special:cost", { player: who.relic, specialId: "x", cost: 50, available: 100, allow: false, phase: "check" }).cost, 20, "a 50% special costs 20");
  assert.equal(emit("combat-special:cost", { player: who.relic, specialId: "x", cost: 25, available: 100, allow: false, phase: "drain" }).cost, 20, "so does a 25% one (Wiki: all specials cost 20%)");
  for (const player of others(who)) {
    assert.equal(emit("combat-special:cost", { player, specialId: "x", cost: 50, available: 100, allow: false, phase: "check" }).cost, 50);
  }
  who.relic.setSpecialActivated(true);
  for (const kind of ["meleeAccuracy", "rangedAccuracy", "magicAccuracy"]) assert.equal(modify(kind, who.relic, 1000), 2000, kind);
  who.relic.setSpecialActivated(false);
  assert.equal(modify("meleeAccuracy", who.relic, 1000), 1000, "only while a special is active");
  for (const player of others(who)) {
    player.setSpecialActivated(true);
    assert.equal(modify("meleeAccuracy", player, 1000), 1000, `${player.getUsername()} rolls as usual`);
    player.setSpecialActivated(false);
  }

  const dealt = (player, special, accurate) => {
    player.setSpecialPercentage(50);
    player.setSpecialActivated(special);
    hooks.onPlayerDealtDamage({ player, target: who.main, hit: fakeHit({ isAccurate: () => accurate }) });
    player.setSpecialActivated(false);
    return player.getSpecialPercentage();
  };
  assert.equal(dealt(who.relic, true, false), 60, "a missed special refunds a tenth");
  assert.equal(dealt(who.relic, true, true), 50);
  assert.equal(dealt(who.relic, false, false), 50);
  for (const player of others(who)) assert.equal(dealt(player, true, false), 50);

  who.relic.setSpecialPercentage(90);
  hooks.onNpcDeath({ killer: who.relic, damagers: [who.relic], npc: {}, npcId: 1, location: { x: 0, y: 0, z: 0 }, remains: null });
  assert.equal(who.relic.getSpecialPercentage(), 100, "15% on a kill, capped");
  for (const player of others(who)) {
    player.setSpecialPercentage(50);
    hooks.onNpcDeath({ killer: player, damagers: [player], npc: {}, npcId: 1, location: { x: 0, y: 0, z: 0 }, remains: null });
    assert.equal(player.getSpecialPercentage(), 50);
  }
});

test("Last Stand: a lethal hit leaves 1 hitpoint, boosts to 255 draining to base + 15, shields for 16 ticks, then heals the damage dealt", () => {
  const who = cases(LAST_STAND, 5);
  const preview = character("preview", "league", LAST_STAND_PREVIEW, 5);
  const tasks = [];
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = (task) => tasks.push(task);
  try {
    const skills = who.relic.getSkillManager();
    skills.setMaxLevels(Skill.HITPOINTS, 99, false);
    skills.setMaxLevels(Skill.ATTACK, 70, false);
    skills.setCurrentLevels(Skill.ATTACK, 70, false);
    cycle = 100;
    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const event = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(event);
    assert.equal(event.preventDeath, true);
    assert.equal(who.relic.getHitpoints(), 1);
    for (const name of ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC"]) {
      assert.equal(skills.getCurrentLevel(Skill[name]), 255, `${name} boosted`);
    }
    assert.equal(skills.getCurrentLevel(Skill.PRAYER), skills.getMaxLevel(Skill.PRAYER), "prayer is not a combat stat here");
    assert.equal(tasks.length, 1, "the stand's tick task");
    assert.ok(Number(who.relic.getAttribute("league:last-stand-ready-at")) > Date.now() + 170000);

    const eat = { player: who.relic, itemId: core.ItemIdentifiers.SHARK, allow: null };
    hooks.onCanEat(eat);
    assert.equal(eat.allow, false, "no food during the stand");
    assert.equal(hooks.onCanDrink, undefined, "potions are not refused (no relic hooks drinking)");
    who.relic.heal(20);
    assert.equal(who.relic.getHitpoints(), 21, "a heal lands");
    cycle = 101;
    tasks[0].execute();
    assert.equal(who.relic.getHitpoints(), 1, "and is undone on the next tick");

    // Damage counts as each hit lands, while the stand is open (HitDamage.onApplied).
    const landed = (damage) => new core.HitDamage(damage, core.HitMask.RED);
    const thirty = landed(30);
    const twenty = landed(20);
    const cancelled = landed(40);
    hooks.onPlayerDealtDamage({ player: who.relic, target: who.main, hit: fakeHit({ getHits: () => [thirty] }) });
    hooks.onPlayerDealtDamage({ player: who.relic, target: who.main, hit: fakeHit({ getHits: () => [twenty] }) });
    hooks.onPlayerDealtDamage({ player: who.relic, target: who.main, hit: fakeHit({ getHits: () => [cancelled] }) });
    thirty.notifyApplied(30);
    twenty.notifyApplied(20);
    // `cancelled` never lands: its target teleported before the impact.

    cycle = 105;
    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const again = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(again);
    assert.equal(again.preventDeath, true, "within the window every lethal hit leaves 1");
    assert.equal(who.relic.getHitpoints(), 1);

    const task = tasks[0];
    for (let tick = 1; tick <= 16; tick++) {
      cycle = 100 + tick;
      task.execute();
    }
    const late = landed(25);
    hooks.onPlayerDealtDamage({ player: who.relic, target: who.main, hit: fakeHit({ getHits: () => [late] }) });
    late.notifyApplied(25); // lands after the window
    assert.equal(skills.getCurrentLevel(Skill.ATTACK), 85, "drained 16 a tick down to base + 15");
    assert.equal(skills.getCurrentLevel(Skill.STRENGTH), 1 + 15);
    assert.equal(who.relic.getHitpoints(), 51, "healed by the 50 damage dealt");
    const later = { player: who.relic, itemId: core.ItemIdentifiers.SHARK, allow: null };
    hooks.onCanEat(later);
    assert.equal(later.allow, null, "food again once the stand is over");

    cycle = 130;
    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const cooling = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(cooling);
    assert.equal(cooling.preventDeath, false, "on cooldown the death goes ahead");
    hooks.onPlayerDeath({ player: who.relic, killer: null, handled: false });
    assert.equal(who.relic.getAttribute("league:last-stand-ready-at"), 0, "a death resets it");

    preview.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 0, false);
    const alias = { player: preview, preventDeath: false };
    hooks.onPlayerBeforeDeath(alias);
    assert.equal(alias.preventDeath, true, "the catalog's tier 6 copy is the same relic");

    for (const player of others(who)) {
      player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 0, false);
      const none = { player, preventDeath: false };
      hooks.onPlayerBeforeDeath(none);
      assert.equal(none.preventDeath, false, `${player.getUsername()} dies as usual`);
    }
  } finally {
    core.TaskManager.submit = submit;
  }
});

test("Executioner: the Sage's axe is a thrown weapon that is never used up and finishes an NPC under 20%", () => {
  const who = cases(EXECUTIONER);
  const axe = core.ItemIdentifiers.SAGES_AXE;
  const profile = registered.profiles.find((entry) => entry.itemIds?.includes(axe));
  assert.deepEqual([profile?.attackDistance, profile?.longRangeFightType], [5, core.FightType.DART_LONGRANGE], "Longrange adds its 2: 7");
  wield(who.relic, axe);
  core.WeaponProfiles.register(profile);
  const fightType = who.relic.getFightType();
  who.relic.setFightType(core.FightType.DART_LONGRANGE);
  assert.equal(core.WeaponProfiles.attackDistance(who.relic, 0), 7, "Longrange: 7 tiles");
  who.relic.setFightType(core.FightType.DART_RAPID);
  assert.equal(core.WeaponProfiles.attackDistance(who.relic, 0), 5);
  who.relic.setFightType(fightType);
  assert.equal(core.RangedWeapon.getFor(who.relic), core.RangedWeapon.SAGES_AXE, "a ranged weapon of core's table");
  assert.equal(core.Ammunition.getFor(who.relic).getItemId(), axe, "its own ammunition");
  assert.equal(core.CombatFactory.getMethod(who.relic).type(), core.CombatType.RANGED);
  const handler = registered.ammoHandlers.find((entry) => entry.decrementAmmo(who.relic));
  assert.ok(handler, "the axe is not thrown away");
  assert.equal(handler.decrementAmmo(who.main), false, "other weapons consume as usual");

  const struck = (attacker, target) => {
    const damage = new core.HitDamage(0, core.HitMask.BLUE);
    const event = { attacker, target, combatType: core.CombatType.RANGED, hit: null, damage, accurate: false };
    hooks.onCombatHitDamage(event);
    return [damage.getDamage(), event.accurate];
  };
  assert.deepEqual(struck(who.relic, fakeNpc(10, 100)), [10, true], "under 20%: the rest of its hitpoints");
  assert.deepEqual(struck(who.relic, fakeNpc(19, 100)), [19, true]);
  assert.deepEqual(struck(who.relic, fakeNpc(20, 100)), [0, false], "20% is not under 20%");
  assert.deepEqual(struck(who.relic, who.main), [0, false], "never a player");
  who.relic.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  assert.deepEqual(struck(who.relic, fakeNpc(10, 100)), [0, false], "only with the axe");
  for (const player of others(who)) {
    wield(player, axe);
    assert.deepEqual(struck(player, fakeNpc(10, 100)), [0, false]);
  }
});

test("Equilibrium: every gain brings 10% of the total level in that skill, 20% in the least-experienced one, unmultiplied", () => {
  const trailblazer = cases(EQUILIBRIUM_TRAILBLAZER, 4);
  const echoes = cases(EQUILIBRIUM_ECHOES, 5);
  // getExperience reports whole points (the tenths stay stored), so a fresh skill shows the bonus floored.
  const shown = (value) => Math.floor(Math.floor(value * 10 + 1e-6) / 10);
  const gain = (player, skill) => {
    const skills = player.getSkillManager();
    const before = skills.getExperience(skill);
    emit("skills:experience-gained", { player, skill, experience: 10, multiplied: true });
    return skills.getExperience(skill) - before;
  };
  for (const who of [trailblazer, echoes]) {
    const total = who.relic.getSkillManager().getTotalLevel();
    assert.equal(gain(who.relic, Skill.COOKING), shown(total * 0.1), `${who.relic.getAttribute("league:type")}: a tenth of ${total}`);
    const least = Skill.values().reduce((low, skill) => (
      who.relic.getSkillManager().getExperience(skill) < who.relic.getSkillManager().getExperience(low) ? skill : low
    ));
    assert.notEqual(least, Skill.COOKING);
    assert.equal(gain(who.relic, least), shown(who.relic.getSkillManager().getTotalLevel() * 0.2), "a fifth in the least-experienced skill");
    for (const player of others(who)) assert.equal(gain(player, Skill.COOKING), 0, `${player.getUsername()} gets nothing`);
  }
  assert.notEqual(GameConstants.EXPERIENCE_MULTIPLIER, 0);
});

test.after(() => {
  core.World.getProcessCycle = realCycle;
});
