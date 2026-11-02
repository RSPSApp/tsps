// Run after `yarn build`: node --test tests/league-pacts-magic.test.cjs
// Demonic Pacts' magic pacts (Magic.LeaguePacts.js): every effect for a Demonic Pacts character
// holding the pact, and for nobody else (a Raging Echoes character, a main). Regenerate is the
// general batch's; these tests emit its `league:pact-regenerated` themselves.
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
const { Location } = require("../dist/game/model/Location");

let core;
let Common;
const hooks = {};
const custom = {};
const modifiers = {};
const heals = [];
let worldLeague = 6;
const realRandom = Math.random;

const HILL_GIANT = 2098;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  // Weapon interfaces (a trident's POWERED_STAFF) come from item-gameplay.json.
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
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
    registerMagicDamageBonusModifier: (modifier) => (modifiers.magicDamage = modifier),
    registerRestingLevelModifier: (modifier) => SkillManager.registerRestingLevelModifier(modifier),
    registerMagicAttackAccuracyModifier: (modifier) => (modifiers.magicAccuracy = modifier),
    registerMeleeAttackAccuracyModifier: (modifier) => (modifiers.meleeAccuracy = modifier),
    registerRangedAttackAccuracyModifier: (modifier) => (modifiers.rangedAccuracy = modifier),
    onInterfaceActionButton: (ids, handler) => { for (const id of [].concat(ids)) on(`button:${id}`)(handler); },
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  custom["league:pact-heal"] = [(payload) => heals.push(payload)];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
});

afterEach(() => {
  Math.random = realRandom;
  heals.length = 0;
});

function character(name, { profile = "league", league = 6 } = {}) {
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
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile });
  // A new Demonic Pacts character starts with the starter kit; these tests bring their own items.
  player.getInventory().resetItems();
  worldLeague = 6;
  const skills = player.getSkillManager();
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.RANGED, core.Skill.MAGIC, core.Skill.HITPOINTS, core.Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  return player;
}

/** The nodes whose effect is `varbit` (all of them, or the first `count`). */
function nodesOf(varbit, count = Infinity) {
  return Common.nodes.filter((node) => node.varbit === varbit).slice(0, count).map((node) => node.index);
}

/** A Demonic Pacts character holding the given effects' nodes, and the two who must get nothing. */
function cast(name, ...effects) {
  const pacts = character(`${name}-pacts`);
  Common.save(pacts, effects.flatMap((effect) => (Array.isArray(effect) ? nodesOf(...effect) : nodesOf(effect))));
  const echoes = character(`${name}-echoes`, { league: 5 });
  const main = character(`${name}-main`, { profile: "main" });
  for (const other of [echoes, main]) Common.save(other, effects.flatMap((effect) => (Array.isArray(effect) ? nodesOf(...effect) : nodesOf(effect))));
  return { pacts, others: [echoes, main] };
}

const query = (name, payload) => {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
};
const spell = (name) => core.CombatSpells[name];
const maxHit = (attacker, spellName, value = 100, target = null) =>
  query("combat:magic-max-hit", { attacker, target, spell: spell(spellName), baseMaxHit: value, maxHit: value }).maxHit;
const ticks = (n) => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
const level = (player, skill) => player.getSkillManager().getCurrentLevel(skill);
const wield = (player, itemId) => player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(itemId, 1));
/** As General sends it: a rune in `itemId`; a charge with `itemId` -1 and its weapon in `weaponId`. */
const regen = (player, kind, itemId, amount = 1, combat = true) =>
  query("league:pact-regenerated", kind === "charge" ? { player, kind, itemId: -1, weaponId: itemId, amount, combat } : { player, kind, itemId, amount, combat });
const I = () => core.ItemIdentifiers;

function npc(id = HILL_GIANT) {
  const target = new NPC(id, new Location(3200, 3201, 0));
  target.isRegistered = () => true;
  return target;
}

/** A landed (or missed) magic PendingHit stand-in for onCombatHitResolved. */
function landed(attacker, target, spellName, damage, accurate = true) {
  return {
    attacker, target,
    hit: { getCombatType: () => core.CombatType.MAGIC, isAccurate: () => accurate, getSpell: () => spell(spellName), getTotalDamage: () => damage },
  };
}

test("the magic effects map to cache nodes", () => {
  for (const effect of ["talent_airrune_regen_prayer_restore", "talent_waterrune_regen_healing", "talent_firerune_regen_damage_boost",
    "talent_earthrune_regen_defence_boost", "talent_percentage_magic_damage", "talent_water_spell_damage_high_hp",
    "talent_air_spell_max_hit_prayer_bonus", "talent_water_spell_bouce_heal", "talent_fire_hp_consume_for_damage",
    "talent_fire_spell_burn_bounce", "talent_magic_attack_speed_traditional", "talent_regen_stave_charges_water",
    "talent_regen_stave_charges_fire", "talent_regen_stave_charges_air", "talent_regen_stave_charges_earth",
    "talent_earth_scale_defence_stat", "talent_earth_reduce_defence", "talent_smoke_counts_as_air", "talent_ice_counts_as_water",
    "talent_blood_counts_as_fire", "talent_shadow_counts_as_earth", "talent_regen_magic_level_boost",
    "talent_magic_attack_speed_powered", "talent_air_spell_damage_active_prayers"]) {
    assert.ok(nodesOf(effect).length > 0, effect);
  }
});

test("water spells: up to +20% max hit by hitpoints; ice counts only with its pact", () => {
  const { pacts, others } = cast("waterhp", "talent_water_spell_damage_high_hp");
  assert.equal(maxHit(pacts, "WATER_SURGE"), 120, "full hitpoints");
  pacts.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 49, false);
  assert.equal(maxHit(pacts, "WATER_SURGE"), 109, "49 of 99 hitpoints: +9.9%, rounded down");
  assert.equal(maxHit(pacts, "FIRE_SURGE"), 100, "not a water spell");
  assert.equal(maxHit(pacts, "ICE_BARRAGE"), 100, "ice is not water without its pact");
  Common.save(pacts, [...Common.pacts(pacts), ...nodesOf("talent_ice_counts_as_water")]);
  assert.ok(maxHit(pacts, "ICE_BARRAGE") > 100, "ice counts as water");
  for (const other of others) assert.equal(maxHit(other, "WATER_SURGE"), 100);
});

test("air spells: +7% per active prayer; smoke counts only with its pact", () => {
  const { pacts, others } = cast("airprayers", "talent_air_spell_damage_active_prayers");
  const pray = (player) => { player.getPrayerActive()[0] = true; player.getPrayerActive()[1] = true; };
  pray(pacts);
  assert.equal(maxHit(pacts, "WIND_SURGE"), 114);
  assert.equal(maxHit(pacts, "SMOKE_BARRAGE"), 100);
  Common.save(pacts, [...Common.pacts(pacts), ...nodesOf("talent_smoke_counts_as_air")]);
  assert.equal(maxHit(pacts, "SMOKE_BARRAGE"), 114);
  for (const other of others) {
    pray(other);
    assert.equal(maxHit(other, "WIND_SURGE"), 100);
  }
});

test("earth spells: +1 max hit per 12 current Defence; shadow counts only with its pact", () => {
  const { pacts, others } = cast("earthdef", "talent_earth_scale_defence_stat");
  assert.equal(maxHit(pacts, "EARTH_SURGE"), 108, "99 Defence / 12");
  assert.equal(maxHit(pacts, "SHADOW_BARRAGE"), 100);
  Common.save(pacts, [...Common.pacts(pacts), ...nodesOf("talent_shadow_counts_as_earth")]);
  assert.equal(maxHit(pacts, "SHADOW_BARRAGE"), 108);
  for (const other of others) assert.equal(maxHit(other, "EARTH_SURGE"), 100);
});

test("magic damage nodes: +1% magic damage each (tripled by Tumeken's shadow) and +10% accuracy in every style", () => {
  const { pacts, others } = cast("magicdmg", ["talent_percentage_magic_damage", 2]);
  assert.equal(modifiers.magicDamage(pacts, 40), 60, "two nodes: +20 permille");
  wield(pacts, I().TUMEKENS_SHADOW);
  assert.equal(modifiers.magicDamage(pacts, 40), 100, "x3 with the shadow");
  for (const modifier of [modifiers.magicAccuracy, modifiers.meleeAccuracy, modifiers.rangedAccuracy]) {
    assert.equal(Math.round(modifier(pacts, 1000)), 1200);
  }
  for (const other of others) {
    assert.equal(modifiers.magicDamage(other, 40), 40);
    assert.equal(modifiers.meleeAccuracy(other, 1000), 1000);
  }
});

test("air spells: a chance to max hit per prayer bonus, doubled against an air-weak target", () => {
  const { pacts, others } = cast("airmax", "talent_air_spell_max_hit_prayer_bonus");
  const roll = (player, target = null) => {
    player.getCombat().setCastSpell(spell("WIND_WAVE"));
    player.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] = 10;
    return query("combat:hit-rolled", { attacker: player, target, combatType: core.CombatType.MAGIC, damage: 3, minimum: 0, maximum: 20 }).damage;
  };
  Math.random = () => 0.05; // inside 10%
  assert.equal(roll(pacts), 20);
  Math.random = () => 0.15; // outside 10%
  assert.equal(roll(pacts), 3);
  const weak = npc();
  weak.getCurrentDefinition = () => ({ getElementalWeakness: () => ({ type: 1, percent: 20 }) });
  assert.equal(roll(pacts, weak), 20, "doubled: inside 20%");
  Math.random = () => 0;
  for (const other of others) assert.equal(roll(other), 3);
});

test("fire casts burn up to 6% of max hitpoints for twice that in damage, never the last hitpoint", () => {
  const { pacts, others } = cast("fireburn", "talent_fire_hp_consume_for_damage");
  const castAndHit = (player, spellName = "FIRE_SURGE") => {
    query("magic:cast-committed", { player, spell: spell(spellName) });
    const damage = new core.HitDamage(10, core.HitMask.RED);
    hooks.onCombatHitDamage({ attacker: player, target: npc(), combatType: core.CombatType.MAGIC, hit: {}, damage, accurate: true });
    return damage.getDamage();
  };
  assert.equal(castAndHit(pacts), 20, "99 hitpoints: 5 burned, +10");
  assert.equal(pacts.getCombat().getHitQueue().hasPendingWork(), true, "the burn is a hitsplat on the caster");
  assert.equal(castAndHit(pacts, "WIND_SURGE"), 10, "not a fire spell");
  pacts.getSkillManager().setCurrentLevels(core.Skill.HITPOINTS, 1, false);
  assert.equal(castAndHit(pacts), 10, "at 1 hitpoint nothing burns");
  for (const other of others) assert.equal(castAndHit(other), 10);
});

test("water spell hits heal 60% of their damage", () => {
  const { pacts, others } = cast("waterheal", "talent_water_spell_bouce_heal");
  hooks.onCombatHitResolved(landed(pacts, npc(), "WATER_SURGE", 20));
  assert.deepEqual(heals.map(({ player, amount }) => [player, amount]), [[pacts, 12]]);
  heals.length = 0;
  hooks.onCombatHitResolved(landed(pacts, npc(), "WATER_SURGE", 20, false));
  hooks.onCombatHitResolved(landed(pacts, npc(), "FIRE_SURGE", 20));
  for (const other of others) hooks.onCombatHitResolved(landed(other, npc(), "WATER_SURGE", 20));
  assert.equal(heals.length, 0);
});

test("fire spell hits burn the target (1 a 4 ticks) and the burn bounces to two nearby targets", () => {
  const { pacts, others } = cast("fireburnbounce", "talent_fire_spell_burn_bounce");
  const target = npc();
  const near = [npc(), npc(), npc()];
  const splats = new Map();
  for (const each of [target, ...near]) {
    const queue = each.getCombat().getHitQueue();
    queue.addPendingDamage = (hits) => splats.set(each, (splats.get(each) ?? 0) + hits.reduce((sum, hit) => sum + hit.getDamage(), 0));
  }
  pacts.getLocalNpcs = () => near;
  const realCanAttack = core.CombatFactory.canAttackSecondaryTarget;
  core.CombatFactory.canAttackSecondaryTarget = () => true;
  try {
    hooks.onCombatHitResolved(landed(pacts, target, "FIRE_SURGE", 10));
    ticks(4);
    assert.equal(splats.get(target), 1, "the burn's first tick");
    assert.equal(near.filter((each) => splats.get(each) === 1).length, 2, "two bounced burns");
    for (const other of others) {
      const untouched = npc();
      untouched.getCombat().getHitQueue().addPendingDamage = () => assert.fail("no burn");
      other.getLocalNpcs = () => [];
      hooks.onCombatHitResolved(landed(other, untouched, "FIRE_SURGE", 10));
    }
    ticks(4);
  } finally {
    core.CombatFactory.canAttackSecondaryTarget = realCanAttack;
  }
});

test("earth spell hits lower the target's Defence and Magic by 2", () => {
  const { pacts, others } = cast("earthdrain", "talent_earth_reduce_defence");
  const target = npc();
  const defence = target.getCurrentLevel(core.Skill.DEFENCE);
  const magic = target.getCurrentLevel(core.Skill.MAGIC);
  hooks.onCombatHitResolved(landed(pacts, target, "EARTH_SURGE", 10));
  assert.equal(target.getCurrentLevel(core.Skill.DEFENCE), defence - 2);
  assert.equal(target.getCurrentLevel(core.Skill.MAGIC), Math.max(0, magic - 2));
  const opponent = character("earthdrain-victim");
  hooks.onCombatHitResolved(landed(pacts, opponent, "EARTH_SURGE", 10));
  assert.equal(level(opponent, core.Skill.DEFENCE), 97, "a player too");
  for (const other of others) {
    const untouched = npc();
    hooks.onCombatHitResolved(landed(other, untouched, "EARTH_SURGE", 10));
    assert.equal(untouched.getCurrentLevel(core.Skill.DEFENCE), defence);
  }
});

test("spellbook combat spells attack 2 ticks faster, never below 2", () => {
  const { pacts, others } = cast("tradspeed", "talent_magic_attack_speed_traditional");
  const speed = (player, value) => {
    player.getCombat().setCastSpell(spell("FIRE_SURGE"));
    const event = { attacker: player, target: null, combatType: core.CombatType.MAGIC, speed: value };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  assert.equal(speed(pacts, 5), 3);
  assert.equal(speed(pacts, 3), 2);
  assert.equal(speed(pacts, 1), 1, "an already faster rate stays");
  for (const other of others) assert.equal(speed(other, 5), 5);
});

test("powered staves attack 3 ticks faster, never below 1; a one-handed one's max hit is 8 lower", () => {
  const { pacts, others } = cast("poweredspeed", "talent_magic_attack_speed_powered");
  const speed = (player, value) => {
    wield(player, I().TRIDENT_OF_THE_SEAS);
    player.getCombat().setCastSpell(spell("TRIDENT_OF_THE_SEAS"));
    const event = { attacker: player, target: null, combatType: core.CombatType.MAGIC, speed: value };
    hooks.onAttackSpeed(event);
    return event.speed;
  };
  assert.equal(speed(pacts, 4), 1);
  const trident = new core.Item(I().TRIDENT_OF_THE_SEAS, 1);
  assert.equal(trident.getDefinition().isDoubleHanded(), false, "the trident is one-handed");
  assert.equal(maxHit(pacts, "TRIDENT_OF_THE_SEAS", 30), 22);
  assert.equal(maxHit(pacts, "FIRE_SURGE", 30), 30, "a spellbook spell from the staff");
  for (const other of others) {
    assert.equal(speed(other, 4), 4);
    assert.equal(maxHit(other, "TRIDENT_OF_THE_SEAS", 30), 30);
  }
});

test("Regenerated air runes: a 15% chance to restore 1 prayer per rune", () => {
  const { pacts, others } = cast("airregen", "talent_airrune_regen_prayer_restore");
  pacts.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 50, false);
  Math.random = () => 0.1;
  regen(pacts, "rune", I().AIR_RUNE, 3);
  assert.equal(level(pacts, core.Skill.PRAYER), 53);
  regen(pacts, "rune", I().AIR_RUNE, 3, false);
  assert.equal(level(pacts, core.Skill.PRAYER), 53, "not a combat spell");
  Math.random = () => 0.2;
  regen(pacts, "rune", I().AIR_RUNE, 3);
  assert.equal(level(pacts, core.Skill.PRAYER), 53, "outside 15%");
  Math.random = () => 0;
  regen(pacts, "rune", I().SMOKE_RUNE, 2);
  assert.equal(level(pacts, core.Skill.PRAYER), 55, "a smoke rune is an air rune");
  for (const other of others) {
    other.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 50, false);
    regen(other, "rune", I().AIR_RUNE, 3);
    assert.equal(level(other, core.Skill.PRAYER), 50);
  }
});

test("Regenerated water runes heal 1 each", () => {
  const { pacts, others } = cast("waterregen", "talent_waterrune_regen_healing");
  regen(pacts, "rune", I().WATER_RUNE, 4);
  regen(pacts, "rune", I().FIRE_RUNE, 4);
  for (const other of others) regen(other, "rune", I().WATER_RUNE, 4);
  assert.deepEqual(heals.map(({ player, amount }) => [player, amount]), [[pacts, 4]]);
});

test("Regenerated fire runes add 1 each to the next landed spell hit", () => {
  const { pacts, others } = cast("fireregen", "talent_firerune_regen_damage_boost");
  const hit = (player, accurate = true) => {
    const damage = new core.HitDamage(10, core.HitMask.RED);
    hooks.onCombatHitDamage({ attacker: player, target: npc(), combatType: core.CombatType.MAGIC, hit: {}, damage, accurate });
    return damage.getDamage();
  };
  regen(pacts, "rune", I().FIRE_RUNE, 3);
  assert.equal(hit(pacts, false), 10, "a splash keeps it");
  assert.equal(hit(pacts), 13);
  assert.equal(hit(pacts), 10, "only the next hit");
  for (const other of others) {
    regen(other, "rune", I().FIRE_RUNE, 3);
    assert.equal(hit(other), 10);
  }
});

test("Regenerated earth runes boost Defence by 1 each for 30 ticks, at most 20% of base", () => {
  const { pacts, others } = cast("earthregen", "talent_earthrune_regen_defence_boost");
  regen(pacts, "rune", I().EARTH_RUNE, 5);
  assert.equal(level(pacts, core.Skill.DEFENCE), 104);
  regen(pacts, "rune", I().EARTH_RUNE, 30);
  assert.equal(level(pacts, core.Skill.DEFENCE), 99 + 19, "20% of 99");
  ticks(20);
  regen(pacts, "rune", I().EARTH_RUNE, 1);
  ticks(20);
  assert.equal(level(pacts, core.Skill.DEFENCE), 118, "the retrigger reset the time");
  ticks(11);
  assert.equal(level(pacts, core.Skill.DEFENCE), 99);
  for (const other of others) {
    regen(other, "rune", I().EARTH_RUNE, 5);
    assert.equal(level(other, core.Skill.DEFENCE), 99);
  }
});

test("Regenerated runes boost Magic by 1 a proc for 30 ticks, at most 10", () => {
  const { pacts, others } = cast("magicregen", "talent_regen_magic_level_boost");
  for (let i = 0; i < 12; i++) regen(pacts, "rune", I().DEATH_RUNE, 2);
  assert.equal(level(pacts, core.Skill.MAGIC), 109);
  regen(pacts, "rune", I().DEATH_RUNE, 2, false);
  ticks(31);
  assert.equal(level(pacts, core.Skill.MAGIC), 99);
  for (const other of others) {
    regen(other, "rune", I().DEATH_RUNE, 2);
    assert.equal(level(other, core.Skill.MAGIC), 99);
  }
});

test("Regenerated powered staff charges also give a water, fire, air and earth rune", () => {
  const effects = ["talent_regen_stave_charges_water", "talent_regen_stave_charges_fire", "talent_regen_stave_charges_air", "talent_regen_stave_charges_earth"];
  const { pacts, others } = cast("staveregen", ...effects);
  regen(pacts, "charge", I().TRIDENT_OF_THE_SEAS, 1);
  for (const rune of ["WATER_RUNE", "FIRE_RUNE", "AIR_RUNE", "EARTH_RUNE"]) assert.equal(pacts.getInventory().getAmount(I()[rune]), 1, rune);
  regen(pacts, "charge", I().ABYSSAL_TENTACLE, 1);
  assert.equal(pacts.getInventory().getAmount(I().WATER_RUNE), 1, "not a powered staff");
  for (const other of others) {
    regen(other, "charge", I().TRIDENT_OF_THE_SEAS, 1);
    assert.equal(other.getInventory().getAmount(I().WATER_RUNE), 0);
  }
});

test("Magic's boost is +1 a Regenerate proc, not a rune type: a cast's runes come one event each", () => {
  const { pacts } = cast("magicregenproc", "talent_regen_magic_level_boost");
  // One proc of a three-rune cast, as General emits it (238: the event per rune id, `first` on the first).
  query("league:pact-regenerated", { player: pacts, kind: "rune", itemId: I().DEATH_RUNE, amount: 4, combat: true, first: true });
  query("league:pact-regenerated", { player: pacts, kind: "rune", itemId: I().BLOOD_RUNE, amount: 2, combat: true, first: false });
  query("league:pact-regenerated", { player: pacts, kind: "rune", itemId: I().WATER_RUNE, amount: 6, combat: true, first: false });
  assert.equal(level(pacts, core.Skill.MAGIC), 100);
  ticks(31);
});

test("an earth-rune Defence boost on top of the permanent Defence pact expires back to the pact's level", () => {
  const { pacts } = cast("earthondefence", "talent_earthrune_regen_defence_boost", ["talent_defence_boost", 1]);
  query("league:pact-unlocked", { player: pacts, node: 0, effect: "talent_defence_boost" });
  const boosted = 99 + Common.effect(pacts, "talent_defence_boost");
  assert.equal(level(pacts, core.Skill.DEFENCE), boosted);
  regen(pacts, "rune", I().EARTH_RUNE, 5);
  assert.equal(level(pacts, core.Skill.DEFENCE), boosted + 5);
  ticks(31);
  assert.equal(level(pacts, core.Skill.DEFENCE), boosted, "only the earth runes' 5 taken back");
});
