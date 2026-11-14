// Run after `yarn build`: node --test tests/echo-items-melee.test.cjs
// Leagues VI melee echo items: the Fang of the hound (Flames of Cerberus, Ferocity) and V's helm
// (zero-damage proc, free next special, imbued slayer helmet). Real Player, equipment, NPC and PendingHits.
const previousBotsSetting = process.env.DISABLE_PLAYER_BOTS;
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let Fang;
let Helm;
let Slayer;
let Demonbane;
let observed = null;
let weaknessAnswer = null;
const mainCharacters = new WeakSet();
let nextIndex = 6400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  new (require("../dist/game/definition/loader/impl/NpcDefinitionLoader").NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  const api = PluginManager.createApi("EchoItemsMeleeTest");
  require("../plugins/combat/specials/FangOfTheHound.SpecialAttack")(api);
  Fang = require("../plugins/items/FangOfTheHound.plugin");
  Fang.register(api);
  Helm = require("../plugins/items/VsHelm.plugin");
  Helm.register(api);
  Slayer = require("../plugins/items/SlayerHelmet.plugin");
  Slayer.register(api);
  Demonbane = require("../plugins/combat/effects/Demonbane.EquipmentEffects");
  api.onCombatHitDamage((event) => {
    if (observed && event.attacker === observed.player) observed.splats.push(event);
  });
  require("../plugins/combat/elementalspells/Common.ElementalSpells").init(api);
  api.onCustomEvent("elemental-spells:weakness", (event) => weaknessAnswer?.(event));
  // A Leagues VI character unless the test names it a main one (LeagueMode's answer).
  api.onCustomEvent("league:profile", (query) => { if (query.league == null) query.league = mainCharacters.has(query.player) ? null : 6; });
  api.onCustomEvent("combat:hit-rolled", (event) => {
    if (observed && event.attacker === observed.player) observed.ranges.push({ type: event.combatType, minimum: event.minimum, maximum: event.maximum });
  });
});

after(() => {
  if (previousBotsSetting === undefined) delete process.env.DISABLE_PLAYER_BOTS;
  else process.env.DISABLE_PLAYER_BOTS = previousBotsSetting;
});

function actors(t, { weapon, head, npcId } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  let npc = null;
  const submitted = [];
  const originalSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function (task) {
    submitted.push(task);
    return originalSubmit.call(this, task);
  };
  t.after(() => {
    observed = null;
    core.TaskManager.submit = originalSubmit;
    for (const task of submitted) task.stop();
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
    if (npc) { npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); }
  });
  player.setIndex(nextIndex++);
  player.setUsername("Echo" + player.getIndex());
  player.setRights(core.PlayerRights.NONE);
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.setNeedsPlacement(false);
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.MAGIC]) {
    player.getSkillManager().setMaxLevel(skill, 99);
    player.getSkillManager().setCurrentLevel(skill, 99);
  }
  player.setHitpoints(99);
  const { Equipment: E } = core;
  if (weapon) player.getEquipment().setItem(E.WEAPON_SLOT, new core.Item(weapon, 1));
  if (head) player.getEquipment().setItem(E.HEAD_SLOT, new core.Item(head, 1));
  const style = core.WeaponInterfaces.SWORD;
  player.setWeapon(style);
  player.setFightType(style.getFightType()[0]);
  core.BonusManager.update(player);
  core.CombatSpecial.assign(player);
  npc = PluginManager.spawnNpc({ id: npcId ?? core.NpcIdentifiers.GOBLIN, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc && npc.isRegistered());
  npc.setNeedsPlacement(false);
  npc.getHitpoints = () => 1000;
  npc.queued = [];
  const queue = npc.getCombat().getHitQueue();
  const originalAdd = queue.addPendingHit.bind(queue);
  queue.addPendingHit = (hit) => { npc.queued.push(hit); return originalAdd(hit); };
  return { player, npc };
}

/** Attacks once with accuracy answered from `accuracy` and the named plugin's Math.random from `procs`. */
function attack(player, npc, accuracy, procs = [], procFile = "FangOfTheHound.plugin.js") {
  const owner = core.AccuracyFormulasDpsCalc;
  const originalAccuracy = owner.rollAccuracy;
  const originalRandom = Math.random;
  const rolls = [...accuracy];
  const proc = [...procs];
  observed = { player, splats: [], ranges: [] };
  owner.rollAccuracy = function (attacker, target, ...rest) {
    if (attacker === player && target === npc) return rolls.length ? rolls.shift() : false;
    return originalAccuracy.call(this, attacker, target, ...rest);
  };
  Math.random = function () {
    const caller = new Error().stack?.split("\n")[2] ?? "";
    if (caller.includes(procFile)) return proc.length ? proc.shift() : 0.99;
    return originalRandom();
  };
  try {
    const method = core.CombatFactory.getMethod(player);
    const launched = player.getCombat().executeAttack(method, npc, false, 0, false);
    return { launched, method, splats: observed.splats, ranges: observed.ranges, remaining: rolls };
  } finally {
    owner.rollAccuracy = originalAccuracy;
    Math.random = originalRandom;
    observed = null;
  }
}

/** A Strength level whose max hit with the wielded weapon is odd (and above 1). */
function oddMaxHit(player) {
  for (let level = 60; level <= 99; level++) {
    player.getSkillManager().setCurrentLevel(core.Skill.STRENGTH, level);
    const max = core.DamageFormulas.calculateMaxMeleeHit(player);
    if (max > 1 && max % 2 === 1) return max;
  }
  assert.fail("no odd max hit");
}

// ------------------------------------------------------------------ Fang of the hound

const flamesOf = (npc) => npc.queued.filter((hit) => hit.getCombatType() === core.CombatType.MAGIC);

test("fang: a landed hit casts Flames of Cerberus 5% of the time, as an accurate fire hit of base max 10", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  const miss = attack(player, npc, [true], [0.05]);
  assert.equal(miss.launched, true);
  assert.equal(flamesOf(npc).length, 0, "no cast at the 5% roll's edge");
  player.getCombat().setAttackDelay(0);
  player.getCombat().nextAttackCycle = 0;
  const cast = attack(player, npc, [true], [0.0499]);
  assert.equal(cast.launched, true);
  const flames = flamesOf(npc);
  assert.equal(flames.length, 1);
  assert.equal(flames[0].getSpell(), Fang._test.spell());
  assert.equal(flames[0].isAccurate(), true, "no second accuracy check");
  const magicRange = cast.ranges.find((range) => range.type === core.CombatType.MAGIC);
  assert.equal(magicRange.maximum, 10);
});

test("fang: swings with the cache's karambit attack; Ferocity with the karambit special", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  const seq = (name) => core.CacheDefinitions.getSeqId(name);
  assert.equal(attack(player, npc, [false]).launched, true);
  assert.equal(player.getAnimation()?.getId(), seq("human_karambit_attack"));
  assert.equal(player.getAttackSound(), null, "the swing's sound is the animation's own");
  player.getCombat().setAttackDelay(0);
  player.getCombat().nextAttackCycle = 0;
  player.setSpecialPercentage(100);
  player.setSpecialActivated(true);
  player.animation = null;
  assert.equal(attack(player, npc, [false]).launched, true);
  assert.equal(player.getAnimation()?.getId(), seq("human_karambit_spec"));
});

test("fang: a missed hit casts nothing", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  attack(player, npc, [false], [0]);
  assert.equal(flamesOf(npc).length, 0);
});

test("Flames of Cerberus: magic strength and a fire weakness raise its max hit", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  const spell = Fang._test.spell();
  assert.equal(core.DamageFormulas.getMagicMaxhit(player, spell, npc), 10);
  player.getBonusManager().getOtherBonus()[core.BonusManager.MAGIC_STRENGTH] = 20;
  assert.equal(core.DamageFormulas.getMagicMaxhit(player, spell, npc), 12, "+20% magic damage");
  const weakTo = (type, percent) => ({ isNpc: () => true, getAsNpc() { return this; },
    getCurrentDefinition: () => ({ getElementalWeakness: () => ({ type, percent }) }) });
  const request = (target) => ({ attacker: player, target, spell, baseMaxHit: 10, maxHit: 12 });
  const fire = request(weakTo(4, 50));
  Fang._test.weakness(fire);
  assert.equal(fire.maxHit, 17, "+50% of the base 10");
  const water = request(weakTo(2, 50));
  Fang._test.weakness(water);
  assert.equal(water.maxHit, 12, "only a fire weakness");
  const other = { ...request(weakTo(4, 50)), spell: core.CombatSpells.WIND_STRIKE };
  Fang._test.weakness(other);
  assert.equal(other.maxHit, 12, "only the Flames");
  // An effect that counts the cast as the target's weakness (`elemental-spells:weakness`) counts.
  weaknessAnswer = (event) => { if (event.element === 4) event.weakness.type = 4; };
  try {
    const geared = request(weakTo(2, 50));
    Fang._test.weakness(geared);
    assert.equal(geared.maxHit, 17, "the weakness as the shared lookup gives it");
    // A weakness added to every element (the Devil's element's +30%) counts as fire too.
    weaknessAnswer = (event) => { event.added = 30; };
    const added = request(weakTo(2, 50));
    Fang._test.weakness(added);
    assert.equal(added.maxHit, 15, "+30% of the base 10");
  } finally {
    weaknessAnswer = null;
  }
});

test("Ferocity: 50% energy, an instant hit that always casts the Flames when it lands; one a tick", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  player.setSpecialPercentage(100);
  player.setSpecialActivated(true);
  const special = player.getCombatSpecial();
  assert.equal(special?.getId(), "fang_of_the_hound");
  assert.equal(special.getTraits().bypassAttackDelay, true);
  const result = attack(player, npc, [true], [0.99]);
  assert.equal(result.launched, true);
  assert.equal(player.getSpecialPercentage(), 50);
  assert.equal(flamesOf(npc).length, 1, "guaranteed on a landed special");
  assert.equal(special.getCombatMethod().canAttack(player, npc), false, "no second Ferocity this tick");
  core.World.processCycle = (core.World.getProcessCycle() ?? 0) + 1;
  assert.equal(special.getCombatMethod().canAttack(player, npc), true);
});

test("Ferocity: a missed special casts nothing", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  player.setSpecialPercentage(100);
  player.setSpecialActivated(true);
  attack(player, npc, [false], [0]);
  assert.equal(flamesOf(npc).length, 0);
});

// ------------------------------------------------------------------ V's helm

function incoming(player, damage) {
  const splats = damage.map((value) => new core.HitDamage(value, value > 0 ? core.HitMask.RED : core.HitMask.BLUE));
  return {
    splats,
    getHits: () => splats,
    getTotalDamage: () => splats.reduce((sum, each) => sum + each.getDamage(), 0),
    updateTotalDamage() {},
  };
}

function proc(player, hit, roll) {
  const originalRandom = Math.random;
  Math.random = () => roll;
  try {
    Helm._test.hitModify({ player, hit });
  } finally {
    Math.random = originalRandom;
  }
}

test("V's helm: 5% of hits of 1+ deal 0, with its message", (t) => {
  const { player } = actors(t, { head: core.ItemIdentifiers.VS_HELM });
  const kept = incoming(player, [12]);
  proc(player, kept, 0.05);
  assert.equal(kept.getTotalDamage(), 12);
  assert.deepEqual(player.messages, []);
  const zero = incoming(player, [0]);
  proc(player, zero, 0);
  assert.deepEqual(player.messages, [], "a 0 is no proc");
  const hit = incoming(player, [12, 5]);
  proc(player, hit, 0.0499);
  assert.equal(hit.getTotalDamage(), 0);
  assert.deepEqual(player.messages, ["V's helmet fills you with energy."]);
  const bare = actors(t, {}).player;
  const notWorn = incoming(bare, [12]);
  proc(bare, notWorn, 0);
  assert.equal(notWorn.getTotalDamage(), 12, "only while worn");
});

test("V's helm: the next special within 60 seconds is free; it does not stack", (t) => {
  const { player } = actors(t, { head: core.ItemIdentifiers.VS_HELM, weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND });
  core.World.processCycle = 1000;
  player.setSpecialPercentage(20);
  proc(player, incoming(player, [10]), 0);
  const until = player.getAttribute(Helm._test.FREE_SPECIAL_ATTRIBUTE);
  assert.equal(until, 1000 + Helm._test.FREE_SPECIAL_TICKS);
  core.World.processCycle = 1050;
  proc(player, incoming(player, [10]), 0);
  assert.equal(player.getAttribute(Helm._test.FREE_SPECIAL_ATTRIBUTE), until, "a second proc keeps the stored one and its time");
  assert.equal(core.CombatSpecial.affordable(player, player.getCombatSpecial(), 50), true, "free even short of energy");
  core.CombatSpecial.drain(player, 50);
  assert.equal(player.getSpecialPercentage(), 20, "the stored special cost nothing");
  assert.equal(Helm._test.freeSpecialStored(player), false, "used up");
  assert.equal(core.CombatSpecial.affordable(player, player.getCombatSpecial(), 50), false);
  player.setSpecialPercentage(100);
  core.CombatSpecial.drain(player, 50);
  assert.equal(player.getSpecialPercentage(), 50, "the next one costs its energy");
});

test("V's helm: the stored special lapses after 60 seconds", (t) => {
  const { player } = actors(t, { head: core.ItemIdentifiers.VS_HELM });
  core.World.processCycle = 2000;
  proc(player, incoming(player, [10]), 0);
  core.World.processCycle = 2099;
  assert.equal(Helm._test.freeSpecialStored(player), true);
  core.World.processCycle = 2100;
  assert.equal(Helm._test.freeSpecialStored(player), false);
  const request = { player, cost: 50, phase: "check" };
  Helm._test.specialCost(request);
  assert.equal(request.cost, 50);
});

test("V's helm counts as a Slayer helmet (i)", (t) => {
  const { player } = actors(t, { head: core.ItemIdentifiers.VS_HELM });
  assert.equal(Slayer._test.slayerHeadwear(player), "all");
  const bare = actors(t, {}).player;
  assert.equal(Slayer._test.slayerHeadwear(bare), null);
});

// ------------------------------------------------------------------ Leagues VI only

test("outside Leagues VI: no Flames (not even from Ferocity), no Slayer helmet", (t) => {
  const { player, npc } = actors(t, { weapon: core.ItemIdentifiers.FANG_OF_THE_HOUND, head: core.ItemIdentifiers.VS_HELM });
  mainCharacters.add(player);
  attack(player, npc, [true], [0]);
  assert.equal(flamesOf(npc).length, 0, "no Flames of Cerberus");
  core.World.processCycle = (core.World.getProcessCycle() ?? 0) + 1;
  player.setSpecialPercentage(100);
  player.setSpecialActivated(true);
  const special = attack(player, npc, [true], [0.99]);
  assert.equal(special.launched, true, "Ferocity still swings");
  assert.equal(flamesOf(npc).length, 0, "without the Flames");
  const request = { player, worn: null };
  Helm._test.slayerHelmet(request);
  assert.equal(request.worn, null, "not a Slayer helmet");
});
