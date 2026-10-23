// Run after `yarn build`: node --test tests/melee-weapon-specials.test.cjs
// Specials of the battleaxe, two-handed sword, mace, warhammer, axe and harpoon families.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Skill } = require("../dist/game/model/Skill");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { World } = require("../dist/game/World");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const core = PluginManager.getCoreApi();

function load(file, overrides) {
  require(`../plugins/combat/specials/${file}.SpecialAttack`)({
    core: overrides ? { ...core, ...overrides } : core,
    registerCombatSpecial: CombatSpecial.register,
  });
}

const FILES = [
  "DragonBattleaxe", "Dragon2hSword", "DragonMace", "BarrelchestAnchor", "DragonWarhammer",
  "StatiusWarhammer", "ArmadylGodsword", "BandosGodsword", "SaradominGodsword", "ZamorakGodsword",
  "DragonAxe", "DragonHarpoon",
];
for (const file of FILES) load(file);
const tasks = [];
load("AncientGodsword", { TaskManager: { submit: (task) => tasks.push(task) } });

const special = (id) => CombatSpecial.getById(id);

// Levels are given by Skill name; Skill members are objects, so they are keyed by index.
function skills(levelsByName) {
  const max = {};
  const current = {};
  for (const [name, level] of Object.entries(levelsByName)) {
    max[Skill[name].index] = current[Skill[name].index] = level;
  }
  return {
    level: (name) => current[Skill[name].index],
    setLevel: (name, level) => { current[Skill[name].index] = level; },
    getCurrentLevel: (skill) => current[skill.index],
    getMaxLevel: (skill) => max[skill.index],
    setCurrentLevels: (skill, level) => { current[skill.index] = level; },
  };
}

function fakePlayer({ weaponId, energy = 100, levels = {} }) {
  const calls = { orb: 0, state: [], animations: [], graphics: [], chat: [], messages: [] };
  const player = {
    calls,
    skillManager: skills(levels),
    special: CombatSpecial.getForWeaponId(weaponId),
    activated: false,
    energy,
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getCombatSpecial() { return this.special; },
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(value) { this.activated = value; },
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getDueling: () => ({ inDuel: () => false }),
    getEquipment: () => ({ get: () => ({ getId: () => weaponId }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getPacketSender: () => ({
      updateSpecialAttackOrb: () => { calls.orb++; },
      sendSpecialAttackState: (on) => { calls.state.push(on); },
    }),
    getSkillManager() { return this.skillManager; },
    sendMessage: (message) => calls.messages.push(message),
    forceChat: (message) => { calls.chat.push(message); },
    performAnimation: (animation) => { calls.animations.push(animation); },
    performGraphic: (graphic) => { calls.graphics.push(graphic); },
  };
  return player;
}

function playerTarget(levels) {
  return {
    skillManager: skills(levels),
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getSkillManager() { return this.skillManager; },
  };
}

function npcTarget(defence) {
  return {
    defence,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc() { return this; },
    getCurrentLevel() { return this.defence; },
    setCurrentLevels(skill, level) { this.defence = Math.max(0, level); },
    getDefenceLevel() { return this.defence; },
    setDefenceLevel(level) { this.defence = Math.max(0, level); },
  };
}

function hit(target, damage, accurate = true, attacker = null) {
  return {
    isAccurate: () => accurate,
    getTotalDamage: () => damage,
    getTarget: () => target,
    getAttacker: () => attacker ?? fakePlayer({ weaponId: 0 }),
  };
}

test("each special is registered for its weapons with the wiki energy cost and multipliers", () => {
  const expectations = [
    ["dragon_battleaxe", [ItemIdentifiers.DRAGON_BATTLEAXE], 100],
    ["dragon_2h_sword", [ItemIdentifiers.DRAGON_2H_SWORD], 60],
    ["dragon_mace", [ItemIdentifiers.DRAGON_MACE], 25],
    ["barrelchest_anchor", [ItemIdentifiers.BARRELCHEST_ANCHOR], 50],
    ["dragon_warhammer", [ItemIdentifiers.DRAGON_WARHAMMER], 50],
    ["statius_warhammer", [ItemIdentifiers.STATIUSS_WARHAMMER], 35],
    ["armadyl_godsword", [ItemIdentifiers.ARMADYL_GODSWORD], 50],
    ["bandos_godsword", [ItemIdentifiers.BANDOS_GODSWORD], 50],
    ["saradomin_godsword", [ItemIdentifiers.SARADOMIN_GODSWORD], 50],
    ["zamorak_godsword", [ItemIdentifiers.ZAMORAK_GODSWORD], 50],
    ["ancient_godsword", [ItemIdentifiers.ANCIENT_GODSWORD], 50],
    ["dragon_axe", [ItemIdentifiers.DRAGON_AXE, ItemIdentifiers.INFERNAL_AXE, ItemIdentifiers.CRYSTAL_AXE], 100],
    ["dragon_harpoon", [ItemIdentifiers.DRAGON_HARPOON, ItemIdentifiers.INFERNAL_HARPOON, ItemIdentifiers.CRYSTAL_HARPOON], 100],
  ];
  for (const [id, items, drain] of expectations) {
    const found = special(id);
    assert.ok(found, id);
    assert.equal(found.getDrainAmount(), drain, `${id} energy`);
    for (const item of items) assert.equal(CombatSpecial.getForWeaponId(item), found, `${id} covers ${item}`);
  }
  assert.equal(special("dragon_mace").getAccuracyMultiplier(), 1.25);
  assert.equal(special("dragon_mace").getStrengthMultiplier(), 1.5);
  assert.equal(special("dragon_warhammer").getTraits().damageMultiplier, 1.5);
  assert.equal(special("barrelchest_anchor").getTraits().accuracyMultiplier, 2);
  assert.equal(special("barrelchest_anchor").getTraits().damageMultiplier, 1.1);
  assert.deepEqual(special("statius_warhammer").getTraits().minimumDamageMultiplier, 0.25);
  assert.deepEqual(special("statius_warhammer").getTraits().maximumDamageMultiplier, 1.25);
});

test("godswords double accuracy, roll slash defence and stage the hidden 1.1x boost", () => {
  assert.deepEqual(special("armadyl_godsword").getTraits().damageMultiplierStages, [1.1, 1.25]);
  assert.deepEqual(special("bandos_godsword").getTraits().damageMultiplierStages, [1.1, 1.1]);
  for (const id of ["saradomin_godsword", "zamorak_godsword", "ancient_godsword"]) {
    assert.equal(special(id).getTraits().damageMultiplier, 1.1, id);
  }
  for (const id of ["armadyl_godsword", "bandos_godsword", "saradomin_godsword", "zamorak_godsword", "ancient_godsword"]) {
    assert.equal(special(id).getTraits().accuracyMultiplier, 2, id);
    assert.equal(special(id).getTraits().meleeDefenceBonusIndex, 1, id);
  }
});

test("activating Rampage drains energy once, updates the bar and applies the stat swap", () => {
  const player = fakePlayer({
    weaponId: ItemIdentifiers.DRAGON_BATTLEAXE,
    levels: {
      ATTACK: 90, DEFENCE: 90, RANGED: 90, MAGIC: 90, STRENGTH: 90,
    },
  });
  CombatSpecial.activate(player);
  assert.equal(player.energy, 0, "all 100% spent exactly once");
  assert.equal(player.activated, false, "an instant special never stays lit");
  assert.ok(player.calls.orb >= 1 && player.calls.state.length >= 1, "the bar was refreshed");
  const levels = player.skillManager;
  for (const name of ["ATTACK", "DEFENCE", "RANGED", "MAGIC"]) assert.equal(levels.level(name), 81);
  assert.equal(levels.level("STRENGTH"), 109, "wiki example: 90s give +10 + 36/4 = +19");
  assert.deepEqual(player.calls.chat, ["Raarrrrrgggggghhhhhhh!"]);
  assert.equal(player.calls.animations[0].getId(), 1056);
  assert.equal(player.calls.graphics[0].getId(), 246);
});

test("an instant special without enough energy changes nothing", () => {
  const player = fakePlayer({
    weaponId: ItemIdentifiers.DRAGON_BATTLEAXE,
    energy: 99,
    levels: { ATTACK: 90, DEFENCE: 90, RANGED: 90, MAGIC: 90, STRENGTH: 90 },
  });
  CombatSpecial.activate(player);
  assert.equal(player.energy, 99);
  assert.equal(player.skillManager.level("STRENGTH"), 90);
  assert.equal(player.skillManager.level("ATTACK"), 90);
  assert.deepEqual(player.calls.chat, []);
  assert.deepEqual(player.calls.messages, ["You do not have enough special attack energy left!"]);
});

test("a swing special lights on the first press and toggling it off cancels without spending energy", () => {
  const player = fakePlayer({ weaponId: ItemIdentifiers.DRAGON_WARHAMMER });
  CombatSpecial.activate(player);
  assert.equal(player.activated, true);
  CombatSpecial.activate(player);
  assert.equal(player.activated, false);
  assert.equal(player.energy, 100, "nothing is drained until the swing");
});

test("Lumber Up and Fishstabber boost three levels, burn all the energy and never lower a bigger boost", () => {
  const axe = fakePlayer({ weaponId: ItemIdentifiers.DRAGON_AXE, levels: { WOODCUTTING: 70 } });
  CombatSpecial.activate(axe);
  assert.equal(axe.energy, 0);
  assert.equal(axe.skillManager.level("WOODCUTTING"), 73);
  assert.deepEqual(axe.calls.chat, ["Chop chop!"]);
  assert.equal(axe.calls.animations[0].getId(), 2876);
  assert.equal(axe.calls.graphics[0].getId(), 479);

  const crystal = fakePlayer({ weaponId: ItemIdentifiers.CRYSTAL_AXE, levels: { WOODCUTTING: 70 } });
  CombatSpecial.activate(crystal);
  assert.equal(crystal.calls.graphics[0].getId(), 1689);

  const harpoon = fakePlayer({ weaponId: ItemIdentifiers.INFERNAL_HARPOON, levels: { FISHING: 80 } });
  harpoon.skillManager.setLevel("FISHING", 85);
  CombatSpecial.activate(harpoon);
  assert.equal(harpoon.energy, 0);
  assert.equal(harpoon.skillManager.level("FISHING"), 85, "a bigger existing boost stays");
  assert.deepEqual(harpoon.calls.chat, ["Here fishy fishies!"]);
  assert.equal(harpoon.calls.animations[0].getId(), 7394);
});

test("the infernal axe burns a third of its logs for half Firemaking XP and spends one charge", () => {
  const InfernalAxe = require("../plugins/skills/woodcutting/InfernalAxe.Woodcutting");
  InfernalAxe.attach({
    core: { ...core, ItemIdentifiers },
    emitCustomEvent: (_name, request) => { request.xp = 100; },
  });
  const axe = {
    id: ItemIdentifiers.INFERNAL_AXE,
    meta: {},
    getId() { return this.id; },
    getMetaValue(key) { return this.meta[key]; },
    setMetaValue(key, value) { this.meta[key] = value; },
  };
  const xp = [];
  const player = {
    getEquipment: () => ({ getItems: () => Object.assign(new Array(14).fill(null), { [Equipment.WEAPON_SLOT]: axe }) }),
    getInventory: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
  };
  const random = Math.random;
  try {
    Math.random = () => 0.9;
    assert.equal(InfernalAxe.tryBurnLog(player, axe.id, 1511), false, "outside the 1 in 3 roll");
    Math.random = () => 0;
    assert.equal(InfernalAxe.tryBurnLog(player, axe.id, 1511), true);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(xp, [[Skill.FIREMAKING, 50]]);
  assert.equal(axe.meta["infernal-axe"].charges, 4999);
});

test("Smash lowers Defence by 30% (Statius 75%), on a successful accuracy roll, for players and NPCs", () => {
  const dwh = special("dragon_warhammer").getCombatMethod();
  const statius = special("statius_warhammer").getCombatMethod();

  const goblin = npcTarget(75);
  dwh.handleAfterHitEffects(hit(goblin, 20));
  assert.equal(goblin.defence, 53, "wiki: 75 Defence loses 22");
  dwh.handleAfterHitEffects(hit(goblin, 20));
  assert.equal(goblin.defence, 38, "wiki: then loses 15");
  dwh.handleAfterHitEffects(hit(goblin, 0));
  dwh.handleAfterHitEffects(hit(goblin, 20, false));
  assert.equal(goblin.defence, 27, "a successful zero still drains; a miss does not");

  const boss = npcTarget(100);
  statius.handleAfterHitEffects(hit(boss, 30));
  assert.equal(boss.defence, 25);
  statius.handleAfterHitEffects(hit(boss, 30, false));
  statius.handleAfterHitEffects(hit(boss, 0));
  assert.equal(boss.defence, 7);

  const pker = playerTarget({ DEFENCE: 99 });
  statius.handleAfterHitEffects(hit(pker, 30));
  assert.equal(pker.skillManager.level("DEFENCE"), 25, "99 - floor(74.25)");
});

test("Warstrike drains Defence, Strength, Prayer, Attack, Magic then Ranged by the damage dealt", () => {
  const bandos = special("bandos_godsword").getCombatMethod();
  const target = playerTarget({
    DEFENCE: 20, STRENGTH: 50, PRAYER: 20, ATTACK: 50, MAGIC: 50, RANGED: 50,
  });
  bandos.handleAfterHitEffects(hit(target, 100));
  const levels = target.skillManager;
  assert.equal(levels.level("DEFENCE"), 1, "stats floor at 1");
  assert.equal(levels.level("STRENGTH"), 1);
  assert.equal(levels.level("PRAYER"), 0, "prayer can reach 0");
  assert.equal(levels.level("ATTACK"), 38, "100 - 19 - 49 - 20 = 12 left for Attack");
  assert.equal(levels.level("MAGIC"), 50);

  const npc = npcTarget(60);
  bandos.handleAfterHitEffects(hit(npc, 25));
  assert.equal(npc.defence, 35);
  bandos.handleAfterHitEffects(hit(npc, 0));
  assert.equal(npc.defence, 35);
});

test("Sunder drains 10% of the damage from Defence, then Attack, Ranged and Magic, never below 1", () => {
  const anchor = special("barrelchest_anchor").getCombatMethod();
  const target = playerTarget({ DEFENCE: 2, ATTACK: 50, RANGED: 50, MAGIC: 50 });
  anchor.handleAfterHitEffects(hit(target, 50));
  assert.equal(target.skillManager.level("DEFENCE"), 1, "Defence floors at 1");
  assert.equal(target.skillManager.level("ATTACK"), 46, "the remaining 4 falls to Attack");
  assert.equal(target.skillManager.level("RANGED"), 50);

  const npc = npcTarget(40);
  anchor.handleAfterHitEffects(hit(npc, 30));
  assert.equal(npc.defence, 37);
  anchor.handleAfterHitEffects(hit(npc, 9));
  assert.equal(npc.defence, 37, "under 10 damage drains nothing");
});

test("Healing Blade restores at least 10 Hitpoints and 5 Prayer, half and a quarter of the damage", () => {
  const sgs = special("saradomin_godsword").getCombatMethod();
  const attacker = fakePlayer({
    weaponId: ItemIdentifiers.SARADOMIN_GODSWORD,
    levels: { HITPOINTS: 99, PRAYER: 99 },
  });
  attacker.skillManager.setLevel("HITPOINTS", 50);
  attacker.skillManager.setLevel("PRAYER", 50);
  sgs.handleAfterHitEffects(hit({}, 8, true, attacker));
  assert.equal(attacker.skillManager.level("HITPOINTS"), 60);
  assert.equal(attacker.skillManager.level("PRAYER"), 55);
  sgs.handleAfterHitEffects(hit({}, 60, true, attacker));
  assert.equal(attacker.skillManager.level("HITPOINTS"), 90);
  assert.equal(attacker.skillManager.level("PRAYER"), 70);
  sgs.handleAfterHitEffects(hit({}, 0, true, attacker));
  assert.equal(attacker.skillManager.level("HITPOINTS"), 90, "no damage, no heal");
});

test("Ice Cleave freezes for 32 ticks on a hit only", () => {
  const registered = [];
  const target = {
    getTimers: () => ({ has: () => false, registers: (key, ticks) => registered.push(ticks) }),
    getSize: () => 1,
    hasFlag: () => false,
    getMovementQueue: () => ({ reset() {} }),
    isPlayer: () => false,
    performGraphic() {},
  };
  const zgs = special("zamorak_godsword").getCombatMethod();
  zgs.handleAfterHitEffects(hit(target, 0, false));
  assert.equal(registered.length, 0);
  zgs.handleAfterHitEffects(hit(target, 10, true));
  assert.equal(Math.round(registered[0]), 32);
});

test("Blood Sacrifice heals 15% of the target's max Hitpoints, capped at 25 on NPCs and 15 on players", () => {
  const ags = special("ancient_godsword").getCombatMethod();
  const run = (target) => {
    tasks.length = 0;
    const healed = [];
    const pending = [];
    const attacker = {
      isPlayer: () => true,
      isRegistered: () => true,
      getHitpoints: () => 99,
      calculateDistance: () => 1,
      heal: (amount) => healed.push(amount),
    };
    Object.assign(target, {
      isRegistered: () => true,
      getHitpoints: () => 100,
      sendMessage() {},
      performGraphic() {},
      getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => pending.push(hits) }) }),
    });
    ags.handleAfterHitEffects(hit(target, 30, true, attacker));
    assert.equal(tasks.length, 1, "the mark waits eight ticks");
    tasks[0].execute();
    return { healed, pending };
  };
  const npc = { isPlayer: () => false, isNpc: () => true, getAsNpc() { return this; }, getMaxHitpoints: () => 500 };
  const big = run(npc);
  assert.deepEqual(big.healed, [25]);
  assert.equal(big.pending.length, 1, "25 damage is queued once");
  const small = { isPlayer: () => false, isNpc: () => true, getAsNpc() { return this; }, getMaxHitpoints: () => 100 };
  assert.deepEqual(run(small).healed, [15]);
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
    getSkillManager: () => ({ getMaxLevel: () => 99 }),
  };
  assert.deepEqual(run(player).healed, [14], "floor(99 * 0.15)");
});
