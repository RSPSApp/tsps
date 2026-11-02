// Run after `yarn build`: node --test tests/league-pacts-overlaps.test.cjs
// Demonic Pacts' pacts against the rest of combat (docs/leagues.md, Demonic Pacts): the order the
// pacts' strength and min-hit changes take beside set effects (Obsidian, Dharok), a special's
// multiplier, thralls' and the Minion's plain damage, and the PvP limits the Wiki gives.
// The pacts' modifiers go into the real core here, so the core's own formulas are what is checked.
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
const EquipmentEffects = require("../dist/game/content/combat/EquipmentEffects");

let core;
let Common;
const hooks = {};
const custom = {};
let worldLeague = 6;
const realRandom = Math.random;

const ITEMS = { toktzXilAk: 6523, berserkerNecklace: 11128, dragonDagger: 1215, whip: 4151, elderMaul: 21003, runeKiteshield: 1201 };
const HILL_GIANT = 2098;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (event) => { for (const attached of lists[name]) attached(event); };
  };
  // The pacts' modifiers and the set effects' go into the real core, as in game.
  const forward = {
    registerMeleeStrengthBonusModifier: EquipmentEffects.registerMeleeStrengthBonusModifier,
    registerMeleeHitModifier: EquipmentEffects.registerMeleeHitModifier,
    registerRangedHitModifier: EquipmentEffects.registerRangedHitModifier,
    registerMagicHitModifier: EquipmentEffects.registerMagicHitModifier,
    registerMeleeAttackAccuracyModifier: EquipmentEffects.registerMeleeAttackAccuracyModifier,
    registerRangedAttackAccuracyModifier: EquipmentEffects.registerRangedAttackAccuracyModifier,
    registerMagicAttackAccuracyModifier: EquipmentEffects.registerMagicAttackAccuracyModifier,
    registerRestingLevelModifier: (modifier) => SkillManager.registerRestingLevelModifier(modifier),
  };
  const api = new Proxy({
    core,
    ...forward,
    persistAttribute() {},
    getSkillManager: () => SkillManager,
    getCombatFactory: () => core.CombatFactory,
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    registerCommand: () => {},
    onInterfaceActionButton: () => {},
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  custom["quest:is-complete"] = [(request) => { request.complete = false; }];
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueTasks.plugin").register(api);
  require("../plugins/modes/LeaguePacts.plugin").register(api);
  require("../plugins/combat/effects/ObsidianArmour.EquipmentEffects")(api);
  require("../plugins/combat/effects/DharoksArmour.EquipmentEffects")(api);
  require("../plugins/combat/effects/SalveAmulet.EquipmentEffects")({ ...forward, onCustomEvent: () => {}, registerMagicDamageBonusModifier: () => {} });
  require("../plugins/combat/effects/InquisitorsArmour.EquipmentEffects")(forward);
  require("../plugins/items/VoidEquipment.plugin").register({ core, registerCombatEffectiveLevelModifier: EquipmentEffects.registerCombatEffectiveLevelModifier,
    registerMagicDamageBonusModifier: () => {}, onCustomEvent: () => {}, onPlayerLogin: () => {} });
  require("../plugins/items/SlayerHelmet.plugin").register({ ...forward, core,
    emitCustomEvent: (name, request) => { if (name === "slayer:on-task") request.onTask = true; },
    onItemOnItem() {}, onItemAction() {}, onCustomEvent() {} });
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  require("../plugins/combat/specials/DragonDagger.SpecialAttack")({ core, registerCombatSpecial: CombatSpecial.register, emitCustomEvent: () => {} });
  Common = require("../plugins/modes/leaguepacts/Common.LeaguePacts");
});

afterEach(() => {
  Math.random = realRandom;
  worldLeague = 6;
});

function character(name, { profile = "league", league = 6, effects = {} } = {}) {
  worldLeague = league;
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
  worldLeague = 6;
  const skills = player.getSkillManager();
  for (const skill of [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC, Skill.HITPOINTS, Skill.PRAYER]) {
    skills.setMaxLevels(skill, 99, false);
    skills.setCurrentLevels(skill, 99, false);
  }
  player.setHitpoints(99);
  player.getFightType = () => ({ getStyle: () => core.FightStyle.ACCURATE, getBonusType: () => core.BonusManager.ATTACK_SLASH });
  const owned = [];
  for (const [effect, count] of Object.entries(effects)) {
    owned.push(...Common.nodes.filter((node) => node.varbit === effect).slice(0, count).map((node) => node.index));
  }
  if (owned.length) Common.save(player, owned);
  return player;
}

/** The same pacts on a Demonic Pacts character, a Raging Echoes one and a main. */
function cast(name, effects) {
  return {
    holder: character(name, { effects }),
    others: [character(`${name}-echoes`, { league: 5, effects }), character(`${name}-main`, { profile: "main", effects })],
  };
}

function equip(player, slot, id) {
  player.getEquipment().setItem(slot, new core.Item(id, 1));
  core.BonusManager.update(player);
}

/** The melee max hit formula at 99 Strength, accurate style: (107 x (bonus + 64) + 320) / 640. */
const formula = (strengthBonus) => Math.floor((107 * (strengthBonus + 64) + 320) / 640);

test("the prayer-bonus pact's strength enters the formula before Obsidian's set and Berserker necklace multipliers", () => {
  const { holder, others } = cast("overlap-obsidian", { talent_melee_strength_prayer_bonus: 1 });
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.toktzXilAk);
    equip(player, core.Equipment.AMULET_SLOT, ITEMS.berserkerNecklace);
  }
  const worn = holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH];
  for (const player of [holder, ...others]) player.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] = 12;
  // Berserker necklace: x6/5 rounded down, after the formula (ObsidianArmour.EquipmentEffects).
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(holder), Math.floor((formula(worn + 6) * 6) / 5), "+6 strength (50% of 12), then x6/5");
  for (const other of others) assert.equal(core.DamageFormulas.calculateMaxMeleeHit(other), Math.floor((formula(worn) * 6) / 5));
});

test("a special's strength multiplier scales the Strength-level pact's strength like worn strength", () => {
  const { holder, others } = cast("overlap-special", { talent_multi_hit_str_increase: 1 });
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.dragonDagger);
    core.CombatSpecial.assign(player);
  }
  assert.ok(holder.getCombatSpecial(), "the dragon dagger's special is assigned");
  const worn = holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH];
  const plain = core.DamageFormulas.calculateMaxMeleeHit(holder, false);
  assert.equal(plain, formula(worn + 19), "a light weapon: +20% of 99 Strength, 19");
  const special = core.DamageFormulas.calculateMaxMeleeHit(holder, true);
  const otherSpecial = core.DamageFormulas.calculateMaxMeleeHit(others[1], true);
  const multiplier = holder.getCombatSpecial().getStrengthMultiplier();
  assert.equal(multiplier, 1.15, "the dragon dagger's special: x1.15 (Wiki)");
  assert.equal(otherSpecial, Math.floor(formula(worn) * multiplier), "nobody else: the worn strength alone");
  assert.equal(special, Math.floor(formula(worn + 19) * multiplier), "the special's multiplier applies to the formula with the pact's strength in it");
});

test("Dharok's set effect multiplies the rolled hit after the min-hit pact raised it, so the two stack once", () => {
  const { holder, others } = cast("overlap-dharok", { talent_distance_melee_minhit: 1 });
  const target = new NPC(HILL_GIANT, new Location(3200, 3203, 0));
  const fullDharoks = core.CombatFactory.fullDharoks;
  core.CombatFactory.fullDharoks = () => true;
  try {
    for (const player of [holder, ...others]) {
      player.setHitpoints(49);
      const rolled = { attacker: player, target, combatType: core.CombatType.MELEE, damage: 0, minimum: 0, maximum: 30 };
      for (const handler of custom["combat:hit-rolled"]) handler(rolled);
      const damage = new core.HitDamage(rolled.damage, core.HitMask.RED);
      hooks.onCombatHitDamage({ attacker: player, target, combatType: core.CombatType.MELEE, damage, accurate: true });
      // 2 tiles to the giant's footprint: +3 + 3 = 6 minimum; Dharok's 1 + 50 x 99 / 10000 = 1.495.
      if (player === holder) assert.equal(damage.getDamage(), Math.floor(rolled.damage * (1 + (50 * 99) / 10000)));
      if (player === holder) assert.ok(rolled.damage >= 6, `the min hit pact raised the roll to ${rolled.damage}`);
      else assert.equal(rolled.damage, 0, "nobody else's roll moves");
    }
  } finally {
    core.CombatFactory.fullDharoks = fullDharoks;
  }
});

test("thralls' and the Minion's damage is plain pending damage: none of the pact hooks hear it", () => {
  const holder = character("overlap-thrall", {
    effects: { talent_light_weapon_doublehit: 1, talent_hit_restore_spec_energy: 1, talent_regen_ammo_chance: 1, talent_2h_melee_echos: 1 },
  });
  const target = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
  const counted = { roll: 0, damage: 0, dealt: 0, resolved: 0 };
  const saved = {};
  for (const [name, key] of [["emitCombatHitRoll", "roll"], ["emitCombatHitDamage", "damage"], ["emitPlayerDealtDamage", "dealt"], ["emitCombatHitResolved", "resolved"]]) {
    saved[name] = PluginManager[name];
    PluginManager[name] = (...args) => { counted[key]++; return saved[name].apply(PluginManager, args); };
  }
  try {
    holder.setSpecialPercentage(50);
    // As ArceuusThralls and Minion.LeagueRelics deal it: a HitDamage sourced to the player.
    const hit = new core.HitDamage(5, core.HitMask.RED).setSource(holder);
    target.getCombat().getHitQueue().addPendingDamage([hit]);
    for (let i = 0; i < 3; i++) target.getCombat().getHitQueue().process?.(target);
  } finally {
    Object.assign(PluginManager, saved);
  }
  assert.deepEqual(counted, { roll: 0, damage: 0, dealt: 0, resolved: 0 });
  assert.equal(holder.getSpecialPercentage(), 50, "no melee pact restored energy");
});

test("PvP: stat boosts apply against players; Thorns, Echoes and Blindbag never do (Wiki)", () => {
  const { holder } = cast("overlap-pvp", {
    talent_all_style_accuracy: 1, talent_thorns_damage: 1, talent_free_random_weapon_attack_chance: 1,
    talent_2h_melee_echos: 1, talent_crossbow_echo_reproc_chance: 1, talent_defence_boost: 1,
  });
  const victim = character("overlap-pvp-victim");
  victim.setLocation(new Location(3200, 3201, 0));
  // Stat boosts: the accuracy pact's 25% on a roll against a player, the Defence pact's level.
  assert.equal(EquipmentEffects.applyMeleeAttackAccuracyModifiers(holder, 10000), 12500);
  for (const handler of custom["league:pact-unlocked"]) handler({ player: holder, node: 0, effect: "talent_defence_boost" });
  assert.equal(holder.getSkillManager().getCurrentLevel(Skill.DEFENCE), 104);
  // Thorns: a player's attack on a shield wearer is not answered.
  equip(holder, core.Equipment.SHIELD_SLOT, ITEMS.runeKiteshield);
  const reflected = [];
  victim.getCombat().getHitQueue().addPendingDamage = (hits) => reflected.push(...hits);
  hooks.onCombatHitResolved({ attacker: victim, target: holder, hit: {
    getCombatType: () => core.CombatType.MELEE, getHits: () => [new core.HitDamage(0, core.HitMask.BLUE)], getTotalDamage: () => 0, isAccurate: () => false,
  } });
  assert.equal(reflected.length, 0, "no Thorns on a player");
  // Blindbag and the two-handed echo: a heavy two-hander's hit on a player triggers neither.
  equip(holder, core.Equipment.SHIELD_SLOT, -1);
  equip(holder, core.Equipment.WEAPON_SLOT, ITEMS.elderMaul);
  holder.getInventory().add(new core.Item(ITEMS.elderMaul, 1));
  Math.random = () => 0;
  const queued = [];
  const addPendingHit = core.CombatFactory.addPendingHit;
  core.CombatFactory.addPendingHit = (hit) => queued.push(hit);
  const echoes = [];
  custom["league:pact-ranged-echo"] = (custom["league:pact-ranged-echo"] ?? []).concat((event) => echoes.push(event));
  try {
    const hit = { getCombatType: () => core.CombatType.MELEE, getHits: () => [new core.HitDamage(5, core.HitMask.RED)], getTotalDamage: () => 5, isAccurate: () => true, getDelay: () => 0 };
    hooks.onPlayerDealtDamage({ player: holder, target: victim, hit });
    hooks.onCombatHitResolved({ attacker: holder, target: victim, hit });
  } finally {
    core.CombatFactory.addPendingHit = addPendingHit;
  }
  assert.equal(queued.length, 0, "no Blindbag on a player");
  assert.equal(echoes.length, 0, "no Ranged echo on a player");
});

const I = () => core.ItemIdentifiers;
const undead = () => ({ isNpc: () => true, getAsNpc() { return this; }, getCurrentDefinition: () => ({ hasAttribute: (name) => name === "undead" }) });

test("the melee damage pacts and a salve amulet each apply once, in the core's order: the pacts' % then the salve's x7/6", () => {
  const { holder, others } = cast("overlap-salve", { talent_percentage_melee_damage: 3 });
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.whip);
    equip(player, core.Equipment.AMULET_SLOT, I().SALVE_AMULET);
    const target = undead();
    player.getCombat().getTarget = () => target;
  }
  const worn = holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH];
  const base = formula(worn);
  assert.notEqual(Math.floor((base * 7) / 6), base, "the salve shows in the max hit");
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(holder), Math.floor((Math.floor((base * 103) / 100) * 7) / 6), "+3% (three nodes), then x7/6");
  for (const other of others) assert.equal(core.DamageFormulas.calculateMaxMeleeHit(other), Math.floor((base * 7) / 6), "the salve alone");
});

test("Inquisitor's crush bonus and the strength pacts: the pact's strength in the formula, the set's +2.5% on the result", () => {
  const { holder, others } = cast("overlap-inquisitor", { talent_melee_strength_prayer_bonus: 1 });
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.elderMaul);
    for (const [slot, id] of [[core.Equipment.HEAD_SLOT, I().INQUISITORS_GREAT_HELM], [core.Equipment.BODY_SLOT, I().INQUISITORS_HAUBERK], [core.Equipment.LEG_SLOT, I().INQUISITORS_PLATESKIRT]]) equip(player, slot, id);
    player.getFightType = () => ({ getStyle: () => core.FightStyle.ACCURATE, getBonusType: () => core.BonusManager.ATTACK_CRUSH });
    player.getBonusManager().getOtherBonus()[core.BonusManager.PRAYER] = 10;
  }
  const worn = holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH];
  assert.equal(EquipmentEffects.applyMeleeHitModifiers(others[1], 1000), 1025, "the full set with crush: +2.5% (Wiki)");
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(holder), Math.floor(formula(worn + 5) * 1.025), "+5 strength (50% of 10), then x1.025");
  for (const other of others) assert.equal(core.DamageFormulas.calculateMaxMeleeHit(other), Math.floor(formula(worn) * 1.025));
});

test("Void's +10% effective Strength and the Strength-level pact: both in the formula, once each", () => {
  const { holder, others } = cast("overlap-void", { talent_multi_hit_str_increase: 1 });
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.whip);
    for (const [slot, id] of [[core.Equipment.HEAD_SLOT, I().VOID_MELEE_HELM], [core.Equipment.BODY_SLOT, I().VOID_KNIGHT_TOP],
      [core.Equipment.LEG_SLOT, I().VOID_KNIGHT_ROBE], [core.Equipment.HANDS_SLOT, I().VOID_KNIGHT_GLOVES]]) equip(player, slot, id);
  }
  const worn = holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH];
  const voidFormula = (bonus) => Math.floor((Math.floor((107 * 110) / 100) * (bonus + 64) + 320) / 640);
  assert.notEqual(voidFormula(worn), formula(worn), "Void's boost shows in the max hit");
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(holder), voidFormula(worn + 19), "effective level 117, strength bonus + 19");
  for (const other of others) assert.equal(core.DamageFormulas.calculateMaxMeleeHit(other), voidFormula(worn));
});

test("Executioner's ranged reach is not the melee range pacts': a ranged attack's distance is left to the relic", () => {
  const { holder } = cast("overlap-executioner", { talent_melee_range_multiplier: 1, talent_melee_range_conditional_boost: 1 });
  equip(holder, core.Equipment.WEAPON_SLOT, ITEMS.elderMaul);
  const ranged = { attacker: holder, combatType: core.CombatType.RANGED, distance: 6 };
  hooks.onCombatAttackDistance(ranged);
  assert.equal(ranged.distance, 6, "the axe's 6 stays 6: no doubling, no 7");
  const melee = { attacker: holder, combatType: core.CombatType.MELEE, distance: 1 };
  hooks.onCombatAttackDistance(melee);
  assert.equal(melee.distance, 2, "a two-hander's melee reach doubles");
});

test("the melee damage pacts and a slayer helmet on task each apply once: the pacts' % then the helmet's x7/6", () => {
  const { holder, others } = cast("overlap-slayer", { talent_percentage_melee_damage: 2 });
  const target = new NPC(HILL_GIANT, new Location(3200, 3201, 0));
  for (const player of [holder, ...others]) {
    equip(player, core.Equipment.WEAPON_SLOT, ITEMS.whip);
    equip(player, core.Equipment.HEAD_SLOT, I().SLAYER_HELMET);
    player.getCombat().getTarget = () => target;
  }
  const base = formula(holder.getBonusManager().getOtherBonus()[core.BonusManager.STRENGTH]);
  assert.equal(EquipmentEffects.applyMeleeHitModifiers(others[1], 600), 700, "the helmet on task: x7/6");
  assert.equal(core.DamageFormulas.calculateMaxMeleeHit(holder), Math.floor((Math.floor((base * 102) / 100) * 7) / 6), "+2%, then x7/6");
  for (const other of others) assert.equal(core.DamageFormulas.calculateMaxMeleeHit(other), Math.floor((base * 7) / 6));
});
