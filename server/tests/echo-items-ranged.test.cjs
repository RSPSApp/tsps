// Run after `yarn build`: node --test tests/echo-items-ranged.test.cjs
// Demonic Pacts' ranged echo items (Wiki, Demonic_Pacts_League/Echo_bosses_and_echo_equipment):
// Nature's recurve, King's barrage and the Drygore blowpipe, alone and with the ranged pacts.
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
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const EquipmentEffects = require("../dist/game/content/combat/EquipmentEffects");

let core;
let Common;
let Ranged;
let Recurve;
let Barrage;
let Drygore;
let Blowpipe;
const hooks = {};
const custom = {};
/** Every custom event emitted, in order: [name, payload]. */
const emitted = [];
const resolvers = [];
const realRandom = Math.random;
const restore = [];

const HILL_GIANT = 2098;
const RUNE_ARROW = 892;
const DRAGON_ARROW = 11212;
const DRAGON_BOLTS = 21905;
const RUBY_DRAGON_BOLTS_E = 21944;
const RUNE_BOLTS = 9144;
const DRAGON_DART = 11230;
const DRAGON_DART_P = 11231;
const RECURVE = 33245;

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
    onItemAction() {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      emitted.push([name, payload]);
      for (const handler of custom[name] ?? []) handler(payload);
    },
    registerCombatEffectiveLevelModifier: (modifier) => EquipmentEffects.registerCombatEffectiveLevelModifier(modifier),
    registerRangedHitModifier: (modifier) => EquipmentEffects.registerRangedHitModifier(modifier),
    registerMeleeHitModifier: (modifier) => EquipmentEffects.registerMeleeHitModifier(modifier),
    registerMagicHitModifier: (modifier) => EquipmentEffects.registerMagicHitModifier(modifier),
    registerMeleeAttackAccuracyModifier: (modifier) => EquipmentEffects.registerMeleeAttackAccuracyModifier(modifier),
    registerRangedAttackAccuracyModifier: (modifier) => EquipmentEffects.registerRangedAttackAccuracyModifier(modifier),
    registerMagicAttackAccuracyModifier: (modifier) => EquipmentEffects.registerMagicAttackAccuracyModifier(modifier),
    registerBonusProvider: (provider) => PluginManager.registerBonusProviderInternal("test", provider),
    // The core's own registries, so real rolls, ammunition and weapon profiles see the items' plugins.
    registerRangedCombatModifier: (modifier) => PluginManager.registerRangedCombatModifierInternal("test", modifier),
    registerRangedAmmoResolver: (resolver) => PluginManager.registerRangedAmmoResolverInternal("test", resolver),
    registerRangedAmmoHandler: (handler) => PluginManager.registerRangedAmmoHandlerInternal("test", handler),
    registerWeaponProfile: (profile) => core.WeaponProfiles.register(profile),
    registerCombatMethodResolver: (resolver) => resolvers.push(resolver),
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  require("../plugins/modes/Tasks.LeagueMode").register(api);
  require("../plugins/modes/Pacts.LeagueMode").register(api);
  require("../plugins/combat/EnchantedBolts.plugin").register(api);
  Blowpipe = require("../plugins/items/ToxicBlowpipe.plugin");
  Blowpipe.register(api);
  Recurve = require("../plugins/items/NaturesRecurve.plugin");
  Recurve.register(api);
  Barrage = require("../plugins/items/KingsBarrage.plugin");
  Barrage.register(api);
  Drygore = require("../plugins/items/DrygoreBlowpipe.plugin");
  Drygore.register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
  Ranged = require("../plugins/modes/leaguepacts/Ranged.LeaguePacts");
  const realCustom = PluginManager.emitCustomEvent;
  PluginManager.emitCustomEvent = (name, payload) => {
    emitted.push([name, payload]);
    for (const handler of custom[name] ?? []) handler(payload);
    return realCustom.call(PluginManager, name, payload);
  };
  const realRoll = PluginManager.emitCombatHitRoll;
  PluginManager.emitCombatHitRoll = (event) => {
    hooks.onCombatHitRoll?.(event);
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
  emitted.length = 0;
});

function stub(object, key, value) {
  const original = object[key];
  object[key] = value;
  restore.push(() => (object[key] = original));
}

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
  const sent = { graphics: [], messages: [] };
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = (message) => sent.messages.push(message);
  player.getDialogueManager = () => ({ startDialogues() {} });
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  const perform = player.performGraphic.bind(player);
  player.performGraphic = (graphic) => (sent.graphics.push(graphic.id), perform(graphic));
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  player.getInventory().resetItems();
  sent.messages.length = 0; // the league's login tasks
  return Object.assign(player, { sent });
}

function nodesOf(varbit) {
  return Common.nodes.filter((node) => node.varbit === varbit).map((node) => node.index);
}

function withPacts(name, varbits, profile = "league") {
  const player = character(name, profile);
  Common.save(player, varbits.flatMap((varbit) => nodesOf(varbit)));
  return player;
}

function wield(player, itemId, weaponInterface, fightType, ammo = null) {
  const definition = core.ItemDefinition.forId(itemId);
  if (!definition.getWeaponInterface()) definition.weaponInterface = core.WeaponInterfaces[weaponInterface];
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(itemId));
  player.getEquipment().setItem(core.Equipment.AMMUNITION_SLOT, ammo ? new core.Item(ammo, 100) : new core.Item(-1));
  player.setWeapon(core.WeaponInterfaces[weaponInterface]);
  player.setFightType(core.FightType[fightType]);
  core.BonusManager.update(player);
  player.getCombat().setRangedWeapon(core.RangedWeapon.getFor(player));
  player.getCombat().setAmmunition(core.Ammunition.getFor(player));
}

function npc(hitpoints = 1000) {
  const target = new NPC(HILL_GIANT, new Location(3200, 3203, 0));
  target.setHitpoints(hitpoints);
  const queued = [];
  target.getCombat().getHitQueue().addPendingHit = (hit) => queued.push(hit);
  return Object.assign(target, { queued });
}

const RANGED = () => core.CombatType.RANGED;
/**
 * A resolved ranged hit fired from `weapon` (its fired-shot snapshot; null: unknown), one real
 * hitsplat of `getTotalDamage`'s damage that `land` applies.
 */
function fakeHit(overrides = {}, weapon = null) {
  const damage = (overrides.getTotalDamage ?? (() => 25))();
  const splats = damage > 0 ? [new HitDamage(damage, HitMask.RED)] : [];
  return {
    getCombatType: () => RANGED(), isAccurate: () => true, getTotalDamage: () => damage, getHits: () => splats,
    getFiredRangedShot: () => (weapon ? { weapon: new core.Item(weapon), ammo: null } : null),
    ...overrides,
  };
}
/** Resolves the hit, then applies each hitsplat as the hit queue does: `taken` health lost (default its damage). */
function land(player, target, hit, taken = null) {
  hooks.onCombatHitResolved({ attacker: player, target, hit });
  for (const splat of hit.getHits?.() ?? []) splat.notifyApplied(taken ?? splat.getDamage());
}
const methodFor = (player) => resolvers.map((resolver) => resolver.resolve(player)).find(Boolean) ?? null;
const canFire = (player) => core.CombatFactory.checkAmmo(player, 1, true);

// ------------------------------------------------------------------ ammunition

test("Nature's recurve fires arrows up to dragon, not bolts", () => {
  const player = character("recurve-ammo");
  for (const arrow of [RUNE_ARROW, DRAGON_ARROW]) {
    wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", arrow);
    assert.equal(player.getCombat().getRangedWeapon(), core.RangedWeapon.NATURES_RECURVE);
    assert.equal(canFire(player), true, `arrow ${arrow}`);
  }
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", DRAGON_BOLTS);
  assert.equal(canFire(player), false);
  assert.equal(player.sent.messages.at(-1), "You can't use that ammo with your bow.", "the core's line for a bow");
  assert.equal(core.CacheDefinitions.getItem(core.ItemIdentifiers.NATURES_RECURVE).name, "Nature's recurve");
});

test("King's barrage fires bolts up to dragon, enchanted ones too, not arrows", () => {
  const player = character("barrage-ammo");
  for (const bolt of [RUNE_BOLTS, DRAGON_BOLTS, RUBY_DRAGON_BOLTS_E]) {
    wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", bolt);
    assert.equal(canFire(player), true, `bolt ${bolt}`);
  }
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", RUNE_ARROW);
  assert.equal(canFire(player), false);
  assert.ok(methodFor(player), "the barrage has its own combat method");
});

/** A Drygore blowpipe (empty) and the darts in the inventory; uses the darts on it. */
function loadDrygore(player, dartId, amount = 100) {
  const inventory = player.getInventory();
  inventory.resetItems();
  inventory.setItem(0, new core.Item(core.ItemIdentifiers.DRYGORE_BLOWPIPE_EMPTY_));
  inventory.setItem(1, new core.Item(dartId, amount));
  const [pipe, darts] = [inventory.getItems()[0], inventory.getItems()[1]];
  const event = { player, usedItemId: dartId, usedWithItemId: pipe.getId(), usedItemSlot: 1, usedWithItemSlot: 0, usedItem: darts, usedWithItem: pipe };
  hooks.onItemOnItem(event);
  return { pipe, event };
}

test("the Drygore blowpipe loads darts (no scales) and fires them, never poisoned ones", () => {
  const player = character("drygore-ammo");
  const { pipe } = loadDrygore(player, DRAGON_DART);
  assert.equal(pipe.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE, "loaded, it is the charged pipe");
  assert.deepEqual(Blowpipe._test.BlowpipeState.read(pipe), { scales: 0, dartId: DRAGON_DART, dartAmount: 100 });
  player.getInventory().setItem(0, new core.Item(-1));
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  player.setWeapon(core.WeaponInterfaces.BLOWPIPE);
  player.setFightType(core.FightType.BLOWPIPE_RAPID);
  player.getCombat().setRangedWeapon(core.RangedWeapon.getFor(player));
  assert.equal(player.getCombat().getRangedWeapon(), core.RangedWeapon.DRYGORE_BLOWPIPE);
  assert.equal(core.Ammunition.getFor(player), core.Ammunition.DRAGON_DART);
  const method = methodFor(player);
  assert.ok(method, "the blowpipe's own combat method");
  const target = npc();
  assert.equal(method.canAttack(player, target), true, "darts alone are enough");
  assert.equal(method.attackSpeed(player), 2, "2 ticks on Rapid");
  core.BonusManager.update(player);
  assert.equal(player.getBonusManager().getAttackBonus()[core.BonusManager.ATTACK_RANGE], 50);
  assert.equal(player.getBonusManager().getOtherBonus()[core.BonusManager.RANGED_STRENGTH], 10 + 35, "+10 and the dragon dart's 35");
  assert.equal(core.WeaponProfiles.attackAnimation(player, -1), core.CacheDefinitions.getSeqId("drygore_blowpipe_attack"));

  const poisoned = character("drygore-poison");
  const { pipe: empty, event } = loadDrygore(poisoned, DRAGON_DART_P);
  assert.equal(event.handled, true);
  assert.equal(empty.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE_EMPTY_);
  assert.deepEqual(poisoned.sent.messages, ["You can't use that kind of dart."]);
});

/** A player wielding a Drygore blowpipe holding `amount` dragon darts. */
function drygoreWielder(player, amount) {
  const { pipe } = loadDrygore(player, DRAGON_DART, amount);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  player.setWeapon(core.WeaponInterfaces.BLOWPIPE);
  player.getCombat().setRangedWeapon(core.RangedWeapon.DRYGORE_BLOWPIPE);
  return pipe;
}

test("a Drygore blowpipe's dart can be Regenerated, and runs out into the empty pipe", () => {
  const pacts = withPacts("drygore-regen", ["talent_regen_ammo_chance"]);
  const saved = drygoreWielder(pacts, 1);
  randoms([0]);
  assert.equal(PluginManager.decrementRangedAmmo(pacts, null, 1), true);
  assert.equal(Blowpipe._test.BlowpipeState.read(saved).dartAmount >= 1, true, "the pact saved it");
  assert.ok(emitted.some(([name, payload]) => name === "league:pact-regenerated" && payload.kind === "ammo"));

  const main = character("drygore-empty", "main");
  const pipe = drygoreWielder(main, 1);
  stub(core.Misc, "getRandom", () => 99); // no Ava's device recovers it
  PluginManager.decrementRangedAmmo(main, null, 1);
  assert.equal(pipe.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE_EMPTY_);
  assert.equal(main.sent.messages.at(-1), "Your Drygore blowpipe has run out of darts!");
});

// ------------------------------------------------------------------ Nature's recurve

test("Nature's recurve: half its landed hits restore 10% of the damage (rounded up) to Hitpoints and Prayer, up to 99", () => {
  const player = character("recurve-heal");
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  const skills = player.getSkillManager();
  skills.setCurrentLevel(Skill.HITPOINTS, 50, false);
  skills.setCurrentLevel(Skill.PRAYER, 40, false);
  const target = npc();
  randoms([0.6]);
  land(player, target, fakeHit({}, RECURVE));
  assert.deepEqual([skills.getCurrentLevel(Skill.HITPOINTS), skills.getCurrentLevel(Skill.PRAYER)], [50, 40], "a 60 misses the 50%");
  randoms([0.4]);
  land(player, target, fakeHit({}, RECURVE));
  assert.deepEqual([skills.getCurrentLevel(Skill.HITPOINTS), skills.getCurrentLevel(Skill.PRAYER)], [53, 43], "25 damage: 2.5, rounded up");
  assert.equal(player.sent.graphics.at(-1), core.CacheDefinitions.getSpotanimId("vfx_natures_recurve_spotanim_01"));
  randoms([0]);
  land(player, target, fakeHit({ isAccurate: () => false, getTotalDamage: () => 0 }, RECURVE));
  land(player, target, fakeHit({ getCombatType: () => core.CombatType.MAGIC }, RECURVE));
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 53, "a miss or another style restores nothing");
  skills.setCurrentLevel(Skill.HITPOINTS, 98, false);
  randoms([0]);
  land(player, target, fakeHit({ getTotalDamage: () => 60 }, RECURVE));
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 99, "not above 99");
  skills.setCurrentLevel(Skill.HITPOINTS, 110, false);
  randoms([0]);
  land(player, target, fakeHit({}, RECURVE));
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 110, "an overheal is not lowered nor raised");
  skills.setCurrentLevel(Skill.HITPOINTS, 50, false);
  randoms([0]);
  land(player, target, fakeHit({}, core.ItemIdentifiers.KINGS_BARRAGE));
  land(player, target, fakeHit({}, null));
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 50, "the recurve's passive only, an unknown weapon none");
});

test("Nature's recurve: the weapon that fired the shot decides, whatever is worn when it lands", () => {
  const player = character("recurve-swap");
  const skills = player.getSkillManager();
  const target = npc();
  // Fired from a magic shortbow, the recurve equipped before impact: no restore.
  wield(player, core.ItemIdentifiers.MAGIC_SHORTBOW, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  const fromShortbow = fakeHit({ getTotalDamage: () => 20 }, core.ItemIdentifiers.MAGIC_SHORTBOW);
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  skills.setCurrentLevel(Skill.HITPOINTS, 50, false);
  randoms([0]);
  land(player, target, fromShortbow);
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 50);
  // Fired from the recurve, the shortbow equipped before impact: it restores.
  const fromRecurve = fakeHit({ getTotalDamage: () => 20 }, RECURVE);
  wield(player, core.ItemIdentifiers.MAGIC_SHORTBOW, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  randoms([0]);
  land(player, target, fromRecurve);
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 52);
});

test("Nature's recurve: the restore is from the health the hit took, once it lands", () => {
  const player = character("recurve-applied");
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  const skills = player.getSkillManager();
  skills.setCurrentLevel(Skill.HITPOINTS, 50, false);
  const target = npc();
  const hit = fakeHit({ getTotalDamage: () => 20 }, RECURVE);
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target, hit });
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 50, "nothing before it lands");
  hit.getHits()[0].notifyApplied(1); // the target had 1 hitpoint left
  assert.equal(skills.getCurrentLevel(Skill.HITPOINTS), 51, "ceil(1 / 10), not ceil(20 / 10)");
});

test("Nature's recurve: a Demonic Pacts ranged echo does not restore", () => {
  const player = withPacts("recurve-echo", ["talent_bow_echo_pass_accuracy"]);
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  const target = npc();
  custom["league:pact-ranged-echo"].forEach((handler) => handler({ player, target, source: "ranged" }));
  const echo = target.queued[0];
  assert.ok(Ranged.isEcho(echo) && echo.isAccurate() && echo.getTotalDamage() > 0, "a landed echo");
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 50, false);
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: echo });
  assert.equal(player.getSkillManager().getCurrentLevel(Skill.HITPOINTS), 50);
});

// ------------------------------------------------------------------ King's barrage

/** Every roll lands on its max (the hooks' forceAccurate / forceMaxHit). */
function maxRolls() {
  stub(PluginManager, "emitCombatHitRoll", (event) => {
    event.forceAccurate = true;
    event.forceMaxHit = true;
  });
}

test("King's barrage: two hits an attack, each with half the max hit; the second is the ice bolt", () => {
  const player = character("barrage-hits");
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  const max = PluginManager.modifyRangedMaxHit(player, null, core.DamageFormulas.calculateMaxRangedHit(player));
  assert.ok(max >= 10, `a max hit to halve (${max})`);
  maxRolls();
  const target = npc();
  const hits = methodFor(player).hits(player, target);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((hit) => hit.getTotalDamage()), [Math.floor(max / 2), Math.floor(max / 2)]);
  assert.deepEqual(hits.map((hit) => Barrage._test.isIceHit(hit)), [false, true]);
  assert.equal(hits[0].getDelay(), hits[1].getDelay(), "both bolts fly together");
  assert.equal(PluginManager.modifyRangedMaxHit(player, null, max), max, "outside the barrage's own attack, no halving");
});

/** Every projectile the next shots send: [id, delay, end, startHeight, endHeight, angle, progress]. */
function recordProjectiles() {
  const sent = [];
  stub(core.Projectile, "createProjectile", (source, target, id, delay, end, startHeight, endHeight) => {
    const shot = [id, delay, end, startHeight, endHeight, null, null];
    sent.push(shot);
    const fake = { withAngle: (angle) => ((shot[5] = angle), fake), withProgress: (progress) => ((shot[6] = progress), fake), sendProjectile() {} };
    return fake;
  });
  return sent;
}

test("King's barrage: the ballista's swing and one barrage projectile that lands with both bolts", () => {
  const seq = (name) => core.CacheDefinitions.getSeqId(name);
  const spotanim = (name) => core.CacheDefinitions.getSpotanimId(name);
  for (const profile of ["league", "main"]) {
    const player = character(`barrage-shot-${profile}`, profile);
    wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
    assert.equal(core.WeaponProfiles.attackAnimation(player, -1, false), seq("ballista_attack"));
    assert.equal(core.WeaponProfiles.attackAnimation(player, -1, true), seq("ballista_attack_pvn"));
    const sent = recordProjectiles();
    const method = methodFor(player) ?? new core.RangedCombatMethod();
    stub(core.Sounds, "playAreaSound", () => {});
    for (const [distance, end] of [[1, 45], [2, 45], [3, 75], [6, 75], [8, 75]]) {
      const target = npc();
      target.setLocation(new Location(3200, 3200 + distance, 0));
      sent.length = 0;
      method.start(player, target);
      assert.deepEqual(sent, [[spotanim("vfx_kings_barrage_projectile"), 41, end, 36.25, 31, 5, 70]], `${profile}, ${distance} tiles`);
    }
  }
});

test("King's barrage: on a Leagues VI character the ice burst shows on the target as the shot lands", () => {
  const player = character("barrage-impact");
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  recordProjectiles();
  const sounds = [];
  stub(core.Sounds, "playAreaSound", (options) => sounds.push(options));
  const target = npc();
  const slots = [];
  target.performGraphicInSlot = (slot, graphic) => slots.push([slot, graphic.id, graphic.delay]);
  methodFor(player).start(player, target);
  const spotanim = (name) => core.CacheDefinitions.getSpotanimId(name);
  assert.deepEqual(slots, [[1, spotanim("vfx_kings_barrage_impact"), 75], [5, spotanim("ice_burst_impact"), 85]]);
  assert.deepEqual(sounds.map(({ soundId, x, y, delay, radius }) => [soundId, x, y, delay, radius]), [[170, 3200, 3203, 75, 10]]);
});

test("King's barrage: the ice bolt freezes for 24 ticks, hit or miss, until Toggle-Freeze turns it off", () => {
  const player = character("barrage-freeze");
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  const method = methodFor(player);
  const target = npc();
  const [bolt, ice] = method.hits(player, target);
  method.handleAfterHitEffects(bolt);
  assert.equal(target.getTimers().has(core.TimerKey.FREEZE), false, "the crossbow bolt does not freeze");
  method.handleAfterHitEffects(ice);
  assert.equal(target.getTimers().timers().get(core.TimerKey.FREEZE).ticks(), 24);
  assert.equal(target.sent?.graphics, undefined);

  Barrage._test.toggleFreeze({ player });
  assert.equal(player.getAttribute(Barrage._test.FREEZE_DISABLED_ATTRIBUTE), true);
  assert.equal(player.sent.messages.at(-1), "The King's barrage will now no longer freeze your target in place on hit.");
  const other = npc();
  method.handleAfterHitEffects(method.hits(player, other)[1]);
  assert.equal(other.getTimers().has(core.TimerKey.FREEZE), false, "toggled off");
  Barrage._test.toggleFreeze({ player });
  assert.equal(player.sent.messages.at(-1), "The King's barrage will now freeze your targets.");
  method.handleAfterHitEffects(method.hits(player, other)[1]);
  assert.equal(other.getTimers().has(core.TimerKey.FREEZE), true);
});

test("King's barrage: the bolt's XP is Ranged, the ice bolt's Magic; the ice bolt spends and regenerates no rune", () => {
  const player = withPacts("barrage-xp", ["talent_regen_ammo_chance"]);
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  maxRolls();
  const [bolt, ice] = methodFor(player).hits(player, npc());
  const skills = player.getSkillManager();
  const xp = () => [skills.getExperience(Skill.RANGED), skills.getExperience(Skill.MAGIC)];
  const [ranged, magic] = xp();
  core.CombatFactory.rewardExp(player, bolt);
  assert.ok(xp()[0] > ranged && xp()[1] === magic, "the bolt: Ranged");
  const afterBolt = xp();
  core.CombatFactory.rewardExp(player, ice);
  assert.equal(xp()[0], afterBolt[0], "the ice bolt: no Ranged");
  assert.equal(xp()[1] - afterBolt[1], xp()[1] - magic, "the ice bolt: Magic");
  assert.equal(xp()[1] - magic, afterBolt[0] - ranged, "at the bolt's rate");
  assert.ok(!emitted.some(([name, payload]) => name === "league:pact-regenerated" && payload.kind === "rune"), "no rune regenerated");
  assert.ok(!emitted.some(([name]) => name.startsWith("magic:")), "no spell cost asked");
});

test("King's barrage: no enchanted bolt effect from the ice bolt; the crossbow echo pact rolls once an attack", () => {
  const player = withPacts("barrage-echo", ["talent_crossbow_echo_reproc_chance"]);
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", RUBY_DRAGON_BOLTS_E);
  maxRolls();
  const target = npc();
  methodFor(player).hits(player, target);
  const procs = emitted.filter(([name]) => name === "combat:bolt-proc-chance").map(([, proc]) => proc.chance);
  assert.equal(procs.length, 2, "both bolts ask");
  assert.ok(procs[0] > 0 && procs[1] === 0, "the ice bolt's chance is 0");

  const [bolt, ice] = methodFor(player).hits(player, target);
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: ice });
  assert.equal(target.queued.length, 0, "the ice bolt is the same attack");
  randoms([0.01]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: bolt });
  assert.equal(target.queued.length, 1);
  assert.ok(Ranged.isEcho(target.queued[0]));
});

test("King's barrage: with the ice-as-water pact the ice bolt takes the water weakness, the water pacts' damage and heal", () => {
  const pacts = withPacts("barrage-water", ["talent_ice_counts_as_water", "talent_water_spell_damage_high_hp", "talent_water_spell_bouce_heal"]);
  const main = withPacts("barrage-water-main", ["talent_water_spell_damage_high_hp"]);
  const target = npc();
  stub(target.getCurrentDefinition(), "getElementalWeakness", () => ({ type: 2, percent: 40 }));
  maxRolls();
  for (const player of [pacts, main]) wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  const half = Math.floor(PluginManager.modifyRangedMaxHit(main, null, core.DamageFormulas.calculateMaxRangedHit(main)) / 2);
  const [mainBolt, mainIce] = methodFor(main).hits(main, target);
  assert.deepEqual([mainBolt.getTotalDamage(), mainIce.getTotalDamage()], [half, half], "without the ice-as-water pact: no water");
  const [bolt, ice] = methodFor(pacts).hits(pacts, target);
  const weak = half + Math.floor((half * 40) / 100);
  assert.equal(bolt.getTotalDamage(), half, "the crossbow bolt is no ice");
  assert.equal(ice.getTotalDamage(), Math.floor((weak * 120) / 100), "+40% weakness, then +20% at full hitpoints");

  pacts.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 50, false);
  methodFor(pacts).handleAfterHitEffects(ice);
  assert.equal(pacts.getSkillManager().getCurrentLevel(Skill.HITPOINTS), 50 + Math.floor(ice.getTotalDamage() * 0.6), "the water heal");
});

test("the Corporeal Beast takes King's barrage's hits in full, any other ranged weapon's halved", () => {
  const Beast = require("../plugins/bosses/corporealbeast/Beast.CorporealBeast");
  require("../plugins/bosses/corporealbeast/Shared.CorporealBeast").bind({ core, emitCustomEvent: (name, payload) => PluginManager.emitCustomEvent(name, payload) });
  const player = character("barrage-corp");
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  assert.equal(Beast.halved(player, core.CombatType.RANGED), false);
  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  assert.equal(Beast.halved(player, core.CombatType.RANGED), true);
});

// ------------------------------------------------------------------ Drygore blowpipe

test("Drygore blowpipe: the two-roll chance is the higher of two attack rolls against one defence roll", () => {
  const { hitChance } = Drygore._test;
  for (const [attack, defence] of [[100, 50], [50, 100], [7, 7], [0, 10], [3, 0]]) {
    assert.ok(Math.abs(hitChance(attack, defence, 1) - core.AccuracyFormulasDpsCalc.hitChance(attack, defence)) < 1e-12, `${attack}/${defence}`);
    let wins = 0;
    for (let a1 = 0; a1 <= attack; a1++) for (let a2 = 0; a2 <= attack; a2++) for (let d = 0; d <= defence; d++) if (Math.max(a1, a2) > d) wins++;
    const exact = wins / ((attack + 1) ** 2 * (defence + 1));
    assert.ok(Math.abs(hitChance(attack, defence, 2) - exact) < 1e-12, `two rolls ${attack}/${defence}`);
  }
});

test("Drygore blowpipe: forces a hit at the second roll's extra chance, for its wielder only", () => {
  const player = character("drygore-roll");
  const { pipe } = loadDrygore(player, DRAGON_DART);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  stub(core.AccuracyFormulasDpsCalc, "specialRolls", () => ({ attack: 100, defence: 100 }));
  const { hitChance, doubleAccuracy } = Drygore._test;
  const single = hitChance(100, 100, 1);
  const extra = (hitChance(100, 100, 2) - single) / (1 - single);
  const roll = (attacker) => {
    const event = { attacker, target: npc(), combatType: RANGED(), forceAccurate: false, forceMaxHit: false };
    doubleAccuracy(event);
    return event.forceAccurate;
  };
  randoms([extra - 0.001]);
  assert.equal(roll(player), true);
  randoms([extra + 0.001]);
  assert.equal(roll(player), false, "the core's own roll decides");
  randoms([0]);
  assert.equal(roll(character("drygore-roll-other")), false, "not without the pipe");
});

test("Drygore blowpipe: a 25% burn on a landed hit, not on a miss nor from a pact echo", () => {
  const player = character("drygore-burn");
  const { pipe } = loadDrygore(player, DRAGON_DART);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  const target = npc();
  const burns = () => emitted.filter(([name]) => name === "combat:burn").length;
  randoms([0.3]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({}, core.ItemIdentifiers.DRYGORE_BLOWPIPE) });
  assert.equal(burns(), 0, "a 30 misses the 25%");
  randoms([0.2]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({}, core.ItemIdentifiers.DRYGORE_BLOWPIPE) });
  assert.equal(burns(), 1);
  assert.equal(emitted.find(([name]) => name === "combat:burn")[1].target, target);
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({ isAccurate: () => false }, core.ItemIdentifiers.DRYGORE_BLOWPIPE) });
  assert.equal(burns(), 1, "a miss does not burn");
  // The pipe that fired it decides, not the weapon worn when it lands.
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.MAGIC_SHORTBOW));
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({}, core.ItemIdentifiers.DRYGORE_BLOWPIPE) });
  assert.equal(burns(), 2, "a swap after firing keeps the burn");
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({}, core.ItemIdentifiers.MAGIC_SHORTBOW) });
  hooks.onCombatHitResolved({ attacker: player, target, hit: fakeHit({}, null) });
  assert.equal(burns(), 2, "another weapon's or an unknown shot does not burn");
});

test("Drygore blowpipe: the last dart is rolled with the loaded pipe, then spent", () => {
  const player = character("drygore-last-dart");
  const pipe = drygoreWielder(player, 1);
  core.BonusManager.update(player);
  stub(core.Misc, "getRandom", () => 99); // no Ava's device recovers it
  const method = Blowpipe._test.combatMethod(false);
  const target = npc();
  method.start(player, target);
  assert.equal(pipe.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE, "still loaded when the shot is rolled");
  const [hit] = method.hits(player, target);
  assert.equal(hit.getFiredRangedShot().weapon.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE, "fired from the loaded pipe");
  assert.equal(pipe.getId(), core.ItemIdentifiers.DRYGORE_BLOWPIPE_EMPTY_, "the dart is spent after the roll");
  assert.equal(Blowpipe._test.BlowpipeState.read(pipe).dartAmount, 0);
  method.hits(player, target);
  assert.equal(Blowpipe._test.BlowpipeState.read(pipe).dartAmount, 0, "only the attack start armed spends");
});

test("blowpipe venom comes from the pipe that fired the shot, never from an unknown one", () => {
  const player = character("pipe-venom");
  const target = npc();
  const method = Blowpipe._test.combatMethod(false);
  const poisoned = [];
  stub(core.CombatFactory, "poisonEntity", (...args) => poisoned.push(args));
  stub(core.Misc, "getRandom", () => 0); // the venom roll succeeds
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.MAGIC_SHORTBOW));
  method.handleAfterHitEffects({ ...fakeHit({}, core.ItemIdentifiers.DRYGORE_BLOWPIPE), getAttacker: () => player, getTarget: () => target });
  method.handleAfterHitEffects({ ...fakeHit({}, null), getAttacker: () => player, getTarget: () => target });
  assert.equal(poisoned.length, 0, "a Drygore shot or an unknown one, after a swap: no venom");
  method.handleAfterHitEffects({ ...fakeHit({}, core.ItemIdentifiers.TOXIC_BLOWPIPE), getAttacker: () => player, getTarget: () => target });
  assert.equal(poisoned.length, 1, "a toxic blowpipe's shot keeps its venom after a swap");
});

// ------------------------------------------------------------------ Leagues VI only

test("outside Leagues VI the items are plain weapons: one bolt, no heal, one roll, no burn, Corp halves", () => {
  const Beast = require("../plugins/bosses/corporealbeast/Beast.CorporealBeast");
  require("../plugins/bosses/corporealbeast/Shared.CorporealBeast").bind({ core, emitCustomEvent: (name, payload) => PluginManager.emitCustomEvent(name, payload) });
  const player = character("echo-main", "main");
  wield(player, core.ItemIdentifiers.KINGS_BARRAGE, "CROSSBOW", "CROSSBOW_RAPID", DRAGON_BOLTS);
  assert.equal(methodFor(player), null, "the core's crossbow attack");
  assert.equal(Beast.halved(player, core.CombatType.RANGED), true, "the Corporeal Beast halves it");
  Barrage._test.toggleFreeze({ player });
  assert.equal(player.getAttribute(Barrage._test.FREEZE_DISABLED_ATTRIBUTE) === true, false, "Toggle-Freeze does nothing");
  assert.equal(player.sent.messages.length, 0);

  wield(player, core.ItemIdentifiers.NATURES_RECURVE, "SHORTBOW", "SHORTBOW_RAPID", RUNE_ARROW);
  player.getSkillManager().setCurrentLevel(Skill.HITPOINTS, 50, false);
  randoms([0]);
  land(player, npc(), fakeHit({}, RECURVE));
  assert.equal(player.getSkillManager().getCurrentLevel(Skill.HITPOINTS), 50, "no restore");

  const { pipe } = loadDrygore(player, DRAGON_DART);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, pipe);
  stub(core.AccuracyFormulasDpsCalc, "specialRolls", () => ({ attack: 100, defence: 100 }));
  const event = { attacker: player, target: npc(), combatType: RANGED(), forceAccurate: false, forceMaxHit: false };
  randoms([0]);
  Drygore._test.doubleAccuracy(event);
  assert.equal(event.forceAccurate, false, "one accuracy roll");
  randoms([0]);
  hooks.onCombatHitResolved({ attacker: player, target: npc(), hit: fakeHit({}, core.ItemIdentifiers.DRYGORE_BLOWPIPE) });
  assert.equal(emitted.filter(([name]) => name === "combat:burn").length, 0, "no burn");
});
