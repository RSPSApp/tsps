// Run after `yarn build`: node --test tests/league-relics-trailblazer.test.cjs
// Trailblazer Reloaded's Superior Sorcerer, Berserker and Undying Retribution (docs/leagues.md):
// each works for a Trailblazer Reloaded character who chose it, and for nobody else.
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
let inMulti = false;
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league"); // a league world
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
  const api = new Proxy({
    core,
    persistAttribute() {},
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback), // a Trailblazer Reloaded world
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => inMulti }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier: (modifier) => (modifiers.magicAccuracy ??= []).push(modifier),
    registerMagicDamageBonusModifier: (modifier) => (modifiers.magicDamageBonus ??= []).push(modifier),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  require("../plugins/modes/Relics.LeagueMode").register(api);
});

/** Applies every registered modifier of a kind in turn, as EquipmentEffects does (other relics register some too). */
function modify(name, entity, value) {
  return (modifiers[name] ?? []).reduce((current, fn) => fn(entity, current), value);
}

afterEach(() => {
  Math.random = realRandom;
  inMulti = false;
});

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot). */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
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

const SORCERER = { 3: 3 };
const BERSERKER = { 6: 1 };
const UNDYING = { 7: 2 };

function cases(picks) {
  return {
    relic: character("relic", "league", picks),
    without: character("without", "league", {}),
    echoes: character("echoes", "league", picks, 5),
    main: character("main", "main"),
  };
}

test("Superior Sorcerer: magic speed 2, +175% accuracy and +20% damage, for the relic's owner only", () => {
  const who = cases(SORCERER);
  const speed = (attacker, combatType) => {
    const event = { attacker, target: who.main, combatType, speed: 5 };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  assert.equal(speed(who.relic, core.CombatType.MAGIC), 2);
  assert.equal(speed(who.relic, core.CombatType.MELEE), 5, "melee keeps its speed");
  assert.equal(speed(who.without, core.CombatType.MAGIC), 5, "a Trailblazer character without the relic");
  assert.equal(speed(who.echoes, core.CombatType.MAGIC), 5, "the same slot in Raging Echoes is another relic");
  assert.equal(speed(who.main, core.CombatType.MAGIC), 5, "a main character");
  assert.equal(modify("magicAccuracy", who.relic, 1000), 2750);
  assert.equal(modify("magicAccuracy", who.without, 1000), 1000);
  assert.equal(modify("magicDamageBonus", who.relic, 100), 300, "+200 permille on top of gear");
  assert.equal(modify("magicDamageBonus", who.main, 100), 100);
});

test("Superior Sorcerer: a 90% roll a cast keeps the runes, and a powered staff's charge", () => {
  const who = cases(SORCERER);
  const rolls = [];
  Math.random = () => rolls.shift() ?? 0.5;
  const ask = (player) => {
    const request = { player, offensive: true, saved: false, message: null };
    for (const handler of custom["magic:rune-saving"]) handler(request);
    return [request.saved, request.message];
  };
  rolls.push(0.95);
  assert.deepEqual(ask(who.relic), [false, null], "a 95 misses the 90% save");
  rolls.push(0.2);
  assert.deepEqual(ask(who.relic), [true, null], "a 20 keeps the runes, with no message");
  assert.deepEqual(ask(who.without), [false, null]);
  assert.deepEqual(ask(who.echoes), [false, null]);
  assert.deepEqual(ask(who.main), [false, null]);
  const already = { player: who.relic, offensive: true, saved: true, message: "Your staff saved the runes." };
  for (const handler of custom["magic:rune-saving"]) handler(already);
  assert.equal(already.message, "Your staff saved the runes.", "another saver's answer stands");

  rolls.push(0.2);
  who.relic.getCombat().setCastSpell(core.CombatSpells.FIRE_STRIKE); // a cast in progress, as when a powered staff asks
  const charge = { player: who.relic, itemId: 12899, skip: false };
  for (const handler of custom["combat:consume-charge"]) handler(charge);
  assert.equal(charge.skip, true, "the trident keeps its charge");
  who.relic.getCombat().setCastSpell(null);
  const other = { player: who.echoes, itemId: 12899, skip: false };
  for (const handler of custom["combat:consume-charge"]) handler(other);
  assert.equal(other.skip, false);
  who.relic.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.RUNE_THROWNAXE, 1));
  core.CombatFactory.getMethod(who.relic);
  rolls.push(0.2);
  const thrown = { player: who.relic, itemId: core.ItemIdentifiers.RUNE_THROWNAXE, skip: false };
  for (const handler of custom["combat:consume-charge"]) handler(thrown);
  assert.equal(thrown.skip, false, "a ranged weapon's charge is not a powered staff's");
  who.relic.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
});

test("Superior Sorcerer: binding spells always land unless the target is frozen or immune", () => {
  const who = cases(SORCERER);
  const target = character("victim", "main");
  const roll = (attacker, spell) => {
    attacker.getCombat().setCastSpell(spell);
    const event = { attacker, target, combatType: core.CombatType.MAGIC, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
    hooks.onCombatHitRoll(event);
    attacker.getCombat().setCastSpell(null);
    return event.forceAccurate;
  };
  assert.equal(roll(who.relic, core.CombatSpells.ICE_BARRAGE), true);
  assert.equal(roll(who.relic, core.CombatSpells.BIND), true);
  assert.equal(roll(who.relic, core.CombatSpells.ENTANGLE), true);
  assert.equal(roll(who.relic, core.CombatSpells.FIRE_STRIKE), false, "not a bind");
  assert.equal(roll(who.without, core.CombatSpells.ICE_BARRAGE), false);
  assert.equal(roll(who.echoes, core.CombatSpells.ICE_BARRAGE), false);
  target.getTimers().registers(core.TimerKey.FREEZE, 10);
  assert.equal(roll(who.relic, core.CombatSpells.ICE_BARRAGE), false, "already bound");
  target.getTimers().cancel(core.TimerKey.FREEZE);
  target.getTimers().registers(core.TimerKey.FREEZE_IMMUNITY, 5);
  assert.equal(roll(who.relic, core.CombatSpells.ICE_BARRAGE), false, "still immune");
});

test("Superior Sorcerer: in multicombat a landed spell splashes up to five others for up to a quarter", () => {
  const who = cases(SORCERER);
  const target = character("primary", "main");
  const others = Array.from({ length: 7 }, (_, i) => character(`other${i}`, "main"));
  const queued = new Map();
  for (const other of others) {
    other.getCombat().getHitQueue().addPendingHit = (hit) => queued.set(other, hit);
  }
  who.relic.getLocalPlayers().push(target, ...others);
  const canAttack = core.CombatFactory.canAttackSecondaryTarget;
  core.CombatFactory.canAttackSecondaryTarget = (attacker, primary, candidate) => candidate !== attacker && candidate !== primary;
  const hit = {
    getCombatType: () => core.CombatType.MAGIC, isAccurate: () => true, getTotalDamage: () => 40,
  };
  try {
    hooks.onCombatHitResolved({ attacker: who.relic, target, hit });
    assert.equal(queued.size, 0, "nothing outside multicombat");
    inMulti = true;
    hooks.onCombatHitResolved({ attacker: who.relic, target, hit });
    assert.equal(queued.size, 5, "five of the seven");
    for (const extra of queued.values()) {
      assert.equal(extra.getAttacker(), who.relic);
      assert.ok(extra.getTotalDamage() >= 0 && extra.getTotalDamage() <= 10, `up to 25% of 40: ${extra.getTotalDamage()}`);
      assert.ok(extra.isAccurate(), "a fixed hit, not re-rolled");
    }
    const splashed = [...queued.values()][0];
    queued.clear();
    hooks.onCombatHitResolved({ attacker: who.relic, target: splashed.getTarget(), hit: splashed });
    assert.equal(queued.size, 0, "a splash never splashes");
    hooks.onCombatHitResolved({ attacker: who.without, target, hit });
    assert.equal(queued.size, 0);

    // With Berserker chosen too, the splash stays a quarter of the primary: the primary was scaled, its share is not scaled again.
    const both = character("bothpicks", "league", { ...SORCERER, ...BERSERKER });
    both.getSkillManager().setMaxLevels(Skill.HITPOINTS, 99, false);
    both.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 1, false); // 98 missing: Berserker would multiply by 1.392
    both.getLocalPlayers().push(target, ...others);
    for (const other of others) { // room for a 13, so the cap to remaining hitpoints never hides one
      other.getSkillManager().setMaxLevels(Skill.HITPOINTS, 99, false);
      other.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 99, false);
    }
    const random = core.Misc.randomInclusive;
    const emitHitDamage = PluginManager.emitCombatHitDamage;
    core.Misc.randomInclusive = (low, high) => high;
    PluginManager.emitCombatHitDamage = (event) => hooks.onCombatHitDamage(event); // the real PendingHit asks the plugins as it is built
    try {
      queued.clear();
      hooks.onCombatHitResolved({ attacker: both, target, hit });
      assert.equal(queued.size, 5);
      for (const extra of queued.values()) assert.equal(extra.getTotalDamage(), 10, "exactly 25% of 40, not 13");
    } finally {
      core.Misc.randomInclusive = random;
      PluginManager.emitCombatHitDamage = emitHitDamage;
    }
  } finally {
    core.CombatFactory.canAttackSecondaryTarget = canAttack;
  }
});

test("Berserker: +0.4% damage per missing hitpoint, and a max hit on a full-health NPC", () => {
  const who = cases(BERSERKER);
  const { HitDamage, HitMask } = core;
  const scaled = (attacker, base, missing) => {
    const skills = attacker.getSkillManager();
    skills.setCurrentLevel(Skill.HITPOINTS, skills.getMaxLevel(Skill.HITPOINTS) - missing, false);
    const damage = new HitDamage(base, HitMask.RED);
    hooks.onCombatHitDamage({ attacker, target: who.main, combatType: core.CombatType.MELEE, hit: null, damage, accurate: true });
    return damage.getDamage();
  };
  for (const player of Object.values(who)) player.getSkillManager().setMaxLevels(Skill.HITPOINTS, 99, false);
  assert.equal(scaled(who.relic, 40, 0), 40);
  assert.equal(scaled(who.relic, 40, 50), 48, "40 x 1.2 at 50 hitpoints down");
  assert.equal(scaled(who.relic, 25, 3), 25, "25 x 1.012, floored");
  assert.equal(scaled(who.relic, 30, 98), 41, "30 x 1.392 at 1 hitpoint left");
  assert.equal(scaled(who.without, 40, 50), 40);
  assert.equal(scaled(who.echoes, 40, 50), 40);
  assert.equal(scaled(who.main, 40, 50), 40);

  const npc = (hitpoints, max) => ({ isNpc: () => true, isPlayer: () => false, getHitpoints: () => hitpoints, getMaxHitpoints: () => max });
  const roll = (attacker, target) => {
    const event = { attacker, target, combatType: core.CombatType.MELEE, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
    hooks.onCombatHitRoll(event);
    return [event.forceAccurate, event.forceMaxHit];
  };
  assert.deepEqual(roll(who.relic, npc(100, 100)), [true, true]);
  assert.deepEqual(roll(who.relic, npc(99, 100)), [false, false], "not once it has been hurt");
  assert.deepEqual(roll(who.relic, who.main), [false, false], "never against a player");
  assert.deepEqual(roll(who.without, npc(100, 100)), [false, false]);
});

test("Undying Retribution: a death restores, cures and strikes everything within three tiles, once in three minutes", () => {
  const who = cases(UNDYING);
  const { HitDamage } = core;
  const skills = who.relic.getSkillManager();
  skills.setMaxLevels(Skill.PRAYER, 70, false);
  skills.setCurrentLevels(Skill.PRAYER, 0, false);
  skills.setMaxLevels(Skill.HITPOINTS, 99, false);
  const struck = new Map();
  const fakeNpc = (name, x, recoilImmune = false, { attackImmune = false } = {}) => ({
    name, isNpc: () => true, isPlayer: () => false,
    getTimers: () => ({ has: (key) => key === core.TimerKey.ATTACK_IMMUNITY && attackImmune }),
    getLocation: () => new Location(x, 3200, 0), getHitpoints: () => 50,
    getCurrentDefinition: () => ({ isAttackable: () => true }), getDefinition: () => ({ getName: () => name }),
    getAttribute: (key) => (key === "combat:recoil-immune" ? recoilImmune : undefined),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => struck.set(name, hits[0]) }) }),
  });
  const near = fakeNpc("Goblin", 3203);
  const far = fakeNpc("Far goblin", 3204);
  const immune = fakeNpc("Zulrah", 3201, true);
  const vorkath = fakeNpc("Vorkath", 3199, true);
  const phasing = fakeNpc("Phasing boss", 3202, false, { attackImmune: true });
  const protectedNpc = fakeNpc("Protected", 3198);
  const validTarget = core.CombatFactory.validTarget;
  const byPolicy = core.CombatFactory.canAttackByPolicy;
  core.CombatFactory.validTarget = () => true;
  core.CombatFactory.canAttackByPolicy = (attacker, target) => (target.name === "Protected" ? core.CanAttackResponse.CANT_ATTACK_IN_AREA : core.CanAttackResponse.CAN_ATTACK);
  who.relic.getLocalNpcs().push(near, far, immune, vorkath, phasing, protectedNpc);
  const bystander = character("bystander", "main");
  const foe = character("foe", "main");
  foe.getCombat().setUnderAttack(who.relic);
  who.relic.getCombat().setUnderAttack(foe);
  const foeHits = [];
  foe.getCombat().getHitQueue().addPendingDamage = (hits) => foeHits.push(hits[0]);
  who.relic.getLocalPlayers().push(bystander, foe);
  try {
    who.relic.setPoisonDamage(6);
    who.relic.setVenomed(true);
    who.relic.getCombat().getPoisonImmunityTimer().start(60);
    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const event = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(event);
    assert.equal(event.preventDeath, true);
    assert.equal(who.relic.getHitpoints(), 99, "hitpoints restored");
    assert.equal(skills.getCurrentLevel(Skill.PRAYER), 70, "prayer restored");
    assert.equal(who.relic.isPoisoned(), false);
    assert.equal(who.relic.isVenomed(), false);
    assert.equal(who.relic.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0, "the immunity goes too (Mod Ash)");
    assert.equal(who.relic.getGraphic()?.getId(), 437);
    assert.deepEqual([...struck.keys()].sort(), ["Goblin", "Vorkath"], "within 3 tiles; recoil-immune skipped unless excepted; attack-immune and policy-refused NPCs left alone");
    for (const hit of struck.values()) {
      assert.ok(hit instanceof HitDamage && hit.getDamage() >= 0 && hit.getDamage() <= 140 && hit.isReflected(), "up to 200% of Prayer 70");
    }
    assert.equal(foeHits.length, 1, "the player fighting them is hit");
    assert.ok(foeHits[0].getDamage() <= 35, "up to 50% of Prayer for a player");
    assert.ok(Number(who.relic.getAttribute("league:undying-retribution-ready-at")) > Date.now() + 170000);

    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const again = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(again);
    assert.equal(again.preventDeath, false, "on cooldown: the death goes ahead");
    hooks.onPlayerDefeated({ killer: null, victim: who.relic });
    assert.equal(who.relic.getAttribute("league:undying-retribution-ready-at"), 0, "a real death (the player defeated) resets it");
    const kept = { player: who.relic, preventDeath: true };
    hooks.onPlayerBeforeDeath(kept);
    assert.equal(who.relic.getAttribute("league:undying-retribution-ready-at"), 0, "a death another plugin already prevented costs nothing");
    skills.setCurrentLevel(Skill.HITPOINTS, 0, false);
    const third = { player: who.relic, preventDeath: false };
    hooks.onPlayerBeforeDeath(third);
    assert.equal(third.preventDeath, true);

    for (const other of [who.without, who.echoes, who.main]) {
      other.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 0, false);
      const none = { player: other, preventDeath: false };
      hooks.onPlayerBeforeDeath(none);
      assert.equal(none.preventDeath, false, `${other.getUsername()} dies as usual`);
    }
  } finally {
    core.CombatFactory.validTarget = validTarget;
    core.CombatFactory.canAttackByPolicy = byPolicy;
  }
});
