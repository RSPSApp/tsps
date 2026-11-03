// Run after `yarn build`: node --test tests/league-combat-masteries.test.cjs
// Raging Echoes' combat masteries (docs/leagues.md): the ten point challenges, the unlock checks and
// presentation, the captured interface flow, every mastery's effect and the cross-style passives,
// each for a Raging Echoes character and for nobody else.
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
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const Melee = require("../plugins/modes/leaguemasteries/Melee.LeagueCombatMasteries");
const EquipmentEffects = require("../dist/game/content/combat/EquipmentEffects");

let core;
const hooks = {};
const custom = {};
const modifiers = {};
const emitted = [];
const realRandom = Math.random;
let realRandomInclusive;
let realIsActivated;
let realEmitCustomEvent;
/** Real PendingHits in these tests land when this is set (a roll hook of the test's own). */
let forceAccurate = false;

const RAGING_ECHOES = 5;
const TRAILBLAZER = 4;
const uid = (group, child) => (group << 16) | child;
const POINT_MESSAGE = "<col=229628>Congratulations, you've earned a Combat Mastery point! Check the Combat Mastery interface to choose your next mastery.";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
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
    getPluginConfig: (key, fallback) => (key === "league:type" ? RAGING_ECHOES : fallback), // a Raging Echoes world
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMeleeAttackAccuracyModifier: (modifier) => (modifiers.meleeAccuracy = modifier),
    registerRangedAttackAccuracyModifier: (modifier) => (modifiers.rangedAccuracy = modifier),
    registerMagicAttackAccuracyModifier: (modifier) => (modifiers.magicAccuracy = modifier),
    registerIncomingDamageModifier: (modifier) => {
      modifiers.incoming = modifier;
      EquipmentEffects.registerIncomingDamageModifier(modifier); // so CombatFactory.getHitDamage applies it to real hits
    },
    registerRangedAmmoHandler: (handler) => (modifiers.ammo = handler),
    registerRangedCombatModifier: (modifier) => (modifiers.rangedCombat = modifier),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueCombatMasteries.plugin").register(api);
  // The core's own custom events (stats:heal, skills:restore) reach the handlers attached above.
  realEmitCustomEvent = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => {
    for (const handler of custom[name] ?? []) handler(payload);
    return realEmitCustomEvent.call(PluginManager, name, payload);
  };
  // Real PendingHits roll through the core's roll and hit damage hooks: route them to the handlers above.
  const realEmitCombatHitRoll = PluginManager.emitCombatHitRoll;
  PluginManager.emitCombatHitRoll = (event) => {
    hooks.onCombatHitRoll?.(event);
    if (forceAccurate) event.forceAccurate = true;
    return realEmitCombatHitRoll.call(PluginManager, event);
  };
  // The dragon claws special, registered as the SpecialAttacks plugin does.
  require("../plugins/combat/specials/DragonClaw.SpecialAttack")({ core, registerCombatSpecial: (definition) => core.CombatSpecial.register(definition) });
  const realEmitCombatHitDamage = PluginManager.emitCombatHitDamage;
  PluginManager.emitCombatHitDamage = (event) => {
    hooks.onCombatHitDamage?.(event);
    return realEmitCombatHitDamage.call(PluginManager, event);
  };
  realRandomInclusive = core.Misc.randomInclusive;
  realIsActivated = core.PrayerHandler.isActivated;
});

afterEach(() => {
  Math.random = realRandom;
  core.Misc.randomInclusive = realRandomInclusive;
  core.PrayerHandler.isActivated = realIsActivated;
  core.World.processCycle = 0;
  forceAccurate = false;
  emitted.length = 0;
});

/** The core's `combat:hit-rolled` for a roll of `damage` out of [minimum, maximum]; returns the damage it leaves. */
function hitRolled(attacker, target, combatType, damage, maximum, minimum = 0) {
  return query("combat:hit-rolled", { attacker, target, combatType, damage, minimum, maximum }).damage;
}

const cycle = (value) => (core.World.processCycle = value);
const rollEvent = (attacker, target, combatType) => ({ attacker, target, combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false });

/** Math.random answers from a queue, then `rest`. */
function randoms(values, rest = 0.5) {
  const queue = [...values];
  Math.random = () => (queue.length ? queue.shift() : rest);
}

/** A real player whose packets are recorded, logged in as a character of `profile` with the given masteries. */
function character(name, { profile = "league", league = RAGING_ECHOES, masteries = null, points = null, levels = 99 } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  const sent = { messages: [], varbits: new Map(), scripts: [], subs: [], flags: [], sounds: [], removals: 0 };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendInterfaceScript": return (id, args) => (sent.scripts.push([id, args]), sender);
        case "sendInterface": return (group) => (sent.subs.push(["main", group]), sender);
        case "sendInterfaceFlagsRange": return (...args) => (sent.flags.push(args), sender);
        case "sendSound": return (...args) => (sent.sounds.push(args), sender);
        case "sendInterfaceRemoval": return () => (sent.removals++, sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, levels, false);
    skills.setCurrentLevels(skill, levels, false);
  }
  if (profile === "league") {
    player.setAttribute("league:type", league);
    if (masteries) player.setAttribute("league:masteries", masteries);
    if (points) player.setAttribute("league:mastery-points", points);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return Object.assign(player, { sent });
}

const query = (name, payload) => {
  for (const handler of custom[name]) handler(payload);
  return payload;
};

const masteries = (player) => query("league:masteries", { player });

function npc(id) {
  return new NPC(id, new Location(3200, 3201, 0));
}

function kill(player, target, damagers = [player]) {
  hooks.onNpcDeath({ killer: player, damagers, npc: target, npcId: target.getId?.() ?? -1, location: { x: 3200, y: 3201, z: 0 } });
}

const HILL_GIANT = 2098;
const GIANT_RAT = 2856;
const ABYSSAL_DEMON = 415;
const SCURRIUS = 7221;
const TZTOK_JAD = 3127;
const TZKAL_ZUK = 7706;

test("login sends the mastery varbits to a Raging Echoes character only", () => {
  const echoes = character("echoes-login", { levels: 1, masteries: { melee: 2, ranged: 0, magic: 1 }, points: { giant: 1, jad: 1, zuk: 1 } });
  assert.equal(echoes.sent.varbits.get(11580), 2, "melee progress");
  assert.equal(echoes.sent.varbits.get(11581), 0, "ranged progress");
  assert.equal(echoes.sent.varbits.get(11582), 1, "magic progress");
  assert.equal(echoes.sent.varbits.get(11584), 3, "points earned");
  assert.equal(echoes.sent.varbits.get(11583), 0, "points to spend: three earned, three spent");
  assert.equal(echoes.sent.varbits.get(11585), 1, "point_unlock_1: the giant");
  assert.equal(echoes.sent.varbits.get(11586), 0, "point_unlock_2");
  assert.equal(echoes.sent.varbits.get(11589), 1, "point_unlock_5: Jad");
  assert.equal(echoes.sent.varbits.get(11594), 1, "point_unlock_10: Zuk");
  assert.equal(echoes.sent.varbits.get(17553), 5, "the tutorial, as captured");
  assert.equal(echoes.sent.varbits.get(11595), 0);
  assert.equal(echoes.sent.varbits.get(11596), 0);
  const trailblazer = character("trailblazer-login", { league: TRAILBLAZER, masteries: { melee: 2, ranged: 0, magic: 1 } });
  assert.equal(trailblazer.sent.varbits.has(17553), false, "a Trailblazer Reloaded character has no masteries");
  assert.equal(trailblazer.sent.varbits.has(11580), false);
  const main = character("main-login", { profile: "main" });
  assert.equal(main.sent.varbits.has(17553), false, "a main character neither");
  assert.deepEqual(masteries(main), { player: main, league: null, masteries: { melee: 0, ranged: 0, magic: 0 }, passiveTier: 0, points: { earned: 0, spent: 0, available: 0 }, challenges: [] });
});

test("the kill challenges: a giant, ten monsters of level 100+, Scurrius alone, a Slayer 55+ monster, Jad and Zuk, once each", () => {
  const player = character("challenger", { levels: 1 });
  kill(player, npc(GIANT_RAT));
  assert.deepEqual(masteries(player).challenges, [], "a giant rat is not a giant");
  kill(player, npc(HILL_GIANT));
  assert.deepEqual(masteries(player).challenges, ["giant"]);
  assert.equal(player.sent.varbits.get(11585), 1);
  assert.equal(player.sent.varbits.get(11584), 1);
  assert.equal(player.sent.varbits.get(11583), 1);
  assert.deepEqual(player.sent.messages, [POINT_MESSAGE]);
  assert.deepEqual(emitted.filter(([name]) => name === "league:mastery-point").map(([, e]) => [e.challenge, e.earned]), [["giant", 1]]);
  kill(player, npc(HILL_GIANT));
  assert.equal(masteries(player).points.earned, 1, "a second giant pays nothing");
  assert.equal(player.sent.messages.length, 1);

  const demon = npc(ABYSSAL_DEMON);
  assert.ok(demon.getDefinition().getSlayerLevel() >= 85, "the cache's abyssal demon needs Slayer 85");
  assert.ok(demon.getDefinition().getCombatLevel() >= 100);
  kill(player, demon);
  assert.deepEqual(masteries(player).challenges, ["giant", "slayer-55"], "Slayer 55+ at once; the level-100 count is one of ten");
  assert.equal(player.getAttribute("league:mastery-progress")["high-level-kills"], 1);
  for (let i = 0; i < 8; i++) kill(player, npc(ABYSSAL_DEMON));
  assert.equal(masteries(player).points.earned, 2);
  kill(player, npc(ABYSSAL_DEMON));
  assert.deepEqual(masteries(player).challenges, ["giant", "slayer-55", "high-level-kills"], "the tenth");

  const helper = character("helper");
  kill(player, npc(SCURRIUS), [player, helper]);
  assert.equal(masteries(player).challenges.includes("scurrius-solo"), false, "not alone");
  kill(player, npc(SCURRIUS));
  assert.ok(masteries(player).challenges.includes("scurrius-solo"));
  kill(player, npc(TZTOK_JAD));
  kill(player, npc(TZKAL_ZUK));
  assert.ok(masteries(player).challenges.includes("jad"));
  assert.ok(masteries(player).challenges.includes("zuk"));
  assert.equal(masteries(player).points.earned, 6);
  assert.equal(player.sent.varbits.get(11594), 1, "point_unlock_10");

  const trailblazer = character("trailblazer-kills", { league: TRAILBLAZER, levels: 1 });
  kill(trailblazer, npc(HILL_GIANT));
  assert.equal(trailblazer.getAttribute("league:mastery-points"), undefined);
  assert.deepEqual(trailblazer.sent.messages, []);
  const main = character("main-kills", { profile: "main" });
  kill(main, npc(TZKAL_ZUK));
  assert.deepEqual(main.sent.messages, []);
});

test("combat level 100 is checked on a level-up and at login; echo bosses count distinct names", () => {
  const low = character("low-level", { levels: 1 });
  assert.deepEqual(masteries(low).challenges, []);
  hooks.onPlayerLevelUp({ player: low, skill: Skill.ATTACK, oldLevel: 1, newLevel: 2 });
  assert.deepEqual(masteries(low).challenges, [], "level 2 is far from 100");
  const skills = low.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.HITPOINTS, Skill.PRAYER]) skills.setMaxLevels(skill, 99, false);
  assert.ok(skills.getCombatLevel() >= 100);
  hooks.onPlayerLevelUp({ player: low, skill: Skill.PRAYER, oldLevel: 98, newLevel: 99 });
  assert.deepEqual(masteries(low).challenges, ["combat-100"]);
  const maxed = character("maxed-login");
  assert.deepEqual(masteries(maxed).challenges, ["combat-100"], "a login of a level-126 character");

  const echo = (name) => ({ getCurrentDefinition: () => ({ getName: () => name, getCombatLevel: () => 500, getSlayerLevel: () => 0 }), getId: () => -1 });
  kill(maxed, echo("Cerberus (Echo)"));
  assert.deepEqual(masteries(maxed).challenges, ["combat-100", "high-level-kills"].slice(0, 1).concat(["echo-boss"]), "one echo boss; level 500 is one kill of ten");
  kill(maxed, echo("Cerberus (Echo)"));
  assert.equal(masteries(maxed).challenges.includes("echo-bosses-2"), false, "the same boss again");
  kill(maxed, echo("Hespori (Echo)"));
  assert.ok(masteries(maxed).challenges.includes("echo-bosses-2"));
  kill(maxed, echo("Sol Heredit (Echo)"));
  assert.ok(masteries(maxed).challenges.includes("echo-bosses-3"));
  assert.deepEqual(maxed.getAttribute("league:mastery-progress")["echo-bosses"], ["Cerberus (Echo)", "Hespori (Echo)", "Sol Heredit (Echo)"]);
});

test("an unlock needs a point and the previous tier, once; the first tier reached in any style unlocks its passive", () => {
  const player = character("unlocker", { levels: 1 });
  const command = (...parts) => hooks["command:mastery"]({ player, parts: ["mastery", ...parts] });
  command("melee", "1");
  assert.equal(player.sent.messages.at(-1), "You don't have a Combat Mastery point to spend.");
  command("point", "1");
  assert.equal(player.sent.messages.at(-2), POINT_MESSAGE);
  assert.equal(player.sent.messages.at(-1), "Awarded combat mastery challenge giant.");
  command("point", "1");
  assert.equal(player.sent.messages.at(-1), "You already have combat mastery challenge giant.");
  command("melee", "2");
  assert.equal(player.sent.messages.at(-1), "You need to unlock Melee I first.", "the data's `requires`");
  command("magic", "6");
  assert.equal(player.sent.messages.at(-1), "You need to unlock Magic V first.");
  command("melee", "7");
  assert.equal(player.sent.messages.at(-1), "Use ::mastery, ::mastery <melee|ranged|magic> <tier 1-6> or ::mastery point <1-10>.");
  player.sent.sounds.length = 0;
  command("melee", "1");
  assert.deepEqual(player.getAttribute("league:masteries"), { melee: 1, ranged: 0, magic: 0 });
  assert.equal(player.sent.varbits.get(11580), 1, "melee progress");
  assert.equal(player.sent.varbits.get(11583), 0, "the point is spent");
  assert.equal(player.sent.removals, 1, "the modal closed");
  assert.deepEqual(player.sent.sounds, [[4215, 1, 8], [4211, 1, 44], [4213, 1, 80], [4212, 1, 104]]);
  const unlocked = emitted.filter(([name]) => name === "league:mastery-unlocked").map(([, e]) => [e.style, e.tier, e.key, e.passiveUnlocked]);
  assert.deepEqual(unlocked, [["melee", 1, "melee-1", true]]);
  command("melee", "1");
  assert.equal(player.sent.messages.at(-1), "You have already unlocked that combat mastery.");
  command("point", "10");
  command("ranged", "1");
  assert.deepEqual(player.getAttribute("league:masteries"), { melee: 1, ranged: 1, magic: 0 });
  assert.equal(emitted.filter(([name]) => name === "league:mastery-unlocked").at(-1)[1].passiveUnlocked, false, "tier 1 was already reached");
  assert.deepEqual(masteries(player), {
    player, league: RAGING_ECHOES, masteries: { melee: 1, ranged: 1, magic: 0 }, passiveTier: 1,
    points: { earned: 2, spent: 2, available: 0 }, challenges: ["giant", "zuk"],
  });
  command();
  assert.equal(player.sent.messages.at(-1), "Combat masteries: Melee 1, Ranged 1, Magic 0 (passives to tier 1); points 0 to spend of 2 earned; challenges done: giant, zuk.");
  const trailblazer = character("trailblazer-command", { league: TRAILBLAZER });
  hooks["command:mastery"]({ player: trailblazer, parts: ["mastery", "point", "1"] });
  assert.equal(trailblazer.sent.messages.at(-1), "Only a Raging Echoes character has combat masteries.");
});

test("the interface as captured: the panel's button opens it, a tab and a node are recorded, confirm unlocks the viewed node", () => {
  const player = character("viewer", { points: { giant: 1 } });
  const click = (group, child, slot) => hooks[`button:${uid(group, child)}`]({ player, slot });
  assert.equal(click(311, 36, 7), false, "a node click before the button opened it");
  assert.equal(click(656, 32), true);
  assert.deepEqual(player.sent.subs, [["main", 311]]);
  assert.deepEqual(player.sent.flags, [[uid(311, 36), 0, 18, 2], [uid(311, 78), 10, 18, 2], [uid(311, 73), 0, 26, 2]]);
  assert.deepEqual(player.sent.scripts, [[3186, [uid(656, 31)]]]);
  assert.equal(click(311, 73, 9), true);
  assert.equal(player.sent.varbits.get(11596), 1, "the ranged tab");
  assert.equal(click(311, 36, 7), true);
  assert.equal(player.sent.varbits.get(11595), 7, "last viewed: Ranged II");
  const components = [8, 9, 11, 10, 54, 39, 44, 45, 55, 56, 13, 69, 70, 71, 72, 50, 51].map((child) => uid(311, child));
  assert.deepEqual(player.sent.scripts.at(-1), [7674, [...components, 1172, 1154]], "Ranged II's struct and the tier 2 passive's");
  click(311, 36, 8);
  assert.deepEqual(player.sent.scripts.at(-1)[1].slice(-2), [1173, 1156], "Ranged III and the tier 3 passive (Accuracy)");
  click(311, 36, 9);
  assert.deepEqual(player.sent.scripts.at(-1)[1].slice(-2), [1174, 1155], "Ranged IV and the tier 4 passive (Damage Reduction)");
  click(311, 36, 0);
  assert.deepEqual(player.sent.scripts.at(-1)[1].slice(-2), [1165, 1153], "Melee I");
  click(311, 36, 17);
  assert.deepEqual(player.sent.scripts.at(-1)[1].slice(-2), [1164, 1158], "Magic VI");
  assert.equal(click(311, 36, 18), false, "the last clickzone slot is no node");
  click(311, 36, 7);
  click(311, 71);
  assert.equal(player.sent.messages.at(-1), "You need to unlock Ranged I first.");
  click(311, 36, 6);
  click(311, 71);
  assert.deepEqual(player.getAttribute("league:masteries"), { melee: 0, ranged: 1, magic: 0 });
  assert.equal(player.sent.varbits.get(11581), 1);
  assert.equal(player.sent.removals, 1);
  assert.equal(click(311, 71), false, "the unlock closed the modal: the button must open it again");
  click(656, 32);
  click(311, 71);
  assert.equal(player.sent.messages.at(-1), "Select a combat mastery to unlock first.");
  assert.equal(click(311, 76), true, "close");
  assert.equal(player.sent.removals, 2);
  assert.equal(click(311, 76), false);
  click(656, 32);
  query("interface:closed", { player, interfaceId: 311 });
  assert.equal(click(311, 36, 7), false, "the modal closed another way: the button must open it again");
  const trailblazer = character("trailblazer-viewer", { league: TRAILBLAZER });
  assert.equal(hooks[`button:${uid(656, 32)}`]({ player: trailblazer }), false);
});

test("attack rates: tier 3 is 80% rounded down, tier 5 is 50% rounded down from five ticks and up below", () => {
  const speed = (attacker, combatType, base) => {
    const event = { attacker, target: null, combatType, speed: base };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  const third = character("melee-3", { masteries: { melee: 3, ranged: 0, magic: 0 } });
  assert.deepEqual([5, 4, 6, 7, 3, 2].map((base) => speed(third, core.CombatType.MELEE, base)), [4, 3, 4, 5, 2, 1]);
  assert.equal(speed(third, core.CombatType.RANGED, 5), 5, "another style keeps its speed");
  const fifth = character("ranged-5", { masteries: { melee: 0, ranged: 5, magic: 3 } });
  assert.deepEqual([5, 4, 3, 6, 7, 2, 1].map((base) => speed(fifth, core.CombatType.RANGED, base)), [2, 2, 2, 3, 3, 1, 1]);
  assert.equal(speed(fifth, core.CombatType.MAGIC, 5), 4, "magic at tier 3");
  assert.equal(speed(fifth, core.CombatType.MELEE, 5), 5);
  const trailblazer = character("trailblazer-speed", { league: TRAILBLAZER, masteries: { melee: 5, ranged: 5, magic: 5 } });
  assert.equal(speed(trailblazer, core.CombatType.MELEE, 5), 5, "a Trailblazer Reloaded character with the attribute");
  const main = character("main-speed", { profile: "main" });
  assert.equal(speed(main, core.CombatType.MELEE, 5), 5);
});

test("Melee I rolls twice on a quarter of hits and keeps the higher; Melee IV heals 40% of a hit on a twentieth", () => {
  const { CombatType } = core;
  const player = character("melee-1-4", { masteries: { melee: 4, ranged: 0, magic: 0 } });
  const target = npc(HILL_GIANT);
  const max = core.DamageFormulas.sourceMaxHit(player, CombatType.MELEE);
  assert.ok(max >= 5, `a max hit to roll from: ${max}`);
  core.Misc.randomInclusive = (min, high) => high;
  const roll = (attacker, base, chance) => {
    randoms([chance]);
    return hitRolled(attacker, target, CombatType.MELEE, base, max);
  };
  assert.equal(roll(player, 1, 0.1), max, "a second roll of the max hit replaces a 1");
  assert.equal(roll(player, 1, 0.3), 1, "no second roll on the other three quarters");
  core.Misc.randomInclusive = () => 0;
  assert.equal(roll(player, 3, 0.1), 3, "a lower second roll changes nothing");
  const trailblazer = character("trailblazer-melee", { league: TRAILBLAZER, masteries: { melee: 6, ranged: 0, magic: 0 } });
  core.Misc.randomInclusive = (min, high) => high;
  assert.equal(roll(trailblazer, 1, 0.1), 1);

  player.setHitpoints(50);
  const hit = { getCombatType: () => CombatType.MELEE, isAccurate: () => true, getTotalDamage: () => 20 };
  randoms([0.5, 0.5]);
  hooks.onCombatHitResolved({ attacker: player, target, hit });
  assert.equal(player.getHitpoints(), 50, "a 50 misses the 5% heal");
  randoms([0.01, 0.5]);
  hooks.onCombatHitResolved({ attacker: player, target, hit });
  assert.equal(player.getHitpoints(), 59, "40% of 20 is 8, and the tier 2 passive makes every heal 20% more: 9");
  const miss = { getCombatType: () => CombatType.MELEE, isAccurate: () => false, getTotalDamage: () => 0 };
  randoms([0.01, 0.5]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: miss });
  assert.equal(player.getHitpoints(), 59, "nothing to heal from a miss");
});

test("Melee II echoes a tenth of melee attacks on NPCs with a half-max-hit melee hit; Melee VI echoes a fifth and chains to eight", () => {
  const { CombatType } = core;
  const second = character("melee-2", { masteries: { melee: 2, ranged: 0, magic: 0 } });
  const target = npc(HILL_GIANT);
  const queued = [];
  target.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  const hit = { getCombatType: () => CombatType.MELEE, isAccurate: () => true, getTotalDamage: () => 10 };
  const max = core.DamageFormulas.sourceMaxHit(second, CombatType.MELEE);
  randoms([0.15]);
  hooks.onCombatHitResolved({ attacker: second, target, hit });
  assert.equal(queued.length, 0, "a 15 misses the 10%");
  randoms([0.05], 0.01); // the echo roll, then an accurate echo
  core.Misc.randomInclusive = (low, high) => high;
  hooks.onCombatHitResolved({ attacker: second, target, hit });
  assert.equal(queued.length, 1);
  const echo = queued[0];
  assert.ok(Melee.isEcho(echo));
  assert.equal(echo.getAttacker(), second);
  assert.equal(echo.getTarget(), target);
  assert.equal(echo.getCombatType(), CombatType.MELEE);
  assert.ok(echo.isAccurate());
  assert.equal(echo.getTotalDamage(), Math.floor(max / 2), `rolled from half the max hit (${max})`);
  core.Misc.randomInclusive = realRandomInclusive;
  randoms([0.05]);
  hooks.onCombatHitResolved({ attacker: second, target, hit: echo });
  assert.equal(queued.length, 1, "an echo does not echo without Melee VI");
  hooks.onCombatHitResolved({ attacker: second, target: character("victim", { profile: "main" }), hit });
  assert.equal(queued.length, 1, "PvM only");
  const ranged = { getCombatType: () => CombatType.RANGED, isAccurate: () => true, getTotalDamage: () => 10 };
  randoms([0.05]);
  hooks.onCombatHitResolved({ attacker: second, target, hit: ranged });
  assert.equal(queued.length, 1, "melee only");

  const sixth = character("melee-6", { masteries: { melee: 6, ranged: 0, magic: 0 } });
  queued.length = 0;
  randoms([], 0.15); // every roll (Melee IV's heal, the echo, the echo's own accuracy) a 15
  hooks.onCombatHitResolved({ attacker: sixth, target, hit });
  assert.equal(queued.length, 1, "a 15 is within the 20%");
  let last = queued[0];
  randoms([], 0.1);
  for (let depth = 1; depth < 8; depth++) {
    hooks.onCombatHitResolved({ attacker: sixth, target, hit: last });
    assert.equal(queued.length, depth + 1, `echo ${depth + 1} of 8`);
    last = queued.at(-1);
  }
  hooks.onCombatHitResolved({ attacker: sixth, target, hit: last });
  assert.equal(queued.length, 8, "the eighth echo is the last");
  const trailblazer = character("trailblazer-echo", { league: TRAILBLAZER, masteries: { melee: 6, ranged: 0, magic: 0 } });
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: trailblazer, target, hit });
  assert.equal(queued.length, 8);
});

test("Ranged I lifts low rolls to 30%; Ranged II stacks 5% a shot to 20%; Ranged IV heals on the fifth hit; Ranged VI never misses NPCs", () => {
  const { CombatType } = core;
  const player = character("ranged-6", { masteries: { melee: 0, ranged: 6, magic: 0 } });
  const target = npc(HILL_GIANT);
  const max = core.DamageFormulas.sourceMaxHit(player, CombatType.RANGED);
  const floor = Math.floor(max * 0.3);
  assert.ok(floor >= 2, `a ranged max hit to work from: ${max}`);
  const roll = (attacker, base, maximum = max) => hitRolled(attacker, target, CombatType.RANGED, base, maximum);
  assert.equal(roll(player, 1), floor);
  assert.equal(roll(player, floor + 1), floor + 1);

  const shoot = (tick) => {
    cycle(tick);
    hooks.onCombatHitRoll(rollEvent(player, target, CombatType.RANGED));
  };
  const maxHit = () => modifiers.rangedCombat.modifyMaxHit(player, target, 100);
  const seen = [];
  for (let i = 0; i < 7; i++) {
    shoot(100 + i * 4);
    seen.push(maxHit());
  }
  assert.deepEqual(seen, [100, 105, 110, 115, 120, 100, 105], "+5% a subsequent shot, back to nothing after +20%");
  hooks.onCombatHitRoll(rollEvent(player, target, CombatType.RANGED));
  assert.equal(maxHit(), 105, "a second hitsplat's roll in the same cycle is the same attack");
  assert.equal(roll(player, 1, modifiers.rangedCombat.modifyMaxHit(player, target, max)), Math.floor(Math.floor(max * 1.05) * 0.3),
    "Ranged I's floor is 30% of the roll's own max hit, Ranged II's bonus on it");
  assert.equal(modifiers.rangedCombat.modifyAttackRoll(player, target, 100), null);
  cycle(0);

  player.setHitpoints(50);
  const hit = { getCombatType: () => CombatType.RANGED, isAccurate: () => true, getTotalDamage: () => 10, getHits: () => [1] };
  for (let i = 0; i < 4; i++) hooks.onCombatHitResolved({ attacker: player, target, hit });
  assert.equal(player.getHitpoints(), 50);
  hooks.onCombatHitResolved({ attacker: player, target, hit });
  assert.equal(player.getHitpoints(), 56, "the fifth heals 5, and the tier 2 passive makes it 6");
  const triple = { ...hit, getHits: () => [1, 2, 3] };
  for (let i = 0; i < 4; i++) hooks.onCombatHitResolved({ attacker: player, target, hit });
  hooks.onCombatHitResolved({ attacker: player, target, hit: triple });
  assert.equal(player.getHitpoints(), 74, "5 a hitsplat: 15, made 18");

  const rollAccuracy = (attacker, victim) => {
    const event = { attacker, target: victim, combatType: CombatType.RANGED, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
    hooks.onCombatHitRoll(event);
    return event.forceAccurate;
  };
  assert.equal(rollAccuracy(player, target), true);
  assert.equal(rollAccuracy(player, character("pvp-target", { profile: "main" })), false, "PvM only");
  const fifth = character("ranged-5-only", { masteries: { melee: 0, ranged: 5, magic: 0 } });
  assert.equal(rollAccuracy(fifth, target), false);
  const trailblazer = character("trailblazer-ranged", { league: TRAILBLAZER, masteries: { melee: 0, ranged: 6, magic: 0 } });
  assert.equal(rollAccuracy(trailblazer, target), false);
  assert.equal(roll(trailblazer, 1), 1);
});

test("Magic I and IV act on rolls above 90% of the max hit; Magic II grows the max hit with idle ticks; Magic VI scales with the target's hitpoints and executes", () => {
  const { HitDamage, HitMask, CombatType, CombatSpells } = core;
  const rollMagic = (attacker, base, hit = null) => {
    const damage = hitRolled(attacker, target, CombatType.MAGIC, base, max);
    hooks.onCombatHitDamage({ attacker, target, combatType: CombatType.MAGIC, hit, damage: new HitDamage(damage, HitMask.RED), accurate: true });
    return damage;
  };
  const player = character("magic-6", { masteries: { melee: 0, ranged: 0, magic: 6 } });
  player.getCombat().setCastSpell(CombatSpells.FIRE_STRIKE);
  const target = npc(HILL_GIANT);
  const max = core.DamageFormulas.sourceMaxHit(player, CombatType.MAGIC);
  assert.ok(max >= 5, `fire strike's max hit: ${max}`);
  const threshold = Math.floor(max * 0.9);
  const roll = rollMagic;
  assert.equal(roll(player, max), Math.floor(max * 1.5), "a max roll is above 90%: +50%");
  assert.equal(roll(player, threshold), threshold, "90% itself is not above it");
  player.setHitpoints(50);
  const high = { getCombatType: () => CombatType.MAGIC, isAccurate: () => true, getTotalDamage: () => 30 };
  roll(player, max, high);
  hooks.onCombatHitResolved({ attacker: player, target, hit: high });
  assert.equal(player.getHitpoints(), 53, "Magic IV: 10% of 30, and the tier 2 passive's 20% more rounds to 3");
  hooks.onCombatHitResolved({ attacker: player, target, hit: high });
  assert.equal(player.getHitpoints(), 53, "a hit heals once");
  const low = { getCombatType: () => CombatType.MAGIC, isAccurate: () => true, getTotalDamage: () => 30 };
  roll(player, 1, low);
  hooks.onCombatHitResolved({ attacker: player, target, hit: low });
  assert.equal(player.getHitpoints(), 53, "a low roll heals nothing");

  const magicMaxHit = (attacker, victim, base) => query("combat:magic-max-hit", { attacker, target: victim, maxHit: base }).maxHit;
  const cast = (tick) => {
    cycle(tick);
    hooks.onCombatHitRoll(rollEvent(player, target, CombatType.MAGIC));
  };
  const lowHp = { getHitpoints: () => 50 };
  cast(100);
  assert.equal(magicMaxHit(player, lowHp, 100), 140, "the first cast since login takes the cap");
  cast(105);
  assert.equal(magicMaxHit(player, lowHp, 100), 120, "four idle ticks: +20%");
  cast(106);
  assert.equal(magicMaxHit(player, lowHp, 100), 100, "a cast the next tick: nothing");
  cast(130);
  assert.equal(magicMaxHit(player, lowHp, 100), 140, "capped at +40%");
  cast(130);
  assert.equal(magicMaxHit(player, lowHp, 100), 140, "another roll of the same cast changes nothing");
  assert.equal(magicMaxHit(player, { getHitpoints: () => 550 }, 100), 145, "Magic VI: 5% for 550 hitpoints, added to Magic II's 40%");
  assert.equal(magicMaxHit(player, { getHitpoints: () => 2000 }, 100), 150, "capped at +10%");

  const rollHit = (attacker, victim) => {
    const event = rollEvent(attacker, victim, CombatType.MAGIC);
    hooks.onCombatHitRoll(event);
    return event.forceMaxHit;
  };
  const withHitpoints = (hitpoints) => Object.assign(npc(HILL_GIANT), { getHitpoints: () => hitpoints });
  const grown = core.DamageFormulas.sourceMaxHit(player, CombatType.MAGIC);
  assert.equal(grown, Math.floor(max * 1.4), "the max hit the last cast left (Magic II's +40%)");
  assert.equal(rollHit(player, withHitpoints(grown - 1)), true, "fewer hitpoints than the max hit: a max hit");
  assert.equal(rollHit(player, withHitpoints(grown)), false);
  const archer = character("magic-0", { masteries: { melee: 0, ranged: 6, magic: 0 } });
  archer.getCombat().setCastSpell(CombatSpells.FIRE_STRIKE);
  assert.equal(roll(archer, max), max, "no Magic I: another style's tiers do not count");
  assert.equal(magicMaxHit(archer, { getHitpoints: () => 2000 }, 100), 100, "no Magic II or VI");
  const trailblazer = character("trailblazer-magic", { league: TRAILBLAZER, masteries: { melee: 0, ranged: 0, magic: 6 } });
  trailblazer.getCombat().setCastSpell(CombatSpells.FIRE_STRIKE);
  assert.equal(roll(trailblazer, max), max);
  assert.equal(magicMaxHit(trailblazer, { getHitpoints: () => 2000 }, 100), 100);
});

test("the passives: saved runes, charges and ammunition; bigger heals; double accuracy; less damage taken; more Prayer; prayer penetration", () => {
  const { HitDamage, HitMask, CombatType, Skill: Skills, PrayerHandler } = core;
  const one = character("passive-1", { masteries: { melee: 1, ranged: 0, magic: 0 } });
  const six = character("passive-6", { masteries: { melee: 0, ranged: 0, magic: 6 } });
  const trailblazer = character("trailblazer-passives", { league: TRAILBLAZER, masteries: { melee: 6, ranged: 6, magic: 6 } });
  const main = character("main-passives", { profile: "main" });

  const runes = (player) => query("magic:rune-saving", { player, offensive: true, saved: false, message: null }).saved;
  randoms([0.94]);
  assert.equal(runes(one), true, "a 94 is within the 95%");
  randoms([0.96]);
  assert.equal(runes(one), false);
  randoms([0.1]);
  assert.equal(runes(trailblazer), false);
  randoms([0.1]);
  assert.equal(runes(main), false);
  randoms([0.1]);
  assert.equal(query("combat:consume-charge", { player: one, itemId: 12899, skip: false }).skip, true, "the staff keeps its charge");
  randoms([0.1]);
  assert.equal(query("combat:consume-charge", { player: trailblazer, itemId: 12899, skip: false }).skip, false);
  randoms([0.1]);
  assert.equal(modifiers.ammo.decrementAmmo(one, null, 1, 0), true, "the arrow stays");
  randoms([0.96]);
  assert.equal(modifiers.ammo.decrementAmmo(one, null, 1, 0), false, "used as usual");
  randoms([0.1]);
  assert.equal(modifiers.ammo.decrementAmmo(trailblazer, null, 1, 0), false);
  assert.equal(modifiers.ammo.checkAmmo(one, 1), null);

  one.setHitpoints(50);
  one.heal(10);
  assert.equal(one.getHitpoints(), 60, "tier 1 only: heals are what they are");
  six.setHitpoints(50);
  six.heal(10);
  assert.equal(six.getHitpoints(), 62, "20% more");
  six.heal(60);
  assert.equal(six.getHitpoints(), 99, "never past full hitpoints");
  six.setHitpoints(110);
  assert.equal(six.getHitpoints(), 110, "an overheal keeps its own target");
  trailblazer.setHitpoints(50);
  trailblazer.heal(10);
  assert.equal(trailblazer.getHitpoints(), 60);

  assert.equal(modifiers.meleeAccuracy(six, 1000), 2000);
  assert.equal(modifiers.rangedAccuracy(six, 1000), 2000);
  assert.equal(modifiers.magicAccuracy(six, 1000), 2000);
  assert.equal(modifiers.meleeAccuracy(one, 1000), 1000, "tier 3 not reached");
  assert.equal(modifiers.meleeAccuracy(trailblazer, 1000), 1000);
  assert.equal(modifiers.magicAccuracy(main, 1000), 1000);

  const incoming = (player, base) => {
    const damage = new HitDamage(base, HitMask.RED);
    modifiers.incoming(player, damage);
    return damage.getDamage();
  };
  assert.equal(incoming(six, 100), 85);
  assert.equal(incoming(one, 100), 100);
  assert.equal(incoming(trailblazer, 100), 100);

  const prayer = (player) => {
    player.getSkillManager().setCurrentLevels(Skills.PRAYER, 10, false);
    player.getSkillManager().increaseCurrentLevel(Skills.PRAYER, 8, 99);
    return player.getSkillManager().getCurrentLevel(Skills.PRAYER);
  };
  assert.equal(prayer(six), 20, "8 made 10");
  assert.equal(prayer(one), 18);
  assert.equal(prayer(trailblazer), 18);
  six.getSkillManager().setCurrentLevels(Skills.HITPOINTS, 10, false);
  six.getSkillManager().increaseCurrentLevel(Skills.HITPOINTS, 8, 99);
  assert.equal(six.getSkillManager().getCurrentLevel(Skills.HITPOINTS), 18, "Prayer only");

  const archer = character("passive-6-ranged", { masteries: { melee: 0, ranged: 6, magic: 0 } });
  const victim = character("praying", { profile: "main" });
  PrayerHandler.isActivated = (who, prayer) => who === victim && prayer === PrayerHandler.PROTECT_FROM_MISSILES;
  const strike = (attacker, base, combatType = CombatType.RANGED) => {
    const roll = { attacker, target: victim, combatType, forceAccurate: false, forceMaxHit: false, bypassProtectionPrayer: false };
    hooks.onCombatHitRoll(roll);
    const damage = new HitDamage(base, HitMask.RED);
    hooks.onCombatHitDamage({ attacker, target: victim, combatType, hit: null, damage, accurate: true });
    return [roll.bypassProtectionPrayer, damage.getDamage()];
  };
  assert.deepEqual(strike(archer, 100), [true, 84], "the roll ignores Protect from Missiles; the damage takes 40% of the usual 40% off");
  assert.deepEqual(strike(archer, 100, CombatType.MELEE), [false, 100], "not praying against melee");
  assert.deepEqual(strike(one, 100), [false, 100], "tier 6 not reached: the core's own reduction applies later");
  assert.deepEqual(strike(trailblazer, 100), [false, 100]);
});

test("an echo is an ordinary hit: dragon claws armed between the swing and the landing neither shape it nor are spent", () => {
  const { CombatType, CombatSpecial, ItemIdentifiers } = core;
  const player = character("echo-claws", { masteries: { melee: 2, ranged: 0, magic: 0 } });
  const target = npc(HILL_GIANT);
  target.setHitpoints(500);
  const queued = [];
  target.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  const ordinaryMax = core.DamageFormulas.sourceMaxHit(player, CombatType.MELEE);
  player.setCombatSpecial(CombatSpecial.getForWeaponId(ItemIdentifiers.DRAGON_CLAWS));
  player.setSpecialActivated(true);
  forceAccurate = true;
  core.Misc.randomInclusive = (low, high) => high;
  const armed = new core.PendingHit(player, target, core.CombatFactory.MELEE_COMBAT, { delay: 0 });
  assert.equal(armed.getHits().length, 4, "an armed claws hit is the four-hit special");
  const swing = { getCombatType: () => CombatType.MELEE, isAccurate: () => true, getTotalDamage: () => 10 };
  randoms([0.05]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: swing });
  assert.equal(queued.length, 1, "the echo procs");
  const echo = queued[0];
  assert.equal(echo.getHits().length, 1, "one hitsplat, not the claws' four");
  assert.equal(echo.getTotalDamage(), Math.floor(ordinaryMax / 2), `half the ordinary max hit (${ordinaryMax})`);
  assert.equal(player.isSpecialActivated(), true, "the special stays armed for the next attack");
  assert.equal(player.getSpecialPercentage(), 100, "and no energy is spent on the echo");
});

test("a barrage's secondary target: Magic I, IV and VI use its own max hit, not the primary's", () => {
  const { CombatType, CombatSpells } = core;
  const player = character("barrage", { masteries: { melee: 0, ranged: 0, magic: 6 } });
  player.getCombat().setCastSpell(CombatSpells.ICE_BARRAGE);
  const primary = npc(HILL_GIANT);
  primary.setHitpoints(1000);
  const secondary = npc(HILL_GIANT);
  secondary.setHitpoints(200);
  player.getCombat().target = primary; // the cast's main target, which MagicCombatMethod.hits() keeps for every secondary hit
  forceAccurate = true;
  cycle(50);
  hooks.onCombatHitRoll(rollEvent(player, primary, CombatType.MAGIC)); // the cast's first roll notes it (Magic II)
  const primaryMax = core.DamageFormulas.sourceHitBounds(player, CombatType.MAGIC, primary).maximum;
  const secondaryMax = core.DamageFormulas.sourceHitBounds(player, CombatType.MAGIC, secondary).maximum;
  assert.ok(primaryMax > secondaryMax, `Magic VI gives the 1000-hitpoint primary more (${primaryMax}) than the 200-hitpoint secondary (${secondaryMax})`);
  const roll = Math.floor(secondaryMax * 0.9) + 1;
  assert.ok(roll <= Math.floor(primaryMax * 0.9), "a roll above 90% of the secondary's max but not the primary's");
  core.Misc.randomInclusive = (low, high) => Math.min(high, roll);
  const hit = new core.PendingHit(player, secondary, core.CombatFactory.MAGIC_COMBAT, { delay: 0 });
  assert.equal(hit.getTotalDamage(), Math.floor(roll * 1.5), "Magic I raises it");
  player.setHitpoints(50);
  hooks.onCombatHitResolved({ attacker: player, target: secondary, hit });
  assert.equal(player.getHitpoints(), 50 + Math.floor(Math.floor(hit.getTotalDamage() * 0.1) * 1.2), "Magic IV marked it, and the tier 2 passive adds its 20%");
  const execute = rollEvent(player, Object.assign(npc(HILL_GIANT), { getHitpoints: () => secondaryMax }), CombatType.MAGIC);
  hooks.onCombatHitRoll(execute);
  assert.equal(execute.forceMaxHit, false, "a target with exactly its own max hit in hitpoints is not executed");
});

test("Magic I and IV judge the undefended roll: a defender's damage reduction applies to the raised hit", () => {
  const { CombatType, CombatSpells } = core;
  const caster = character("caster", { masteries: { melee: 0, ranged: 0, magic: 4 } });
  caster.getCombat().setCastSpell(CombatSpells.FIRE_STRIKE);
  const defender = character("defender", { masteries: { melee: 4, ranged: 0, magic: 0 } });
  forceAccurate = true;
  core.Misc.randomInclusive = (low, high) => high;
  Math.random = () => 0.99; // no Elysian or other chance effects on the defender
  cycle(70);
  const hit = new core.PendingHit(caster, defender, core.CombatFactory.MAGIC_COMBAT, { delay: 0 });
  const max = core.DamageFormulas.sourceHitBounds(caster, CombatType.MAGIC, defender).maximum;
  assert.ok(Math.floor(max * 0.85) <= Math.floor(max * 0.9), "the reduced max roll would fail the 90% test");
  core.CombatFactory.applyHitTimeDefences(hit);
  assert.equal(hit.getTotalDamage(), Math.floor(Math.floor(max * 1.5) * 0.85), "Magic I's +50% first, then the defender's -15% at impact");
  caster.setHitpoints(50);
  hooks.onCombatHitResolved({ attacker: caster, target: defender, hit });
  assert.equal(caster.getHitpoints(), 50 + Math.floor(Math.floor(hit.getTotalDamage() * 0.1) * 1.2), "Magic IV heals 10% of the damage dealt");
});
