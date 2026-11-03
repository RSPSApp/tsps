// Offline regression checks only: no server, client, player login or smoke test.
const assert = require("node:assert/strict");
const { before, beforeEach, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const effects = require("../dist/game/content/combat/EquipmentEffects");
const core = PluginManager.getCoreApi();
const { ItemIdentifiers: I, Equipment: E, Skill, FightType, CombatType, CombatSpecial, CombatFactory, WeaponProfiles } = core;
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const events = new Map(), hooks = {}, resolvers = [], tasks = [], shots = [], sounds = [], drops = [];
let cycle = 100;
const noop = () => {};
const emit = (name, data) => { for (const fn of events.get(name) ?? []) fn(data); };
const api = new Proxy({
  core,
  onCustomEvent(name, fn) { const handlers = events.get(name) ?? []; handlers.push(fn); events.set(name, handlers); },
  emitCustomEvent: emit,
  registerWeaponProfile: profile => WeaponProfiles.register(profile),
  registerCombatMethodResolver: resolver => resolvers.push(resolver),
  registerCombatSpecial: definition => CombatSpecial.register(definition),
  registerRangedAmmoRecovery: resolver => { PluginManager.rangedAmmoRecovery = player => resolver.recovery(player) ?? 0; },
  registerCombatEffectiveLevelModifier: effects.registerCombatEffectiveLevelModifier,
  registerMeleeAttackAccuracyModifier: effects.registerMeleeAttackAccuracyModifier,
  registerMeleeHitModifier: effects.registerMeleeHitModifier,
  registerRangedAttackAccuracyModifier: effects.registerRangedAttackAccuracyModifier,
  registerRangedHitModifier: effects.registerRangedHitModifier,
  registerMagicAttackAccuracyModifier: effects.registerMagicAttackAccuracyModifier,
  registerMagicHitModifier: effects.registerMagicHitModifier,
  registerMagicDamageBonusModifier: effects.registerMagicDamageBonusModifier,
}, { get: (object, key) => key in object ? object[key] : fn => (hooks[key] ??= []).push(fn) });

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  core.World.getProcessCycle = () => cycle;
  core.TaskManager.submit = task => { task.setRunning(true); tasks.push(task); };
  core.Sounds.sendSound = (_player, sound) => sounds.push(sound);
  core.Projectile.createProjectile = (...data) => {
    shots.push(data);
    return { withAngle() { return this; }, withProgress() { return this; }, sendProjectile() {} };
  };
  ItemOnGroundManager.registerLocation = (_player, item) => drops.push(item);
  PluginManager.emitCustomEvent = emit;
  require("../plugins/combat/Burns.plugin").register(api);
  require("../plugins/items/EclipseAtlatl.plugin").register(api);
  require("../plugins/combat/specials/EclipseAtlatl.SpecialAttack")(api);
  require("../plugins/combat/specials/BurningClaws.SpecialAttack")(api);
  require("../plugins/combat/specials/ArkanBlade.SpecialAttack")(api);
  require("../plugins/items/AvasAccumulator.plugin").register(api);
  require("../plugins/items/VoidEquipment.plugin").register(api);
  require("../plugins/combat/effects/SalveAmulet.EquipmentEffects")(api);
  require("../plugins/items/SlayerHelmet.plugin").register(api);
  api.onCustomEvent("slayer:on-task", query => { query.onTask = query.player.onTask === true; });
});

beforeEach(() => {
  for (const task of tasks) task.stop();
  tasks.length = shots.length = sounds.length = drops.length = 0;
  cycle = 100;
});

function ticks(count) {
  for (let tick = 0; tick < count; tick++) {
    cycle++;
    for (const task of [...tasks]) if (task.isRunning()) task.tick();
  }
}

function player({ weapon = I.ECLIPSE_ATLATL, ammo = I.ATLATL_DART, amount = 10, strength = 99, ranged = 75 } = {}) {
  const items = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  items[E.WEAPON_SLOT] = new core.Item(weapon);
  items[E.AMMUNITION_SLOT] = new core.Item(ammo, amount);
  const levels = new Map(Skill.values().map(skill => [skill, 99]));
  levels.set(Skill.STRENGTH, strength); levels.set(Skill.RANGED, ranged);
  const attributes = new Map();
  const p = {
    items, levels, prayers: [], energy: 100, activated: false, hp: 100, registered: true,
    animations: [], graphics: [], messages: [], queued: [], credits: [], style: FightType.SHORTBOW_RAPID,
    meleeStrength: 100, rangedStrength: 999,
    isPlayer: () => true, isNpc: () => false, getAsPlayer: () => p,
    isRegistered: () => p.registered, getHitpoints: () => p.hp,
    getEquipment: () => ({ getItems: () => items, get: slot => items[slot], set: (slot, item) => { items[slot] = item; }, refreshItems() {} }),
    getSkillManager: () => ({ getCurrentLevel: skill => levels.get(skill), getMaxLevel: skill => levels.get(skill) }),
    getPrayerActive: () => p.prayers, getFightType: () => p.style,
    getWeapon: () => core.WeaponInterfaces.SHORTBOW,
    getBaseAttackSpeed: () => Player.prototype.getBaseAttackSpeed.call(p),
    getAttackAnim: target => WeaponProfiles.attackAnimation(p, -1, target.isNpc()),
    getBonusManager: () => ({ getOtherBonus: () => [p.meleeStrength, p.rangedStrength, 0], getAttackBonus: () => [0, 0, 0, 0, 100], getDefenceBonus: () => [0, 0, 0, 0, 0] }),
    getCombat: () => ({
      getRangedWeapon: () => core.RangedWeapon.getFor(p), getAmmunition: () => core.Ammunition.getFor(p),
      getSelectedSpell: () => null, getTarget: () => p.target, reset() {},
      addDamage: (source, damage) => p.credits.push({ source, damage }),
      getHitQueue: () => ({ addPendingDamage: hits => p.queued.push(...hits) }),
    }),
    getCombatSpecial: () => CombatSpecial.getById("eclipse_atlatl"),
    isSpecialActivated: () => p.activated, setSpecialActivated: value => { p.activated = value; },
    getSpecialPercentage: () => p.energy, decrementSpecialPercentage: amount => { p.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getPacketSender: () => new Proxy({}, { get: () => noop }),
    getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getLocation: () => new core.Location(3000, 3000),
    performAnimation: animation => p.animations.push(animation.getId()), performGraphic: graphic => p.graphics.push(graphic.id),
    sendMessage: message => p.messages.push(message),
  };
  return p;
}

function npc(name = "Goblin", id = -1) {
  const n = player();
  n.isPlayer = () => false; n.isNpc = () => true; n.getAsNpc = () => n;
  n.getId = () => id;
  n.getCurrentDefinition = () => ({ getName: () => name, hasAttribute: attribute => attribute === "undead" && name === "Undead" });
  n.manipulateHit = hit => hit;
  return n;
}

function fullSet(p, variant = "") {
  p.items[E.HEAD_SLOT] = new core.Item(I[`ECLIPSE_MOON_HELM${variant}`]);
  p.items[E.BODY_SLOT] = new core.Item(I[`ECLIPSE_MOON_CHESTPLATE${variant}`]);
  p.items[E.LEG_SLOT] = new core.Item(I[`ECLIPSE_MOON_TASSETS${variant}`]);
}
const normalMethod = p => resolvers.map(resolver => resolver.resolve(p)).find(Boolean);
const specialMethod = () => CombatSpecial.getById("eclipse_atlatl").getCombatMethod();
const maxHit = p => core.DamageFormulas.calculateMaxRangedHit(p);
function remaining(target) { const query = { target }; emit("combat:burn-remaining", query); return query.remaining; }
function burn(p, target, damage = 10, severity = "strong") { const query = { attacker: p, target, damage, severity }; emit("combat:burn", query); return query.applied === true; }

test("normal and LMS atlatls use only their darts; arrows and an empty slot are rejected", () => {
  for (const [weapon, ammo] of [[I.ECLIPSE_ATLATL, I.ATLATL_DART], [I.ECLIPSE_ATLATL_4, I.ATLATL_DART_3]]) {
    const p = player({ weapon, ammo });
    assert.ok(core.RangedWeapon.getFor(p));
    assert.equal(core.Ammunition.getFor(p).getItemId(), ammo);
    assert.equal(CombatFactory.checkAmmo(p, 1), true);
    p.items[E.AMMUNITION_SLOT] = new core.Item(I.RUNE_ARROW, 50);
    assert.equal(CombatFactory.checkAmmo(p, 1), false);
    p.items[E.AMMUNITION_SLOT] = new core.Item(-1, 0);
    assert.equal(CombatFactory.checkAmmo(p, 1), false);
  }
});

test("normal shots use the cache atlatl animation/projectile, consume darts, and never consume the weapon", t => {
  const p = player(), target = npc();
  t.mock.method(Math, "random", () => 0); // A broken dart cannot be recovered.
  normalMethod(p).start(p, target);
  assert.deepEqual(p.animations, [11057]);
  assert.equal(shots[0][2], 2795);
  assert.equal(sounds[0], core.Sound.THROW_DART);
  ticks(5);
  assert.equal(p.items[E.AMMUNITION_SLOT].getAmount(), 9);
  assert.equal(p.items[E.WEAPON_SLOT].getId(), I.ECLIPSE_ATLATL);
  const lastDart = player({ amount: 1 });
  normalMethod(lastDart).start(lastDart, target); ticks(5);
  assert.equal(lastDart.items[E.AMMUNITION_SLOT].getId(), -1);
  assert.equal(normalMethod(lastDart).canAttack(lastDart, target), false);
});

test("Ava's assembler recovers darts with Eclipse armour, while the 20% break chance still consumes them", t => {
  const p = player(); fullSet(p);
  p.items[E.CAPE_SLOT] = new core.Item(I.AVAS_ASSEMBLER);
  assert.equal(CombatFactory.ammoRecovery(p), 80);
  t.mock.method(Math, "random", () => 0.5);
  CombatFactory.decrementAmmo(p, targetLocation(), 1);
  assert.equal(p.items[E.AMMUNITION_SLOT].getAmount(), 10);
  Math.random = () => 0;
  CombatFactory.decrementAmmo(p, targetLocation(), 1);
  assert.equal(p.items[E.AMMUNITION_SLOT].getAmount(), 9);
  assert.deepEqual(drops, []);
});
function targetLocation() { return new core.Location(3001, 3000); }

test("max hits use visible Strength and melee strength, but Ranged prayers and the Accurate stance", () => {
  const p = player();
  assert.equal(maxHit(p), 27);
  p.levels.set(Skill.RANGED, 99); assert.equal(maxHit(p), 27);
  p.rangedStrength = 2000; assert.equal(maxHit(p), 27);
  p.levels.set(Skill.STRENGTH, 50); assert.equal(maxHit(p), 15);
  p.levels.set(Skill.STRENGTH, 99);
  p.prayers[core.PrayerHandler.PIETY] = true; assert.equal(maxHit(p), 27);
  p.prayers.fill(false); p.prayers[core.PrayerHandler.RIGOUR] = true; assert.equal(maxHit(p), 33);
  p.prayers.fill(false); p.style = FightType.SHORTBOW_ACCURATE; assert.equal(maxHit(p), 28);
});

test("accuracy still scales with Ranged instead of Strength and targets standard ranged defence", () => {
  const p = player(), stronger = player({ strength: 150 }), ranger = player({ ranged: 99 });
  const roll = core.AccuracyFormulasDpsCalc.attackRangedRoll;
  assert.equal(roll.call(core.AccuracyFormulasDpsCalc, p), roll.call(core.AccuracyFormulasDpsCalc, stronger));
  assert.ok(roll.call(core.AccuracyFormulasDpsCalc, ranger) > roll.call(core.AccuracyFormulasDpsCalc, p));
  assert.equal(WeaponProfiles.ranged(p).rangedDefenceType, "standard");
});

test("wielding an atlatl does not make boat cannon damage scale with Strength", () => {
  assert.equal(core.DamageFormulas.rangedMaxHitWithStrength(player(), 100), 21);
});

test("range is 6 or 8 on Longrange; Rapid is 3 ticks PvM, 4 PvP, or 3 PvP with the full set", () => {
  const p = player(), method = normalMethod(p);
  assert.equal(method.attackDistance(p), 6);
  p.style = FightType.SHORTBOW_LONGRANGE; assert.equal(method.attackDistance(p), 8);
  p.style = FightType.SHORTBOW_RAPID;
  for (const [target, set, expected] of [[npc(), false, 3], [player(), false, 4], [player(), true, 3]]) {
    if (set) fullSet(p);
    const event = { attacker: p, target, combatType: CombatType.RANGED, speed: method.attackSpeed(p) };
    hooks.onAttackSpeed.forEach(fn => fn(event)); assert.equal(event.speed, expected);
  }
});

test("Ranger Void boosts damage; melee Void does not", () => {
  const p = player();
  p.items[E.BODY_SLOT] = new core.Item(I.VOID_KNIGHT_TOP);
  p.items[E.LEG_SLOT] = new core.Item(I.VOID_KNIGHT_ROBE);
  p.items[E.HANDS_SLOT] = new core.Item(I.VOID_KNIGHT_GLOVES);
  p.items[E.HEAD_SLOT] = new core.Item(I.VOID_RANGER_HELM); assert.equal(maxHit(p), 30);
  p.items[E.HEAD_SLOT] = new core.Item(I.VOID_MELEE_HELM); assert.equal(maxHit(p), 27);
  p.items[E.HEAD_SLOT] = new core.Item(I.VOID_RANGER_HELM);
  p.items[E.BODY_SLOT] = new core.Item(I.ELITE_VOID_TOP);
  p.items[E.LEG_SLOT] = new core.Item(I.ELITE_VOID_ROBE); assert.equal(maxHit(p), 31);
});

test("plain Slayer helmets and Salve amulets boost damage through their melee bonus, without stacking", () => {
  const p = player(); p.onTask = true; p.target = npc();
  p.items[E.HEAD_SLOT] = new core.Item(I.SLAYER_HELMET); assert.equal(maxHit(p), 31);
  p.items[E.HEAD_SLOT] = new core.Item(I.SLAYER_HELMET_I_); assert.equal(maxHit(p), 31);
  p.target = npc("Undead"); p.items[E.AMULET_SLOT] = new core.Item(I.SALVE_AMULET_E_);
  assert.equal(maxHit(p), 32, "enchanted Salve's 20% replaces the helmet's 7/6");
});

test("full-set hits have a 20% burn chance; partial sets and misses do not burn", t => {
  const p = player(), target = npc(), method = normalMethod(p);
  t.mock.method(core.AccuracyFormulasDpsCalc, "rollAccuracy", () => true);
  t.mock.method(Math, "random", () => 0.199);
  let hit = method.hits(p, target)[0]; method.handleAfterHitEffects(hit);
  assert.equal(remaining(target), 0);
  fullSet(p); hit = method.hits(p, target)[0]; method.handleAfterHitEffects(hit);
  assert.equal(remaining(target), 10);
  Math.random = () => 0.2;
  hit = method.hits(p, target)[0]; method.handleAfterHitEffects(hit); assert.equal(remaining(target), 10);
  core.AccuracyFormulasDpsCalc.rollAccuracy = () => false;
  Math.random = () => 0;
  hit = method.hits(p, target)[0]; method.handleAfterHitEffects(hit); assert.equal(remaining(target), 10);
});

test("special requires intact, degraded or LMS full armour, works without darts and costs 50% once", () => {
  const method = specialMethod();
  for (const variant of ["", "_4", "_6"]) {
    const p = player({ ammo: -1, amount: 0 }), target = npc(); p.activated = true;
    assert.equal(method.canAttack(p, target), false);
    assert.equal(p.energy, 100);
    fullSet(p, variant); assert.equal(method.canAttack(p, target), true);
    method.start(p, target); assert.equal(p.energy, 50);
    assert.equal(method.attackDistance(p), 1); assert.equal(method.type(), CombatType.MAGIC);
    assert.deepEqual(p.animations, [11060]); assert.deepEqual(p.graphics, [2797]);
    assert.equal(p.items[E.AMMUNITION_SLOT].getId(), -1);
    method.finished(p, target);
  }
  const p = player(); fullSet(p);
  p.items[E.HEAD_SLOT] = new core.Item(I.ECLIPSE_MOON_HELM_BROKEN_);
  assert.equal(method.canAttack(p, npc()), false);
});

test("special consumes the remaining burn and adds its damage to the max and half to the minimum", t => {
  const p = player(), target = npc(), method = specialMethod(); fullSet(p);
  burn(p, target); ticks(16); assert.equal(remaining(target), 6);
  p.activated = true; method.start(p, target);
  assert.equal(remaining(target), 0);
  const traits = CombatSpecial.activeTraitsFor(p);
  assert.equal(traits.accuracyMultiplier, 1.5);
  assert.equal(traits.rollAttackType, "magic");
  t.mock.method(core.AccuracyFormulasDpsCalc, "rollAccuracy", () => true);
  t.mock.method(Math, "random", () => 0);
  assert.equal(method.hits(p, target)[0].getTotalDamage(), 3);
  Math.random = () => 0.999999;
  assert.equal(method.hits(p, target)[0].getTotalDamage(), 33);
  p.prayers[core.PrayerHandler.PIETY] = true;
  assert.equal(method.hits(p, target)[0].getTotalDamage(), 33, "a melee prayer does not boost the atlatl special");
  p.prayers.fill(false); p.prayers[core.PrayerHandler.RIGOUR] = true;
  assert.equal(method.hits(p, target)[0].getTotalDamage(), 39, "Ranged prayers still boost its Strength-based damage");
  method.finished(p, target);
  assert.equal(CombatSpecial.activeTraitsFor(p).maximumDamageBonus, 0);
  ticks(40); assert.equal(target.queued.length, 4, "consumed burns never tick again");
});

test("five burns cap at 50 damage, tick together every four ticks, and cannot refresh or replace a stack", () => {
  const p = player(), target = npc();
  for (let i = 0; i < 5; i++) assert.equal(burn(p, target), true);
  assert.equal(burn(p, target), false); assert.equal(remaining(target), 50);
  ticks(3); assert.equal(target.queued.length, 0);
  ticks(1); assert.deepEqual(target.queued.map(hit => hit.getDamage()), [5]);
  assert.equal(target.queued[0].getSplatType(true), 74);
  assert.equal(remaining(target), 45);
  ticks(35); assert.equal(burn(p, target), false);
  ticks(1); assert.equal(remaining(target), 0);
  assert.equal(target.queued.reduce((sum, hit) => sum + hit.getDamage(), 0), 50);
  assert.equal(burn(p, target), true);
});

test("separate burns expire independently and a shortened burn contributes only its remaining damage", () => {
  const p = player(), target = npc(); burn(p, target); ticks(8); burn(p, target, 5, "normal");
  assert.equal(remaining(target), 13); ticks(20); assert.equal(remaining(target), 3);
  ticks(12); assert.equal(remaining(target), 0);
  assert.equal(target.queued.reduce((sum, hit) => sum + hit.getDamage(), 0), 15);
});

test("each burn source receives credit for its own damage", () => {
  const first = player(), second = player(), target = npc();
  burn(first, target); burn(second, target); ticks(4);
  assert.equal(target.queued[0].getDamage(), 2);
  assert.deepEqual(target.credits, [{ source: first, damage: 1 }, { source: second, damage: 1 }]);
});

test("cache equipment requirements remain 75 Ranged, 50 Attack and 50 Strength", () => {
  const requirements = core.ItemDefinition.forId(I.ECLIPSE_ATLATL).getRequirements();
  assert.equal(requirements[Skill.RANGED.getIndex()], 75);
  assert.equal(requirements[Skill.ATTACK.getIndex()], 50);
  assert.equal(requirements[Skill.STRENGTH.getIndex()], 50);
});

test("burns bypass ranged protection, do not roll attacks or XP, and still respect NPC ranged immunity", t => {
  const p = player(), target = player(); target.prayers[core.PrayerHandler.PROTECT_FROM_MISSILES] = true;
  burn(p, target);
  t.mock.method(core.DamageFormulas, "sourceMaxHit", () => { throw new Error("A burn must not calculate a weapon attack"); });
  ticks(4); assert.equal(target.queued[0].getDamage(), 1);
  assert.equal(target.credits[0].source, p);
  const immuneNpc = npc("Dusk"); let damageType;
  immuneNpc.manipulateHit = hit => { damageType = hit.getCombatType(); hit.getHits().forEach(damage => damage.setDamage(0)); return hit; };
  burn(p, immuneNpc); ticks(4);
  assert.equal(damageType, CombatType.RANGED); assert.deepEqual(immuneNpc.queued, []);
});

test("burn immunity distinguishes strong Eclipse/Arkan burns from normal burns", () => {
  const p = player();
  for (const name of ["TzKal-Zuk", "Slug Prince", "Gemstone crab", "Mad angel", "Eclipse Moon", "Blue Moon", "Blood Moon"]) {
    assert.equal(burn(p, npc(name)), false, name);
  }
  assert.equal(burn(p, npc("Cerberus"), 10, "normal"), false);
  assert.equal(burn(p, npc("Cerberus"), 10, "strong"), true);
  assert.equal(burn(p, npc("Alchemical Hydra", 8620), 10, "normal"), false);
  assert.equal(burn(p, npc("Alchemical Hydra", 8620), 10, "strong"), true);
});

test("death, logout, NPC death and ornate pools clear burns without affecting the next life", () => {
  const p = player();
  for (const [hook, field] of [["onPlayerDefeated", "victim"], ["onPlayerLogout", "player"], ["onNpcDeath", "npc"]]) {
    const target = npc(); burn(p, target); hooks[hook].forEach(fn => fn({ [field]: target }));
    assert.equal(remaining(target), 0); ticks(4); assert.deepEqual(target.queued, []);
    burn(p, target); ticks(4); assert.equal(target.queued[0].getDamage(), 1);
  }
  const target = player(); burn(p, target);
  emit("rejuvenation-pool:restored", { player: target, tier: 3 }); assert.equal(remaining(target), 10);
  emit("rejuvenation-pool:restored", { player: target, tier: 4 }); assert.equal(remaining(target), 0);
  burn(p, target); emit("combat:clear-burn", { target }); assert.equal(remaining(target), 0);
});

test("Burning claws and Arkan blade share the tracker consumed by Eclipse", t => {
  const p = player(), target = npc(); fullSet(p);
  const hit = { getAttacker: () => p, getTarget: () => target, getFirstSuccessfulRangeIndex: () => 0, getHits: () => [1, 1, 1], isAccurate: () => true, getTotalDamage: () => 3 };
  t.mock.method(Math, "random", () => 0);
  CombatSpecial.getById("burning_claws").getCombatMethod().handleAfterHitEffects(hit);
  CombatSpecial.getById("arkan_blade").getCombatMethod().handleAfterHitEffects(hit);
  assert.equal(remaining(target), 40);
  p.activated = true; specialMethod().start(p, target);
  assert.equal(CombatSpecial.activeTraitsFor(p).maximumDamageBonus, 40);
  assert.equal(remaining(target), 0);
});

test("animation, projectile and special graphics match named revision 241 cache entries", () => {
  const gamevals = new Gamevals();
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(11057), "human_atlatl_attack_ranged_01");
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(11060), "human_special_atlatl_01");
  assert.equal(gamevals.namesOf(GamevalKind.SPOTANIM).get(2795), "vfx_atlatl_projectile_01");
  assert.equal(gamevals.namesOf(GamevalKind.SPOTANIM).get(2797), "special_atlatl_cast_spotanim");
  assert.equal(gamevals.namesOf(GamevalKind.SPOTANIM).get(2798), "special_atlatl_impact_spotanim");
});
