// Run after `yarn build`: node --test tests/league-fragments.test.cjs
// Shattered Relics' fragments (docs/leagues.md "Shattered Relics"): fragment XP and levels, set
// tiers, the Unidentified fragment drops and Break, and the combat fragments' and sets' effects,
// with real players.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { GameConstants } = require("../dist/game/GameConstants");
const { World } = require("../dist/game/World");
const EquipmentEffects = require("../dist/game/content/combat/EquipmentEffects");
const { PacketSender } = require("../dist/net/packet/PacketSender");

const uid = (group, child) => (group << 16) | child;
const CLASS = 737;
const FRAGMENTS = 735;
const SLOT_VARBITS = [13395, 13396, 13397, 13398, 13399, 13401, 13402];
const fragmentVarbit = (id) => 13403 + id - 1;
const ITEMS = { harvesting: 26544, production: 26545, skilling: 26546, combat: 26547, misc: 26548 };

let core;
let Fragments;
let Effects;
let Drops;
const hooks = {};
const custom = {};
const itemActions = {};
let worldLeague = 3;
const tasks = [];
const spawned = [];
const realRandom = Math.random;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  GameConstants.setWorldProfile("league");
  const lists = {};
  const on = (name) => (handler) => {
    (lists[name] ??= []).push(handler);
    hooks[name] = (...args) => {
      let result;
      for (const attached of lists[name]) {
        const answer = attached(...args);
        if (answer !== undefined) result = answer;
      }
      return result;
    };
  };
  const api = new Proxy({
    core,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => (key === "league:type" ? worldLeague : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getTaskManager: () => ({ submit: (task) => tasks.push(task) }),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) {
        const key = `button:${id}`;
        (lists[key] ??= []).push(handler);
        hooks[key] = (event) => {
          for (const attached of lists[key]) {
            if (attached(event) !== false) return (event.handled = true);
          }
          return false;
        };
      }
    },
    onItemAction: (name, actions) => Object.assign((itemActions[name] ??= {}), actions),
    // The core modifiers batch 2 added are wired as PluginManager wires them, so core runs them.
    registerSpecialEnergyCostModifier: (modifier) => EquipmentEffects.registerSpecialEnergyCostModifier(modifier),
    registerPrayerDrainRateModifier: (modifier) => EquipmentEffects.registerPrayerDrainRateModifier(modifier),
    spawnNpc: (definition) => (spawned.push(definition), { getCombat: () => ({ attack() {} }) }),
    onCustomEvent: (name, handler) => (custom[name] = (custom[name] ?? []).concat(handler)),
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/Base.LeagueMode").register(api);
  require("../plugins/modes/Points.LeagueMode").register(api);
  // The plugins batch 2 asks only answer its events here; their own hooks go nowhere.
  const eventsOnly = new Proxy({ core, onCustomEvent: api.onCustomEvent, emitCustomEvent: api.emitCustomEvent, spawnNpc: api.spawnNpc, persistAttribute() {} },
    { get: (target, key) => (key in target ? target[key] : () => undefined) });
  require("../plugins/skills/Slayer.plugin").register(eventsOnly);
  require("../plugins/bosses/GodWars.plugin").register(eventsOnly);
  require("../plugins/items/CrystalHalberd.plugin").register(eventsOnly);
  Fragments = require("../plugins/modes/league/Fragments.LeagueMode");
  Effects = require("../plugins/modes/league/FragmentEffects.LeagueMode")._test;
  Drops = require("../plugins/modes/league/FragmentDrops.LeagueMode")._test;
});

afterEach(() => {
  Math.random = realRandom;
});

function character(name, { league = 3 } = {}) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile("league");
  const sent = { messages: [], varbits: new Map(), varps: new Map(), subs: [] };
  const sender = new Proxy({}, {
    get: (target, key) => {
      switch (key) {
        case "sendVarbit": return (id, value) => (sent.varbits.set(id, value), sender);
        case "sendConfig": return (id, value) => (sent.varps.set(id, value), sender);
        case "sendInterface": return (group) => (player.setInterfaceId(group), sent.subs.push(group), sender);
        case "sendInterfaceRemoval": return () => (player.setInterfaceId(-1), sender);
        default: return () => sender;
      }
    },
  });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.messages.push(text);
  const previous = worldLeague;
  worldLeague = league;
  hooks.onPlayerLogin({ player, username: name, isNewAccount: true, profile: "league" });
  worldLeague = previous;
  const loginTasks = tasks.splice(0);
  return Object.assign(player, { sent, loginTasks });
}

function click(player, group, child, extra = {}) {
  return hooks[`button:${uid(group, child)}`]({ player, buttonId: uid(group, child), ...extra });
}

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A Warrior (Unholy Warrior owned) with `points` League Points, so that many slots are open. */
function warrior(name, points = 0) {
  const player = character(name);
  player.setInterfaceId(CLASS);
  click(player, CLASS, 6);
  click(player, CLASS, 26);
  if (points) hooks["command:leaguetask"]({ player, parts: ["leaguetask", `points-${name}`, String(points)] });
  return player;
}

/** Equips in Catherby's bank, where fragments can change (Wiki /Fragments), and steps back out. */
function equip(player, ...ids) {
  const before = player.getLocation();
  player.setLocation(new core.Location(2809, 3440, 0));
  player.setInterfaceId(FRAGMENTS);
  for (const id of ids) {
    if (!(Number(Fragments._test.owned(player)[id]) > 0)) emit("league:grant-fragment", { player, id });
    click(player, FRAGMENTS, 18, { slot: 9 * (id - 1), opId: 2 });
  }
  player.setInterfaceId(-1);
  player.setLocation(before);
}

function setXp(player, id, xp) {
  player.setAttribute(Fragments._test.FRAGMENTS_ATTRIBUTE, { ...Fragments._test.owned(player), [id]: xp });
}

function gain(player, skill = "ATTACK", experience = 10) {
  hooks.onExperienceGained({ player, skill: core.Skill[skill], experience });
}

/** The inventory slot of the first item with this id. */
function slotOf(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item?.getId?.() === itemId);
}

/** Break on the first item with this id, as the client's inventory option sends it. */
function breakItem(player, itemId) {
  const slot = slotOf(player, itemId);
  const item = player.getInventory().getItems()[slot];
  return itemActions[core.CacheDefinitions.getItem(itemId).name].Break({ player, itemId, item, slot });
}

/** Swaps an object's members for the length of `action`. */
function stubbing(owner, stubs, action) {
  const saved = Object.fromEntries(Object.keys(stubs).map((key) => [key, owner[key]]));
  Object.assign(owner, stubs);
  try {
    return action();
  } finally {
    Object.assign(owner, saved);
  }
}

// ---- Fragment XP, levels, sets ----

test("equipped fragments gain 1 XP per XP gain, at most once every 4 ticks", () => {
  const player = warrior("gainer", 10);
  equip(player, 1);
  emit("league:grant-fragment", { player, id: 4 });
  World.processCycle = 1000;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 2);
  assert.equal(player.sent.varbits.get(fragmentVarbit(1)), 2, "its varbit follows");
  gain(player);
  World.processCycle = 1003;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 2, "not again within 4 ticks");
  World.processCycle = 1004;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 3);
  assert.equal(Fragments._test.owned(player)[4], 1, "an unequipped fragment doesn't gain");
});

test("levels follow script 5789's thresholds and stop at the last one", () => {
  const player = warrior("leveller");
  equip(player, 1);
  setXp(player, 1, 1999);
  assert.equal(Fragments.equippedLevel(player, 1), 1);
  World.processCycle = 2000;
  gain(player);
  assert.equal(Fragments.equippedLevel(player, 1), 2, "2,000 XP is level 2");
  setXp(player, 1, 7999);
  World.processCycle = 2010;
  gain(player);
  assert.equal(Fragments.equippedLevel(player, 1), 3);
  World.processCycle = 2020;
  gain(player);
  assert.equal(Fragments._test.owned(player)[1], 8000, "it stops at 8,000");
  assert.equal(Fragments.findable(player, 1), false, "and leaves the drop pool");
  assert.equal(Fragments.equippedLevel(player, 4), 0, "not equipped, no level");
});

test("a set's tier counts the equipped fragments that list it (enum 4137)", () => {
  const player = warrior("collector", 300);
  assert.equal(Fragments.setTier(player, 1), 0);
  equip(player, 9, 20);
  assert.equal(Fragments.setTier(player, 1), 1, "Absolute Unit: Divine Restoration and Saradominist Defence make 2 pieces");
  equip(player, 13);
  assert.equal(Fragments.setTier(player, 1), 2, "Venomaster makes 3: tier 2");
});

// ---- Drops and Break ----

test("skilling XP may turn up its category's Unidentified fragment; combat kills by the NPC's tier", () => {
  const player = warrior("finder");
  Math.random = () => 0;
  gain(player, "FISHING", 50);
  assert.equal(player.getInventory().contains(ITEMS.harvesting), true, "fishing: harvesting");
  gain(player, "COOKING", 50);
  assert.equal(player.getInventory().contains(ITEMS.production), true, "cooking: production");
  gain(player, "ATTACK", 50);
  assert.equal(player.getInventory().contains(ITEMS.combat), false, "combat XP rolls on kills instead");
  Math.random = () => 0.999;
  gain(player, "THIEVING", 50);
  assert.equal(player.getInventory().contains(ITEMS.skilling), false, "a miss drops nothing");
  Math.random = () => 0;
  const graardor = core.NpcDefinition.forId(2215);
  hooks.onNpcDeath({ killer: player, npc: { getCurrentDefinition: () => graardor, getDefinition: () => graardor } });
  assert.equal(player.getInventory().contains(ITEMS.combat), true);
  const dropped = player.getInventory().getItems()[slotOf(player, ITEMS.combat)];
  assert.equal(dropped.getMetaValue(Drops.TIER_META), 4, "General Graardor drops tier 4, kept on the item");
  assert.equal(Drops.tierOf("Goblin"), 1, "any other NPC is tier 1");
});

test("Break opens a fragment of the item's kind; a known one gains 500 XP instead", () => {
  const player = warrior("breaker");
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  Math.random = () => 0;
  breakItem(player, ITEMS.combat);
  assert.equal(player.getInventory().contains(ITEMS.combat), false, "the item is used");
  assert.equal(Fragments._test.owned(player)[17], 1, "a tier 4 fragment: Bandosian Might");
  assert.match(player.sent.messages.at(-1), /Bandosian Might/);
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  breakItem(player, ITEMS.combat);
  assert.equal(Fragments._test.owned(player)[17], 501, "a duplicate gives 500 XP");
  for (const id of [17, 18, 19, 20]) setXp(player, id, 8000);
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  breakItem(player, ITEMS.combat);
  assert.equal(Fragments.findable(player, 17), false);
  assert.equal(Fragments._test.owned(player)[8], 1, "a mastered tier falls to the nearest other (tier 3: Livin' On A Prayer)");
  for (const [category, item] of Object.entries(ITEMS)) {
    assert.ok(itemActions[core.CacheDefinitions.getItem(item).name]?.Break, `${category} has Break`);
  }
});

test("when every fragment of a kind is mastered, Break keeps the item", () => {
  const player = warrior("master");
  for (const id of [49, 50, 51, 52, 53]) setXp(player, id, 8000);
  hooks["command:fragment"]({ player, parts: ["fragment", "misc"] });
  breakItem(player, ITEMS.misc);
  assert.equal(player.getInventory().contains(ITEMS.misc), true);
  assert.match(player.sent.messages.at(-1), /mastered every fragment/);
});

test("each item opens into its own fragments and tiers, from the cache (params 1462 / 1454)", () => {
  const player = warrior("pools");
  const production = Drops.pool(player, ITEMS.production, 0);
  assert.ok(production.includes(35) && production.includes(36), "Enchanted Jeweler and Alchemaniac are production fragments");
  assert.deepEqual(Drops.pool(player, ITEMS.misc, 0).sort((a, b) => a - b), [49, 50, 51, 52, 53]);
  assert.deepEqual(Drops.pool(player, ITEMS.combat, 2).sort((a, b) => a - b), [2, 7, 12, 14], "tier 2");
  assert.deepEqual(Drops.pool(player, ITEMS.combat, 4).sort((a, b) => a - b), [17, 18, 19, 20], "tier 4");
  const all = [...Fragments.allDefinitions().values()];
  assert.equal(all.length, 53);
  assert.ok(all.every((row) => Object.values(ITEMS).includes(row.item)), "every fragment has an Unidentified fragment item");
  assert.ok(all.filter((row) => row.item === ITEMS.combat).every((row) => row.tier >= 1 && row.tier <= 4), "every combat fragment has a tier");
});

test("each combat item keeps its own tier: a destroyed one doesn't shift the next", () => {
  const player = warrior("destroyer");
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "2"] });
  hooks["command:fragment"]({ player, parts: ["fragment", "combat", "4"] });
  assert.equal(player.getInventory().getAmount(ITEMS.combat), 2, "two items");
  player.getInventory().deleteAtSlot(slotOf(player, ITEMS.combat), 1);
  Math.random = () => 0;
  breakItem(player, ITEMS.combat);
  assert.equal(Fragments._test.owned(player)[17], 1, "the tier 4 item still opens into tier 4");
  assert.equal(player.getInventory().contains(ITEMS.combat), false);
});

// ---- Effects ----

test("Unholy Warrior: melee accuracy up at 0 Prayer points only", () => {
  const player = warrior("unholy");
  equip(player, 1);
  const melee = Effects.accuracy("melee");
  const skills = player.getSkillManager();
  skills.setCurrentLevel(core.Skill.PRAYER, 1, false);
  assert.equal(melee(player, 1000), 1000, "with prayer points, no change");
  skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  assert.equal(melee(player, 1000), 1120, "level 1: +12%");
  setXp(player, 1, 8000);
  assert.equal(melee(player, 1000), 1300, "level 3: +30%");
  assert.equal(Effects.accuracy("ranged")(player, 1000), 1000, "only its own style");
});

test("Bottomless Quiver and Arcane Conduit save ammunition, runes and charges", () => {
  const player = warrior("saver", 10);
  equip(player, 4, 6);
  Math.random = () => 0;
  const bow = { player, weaponId: 841, saved: false };
  Effects.ammoSaving(bow);
  assert.equal(bow.saved, true, "a shortbow's arrow saved");
  const chin = { player, weaponId: 10033, saved: false };
  Effects.ammoSaving(chin);
  assert.equal(chin.saved, false, "not chinchompas");
  const runes = { player, saved: false };
  Effects.runeSaving(runes);
  assert.equal(runes.saved, true);
  const charge = { player, itemId: 11905, skip: false };
  Effects.chargeSaving(charge);
  assert.equal(charge.skip, false, "Arcane Conduit never saves a melee charge through the shared event");
  player.getCombat().setCastSpell(core.CombatSpells.WIND_STRIKE);
  Effects.chargeSaving(charge);
  assert.equal(charge.skip, true, "a powered staff's charge too");
  Math.random = () => 0.5;
  const miss = { player, saved: false };
  Effects.runeSaving(miss);
  assert.equal(miss.saved, false, "40% at level 1: a 50 roll misses");
});

test("Larger Recharger, Divine Restoration and Slay All Day", () => {
  const player = warrior("restorer", 300);
  equip(player, 11, 9, 14);
  assert.equal(Effects.specialRestore(player, 50), 41, "special energy every 41 ticks at level 1 (param 1456)");
  const skills = player.getSkillManager();
  skills.setMaxLevels(core.Skill.PRAYER, 10, false);
  skills.setCurrentLevel(core.Skill.PRAYER, 0, false);
  assert.equal(skills.getMaxLevel(core.Skill.PRAYER), 10);
  for (let tick = 0; tick < 24; tick++) Effects.perTick({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 0, "not before 25 ticks");
  Effects.perTick({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 1, "a prayer point every 15 s (25 ticks) at level 1");
  for (let tick = 0; tick < 25; tick++) Effects.perTick({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.PRAYER), 2);
  skills.setCurrentLevel(core.Skill.HITPOINTS, 5, false);
  Effects.slayerKill({ player });
  assert.equal(skills.getCurrentLevel(core.Skill.HITPOINTS), 6, "an on-task kill heals 1");
});

test("Absolute Unit and Drakan's Touch at their set tiers", () => {
  const player = warrior("unit", 300);
  equip(player, 9, 20);
  const hit = { damage: 20, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } };
  Effects.incomingDamage(player, hit, { attacker: { isNpc: () => true } });
  assert.equal(hit.damage, 14, "30% less from monsters at 2 pieces");
  const pvp = { damage: 20, getDamage() { return this.damage; }, setDamage(value) { this.damage = value; } };
  Effects.incomingDamage(player, pvp, { attacker: { isNpc: () => false } });
  assert.equal(pvp.damage, 20, "not from players");
  const touch = warrior("touch", 300);
  equip(touch, 3, 5);
  assert.equal(Fragments.setTier(touch, 6), 1, "Unholy Ranger and Unholy Wizard both list Drakan's Touch");
  const skills = touch.getSkillManager();
  skills.setCurrentLevel(core.Skill.HITPOINTS, 5, false);
  Math.random = () => 0;
  Effects.hitResolved({
    attacker: touch,
    target: { isPlayer: () => false, isNpc: () => true },
    hit: { getTotalDamage: () => 40, isAccurate: () => false, getCombatType: () => core.CombatType.MAGIC },
  });
  assert.equal(skills.getCurrentLevel(core.Skill.HITPOINTS), 7, "5% of 40 healed");
});

test("Venomaster poisons with its level's severity and gives poison, then venom, immunity", () => {
  const { CombatPoisonEffect } = require("../dist/game/task/impl/CombatPoisonEffect");
  const player = warrior("venom", 10);
  equip(player, 13);
  const poisoned = [];
  const target = { isPlayer: () => false, isNpc: () => true };
  const hit = { getTotalDamage: () => 10, isAccurate: () => false, getCombatType: () => core.CombatType.MELEE };
  Math.random = () => 0;
  stubbing(core.CombatFactory, { poisonEntity: (entity, severity) => poisoned.push(severity) }, () => {
    Effects.hitResolved({ attacker: player, target, hit });
    setXp(player, 13, 8000);
    Effects.hitResolved({ attacker: player, target, hit });
    Math.random = () => 0.5;
    Effects.hitResolved({ attacker: player, target, hit });
  });
  assert.deepEqual(poisoned, [15, 35], "severity 15 at level 1, 35 at level 3; a 50 roll misses the 25% chance");
  assert.deepEqual([15, 25, 35].map((severity) => CombatPoisonEffect.damageFromSeverity(severity)), [3, 5, 7], "which hit for 3 / 5 / 7");
  const immune = warrior("immune", 10);
  equip(immune, 13);
  const clock = immune.getCombat().getPoisonImmunityTimer();
  Effects.perTick({ player: immune });
  assert.equal(clock.finished(), true, "no immunity at level 1");
  setXp(immune, 13, 2000);
  Effects.perTick({ player: immune });
  assert.equal(clock.finished(), false, "poison immunity at level 2");
  assert.equal(clock.isVenomImmune(), false);
  setXp(immune, 13, 8000);
  Effects.perTick({ player: immune });
  assert.equal(clock.isVenomImmune(), true, "venom immunity at level 3");
});

test("a Shattered Relics character's per-tick effects run as one task from login", () => {
  const ticking = (list) => list.filter((task) => task.constructor.name === "TickTask");
  const player = character("ticker");
  assert.equal(ticking(player.loginTasks).length, 1, "started at login");
  emit("league:login", { player });
  assert.equal(ticking(tasks).length, 0, "and never twice");
  const echoes = character("ticker-echoes", { league: 5 });
  assert.equal(ticking(echoes.loginTasks).length, 0, "none for another league");
});

test("the extra rolls re-roll the hit with its spell, never chain, and go through the hit queue", () => {
  const player = warrior("chain", 300);
  equip(player, 5, 7);
  assert.equal(Fragments.setTier(player, 3), 1, "Unholy Wizard and Thrall Damage: two pieces of Chain Magic");
  const spell = { name: "Fire Blast" };
  const combat = player.getCombat();
  combat.setCastSpell(null);
  player.setSpecialActivated(true);
  const built = [];
  const queued = [];
  // The roll itself is the combat formulas' (tested with them); what it is rolled with is recorded here.
  const prepareHits = core.PendingHit.prototype.prepareHits;
  core.PendingHit.prototype.prepareHits = function recordRoll() {
    built.push({ castSpell: combat.getCastSpell(), special: player.isSpecialActivated() });
    return [];
  };
  const context = { spell, tick: 0, data: new Map() };
  const hit = {
    getTotalDamage: () => 5, isAccurate: () => true, getCombatType: () => core.CombatType.MAGIC,
    getCombatMethod: () => ({ type: () => core.CombatType.MAGIC }), getSpell: () => spell, getSpellContext: () => context,
  };
  const target = { isPlayer: () => false, isNpc: () => true, getHitpoints: () => 50 };
  Math.random = () => 0;
  try {
    stubbing(core.CombatFactory, { addPendingHit: (extra) => queued.push(extra), poisonEntity() {} }, () => {
      Effects.hitResolved({ attacker: player, target, hit });
      Effects.hitResolved({ attacker: player, target, hit: queued[0] });
    });
  } finally {
    core.PendingHit.prototype.prepareHits = prepareHits;
  }
  assert.equal(queued.length, 1, "one extra roll, through CombatFactory.addPendingHit, and it doesn't chain");
  assert.equal(built[0].castSpell, spell, "rolled with the hit's spell");
  assert.equal(built[0].special, false, "never a special attack's traits");
  assert.equal(queued[0].getSpellContext(), context, "and its cast");
  assert.equal(queued[0].getSpell(), spell);
  assert.equal(combat.getCastSpell(), null, "the cast spell is put back");
  assert.equal(player.isSpecialActivated(), true, "and the special bar");
});

test("an extra roll takes no more than the hitpoints left after the queued damage, and none after a killing blow", () => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
  const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const player = warrior("twin", 300);
  equip(player, 2, 12);
  assert.equal(Fragments.setTier(player, 14), 1, "Twin Strikes from Tactical Duelist and Special Discount");
  const goblin = new NPC(3029, new core.Location(3250, 3235, 0));
  const queue = goblin.getCombat().getHitQueue();
  const original = (damage) => {
    const part = new HitDamage(damage, HitMask.RED);
    queue.addPendingDamage([part]);
    return {
      getTotalDamage: () => damage, isAccurate: () => true, getCombatType: () => core.CombatType.MELEE,
      getCombatMethod: () => CombatFactory.MELEE_COMBAT, getSpell: () => null, getSpellContext: () => null,
    };
  };
  const xp = () => player.getSkillManager().getTotalExp?.() ?? player.getSkillManager().getExperience(core.Skill.HITPOINTS);
  Math.random = () => 0;
  goblin.setHitpoints(10);
  const before = xp();
  Effects.hitResolved({ attacker: player, target: goblin, hit: original(10) });
  assert.equal(queue.hasPendingHitFrom(player), false, "a killing blow leaves nothing for an extra roll");
  assert.equal(xp(), before, "and pays no XP for one");
  queue.clear();
  goblin.setHitpoints(15);
  const queued = [];
  const prepareHits = core.PendingHit.prototype.prepareHits;
  core.PendingHit.prototype.prepareHits = () => [new HitDamage(9, HitMask.RED)];
  try {
    stubbing(core.CombatFactory, { addPendingHit: (extra) => queued.push(extra) }, () => {
      Effects.hitResolved({ attacker: player, target: goblin, hit: original(10) });
    });
  } finally {
    core.PendingHit.prototype.prepareHits = prepareHits;
  }
  assert.equal(queued.length, 1);
  queued[0].capDamageToBudget();
  assert.equal(queued[0].getTotalDamage(), 5, "a 9 rolled against the 5 hitpoints left takes 5, before addPendingHit pays its XP");
});

test("Bottomless Quiver saves before plugin-owned ammunition, and never chinchompas", () => {
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const player = warrior("quiver", 10);
  equip(player, 4);
  const owned = [];
  const shoot = (weaponId) => {
    player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
    stubbing(PluginManager, {
      emitCustomEvent: (name, payload) => (name === "combat:ammo-saving" ? Effects.ammoSaving(payload) : undefined),
      decrementRangedAmmo: () => (owned.push(weaponId), true),
    }, () => CombatFactory.decrementAmmo(player, null, 1));
  };
  Math.random = () => 0;
  shoot(12926);
  assert.deepEqual(owned, [], "a blowpipe's dart and scales saved before its plugin consumes them");
  shoot(10033);
  assert.deepEqual(owned, [10033], "a chinchompa is thrown as usual");
});

test("onExperienceGained sends what landed: after the cap, never when locked or at the cap", () => {
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const events = [];
  const player = warrior("hooked");
  const skills = player.getSkillManager();
  stubbing(PluginManager, { emitExperienceGained: (event) => events.push(event.experience) }, () => {
    skills.addExperience(core.Skill.FISHING, 100, false);
    skills.setExperience(core.Skill.FISHING, SkillManager.MAX_EXPERIENCE - 30);
    skills.addExperience(core.Skill.FISHING, 100, false);
    skills.addExperience(core.Skill.FISHING, 100, false);
    player.setAttribute(SkillManager.XP_LOCKED_ATTRIBUTE, true);
    skills.addExperience(core.Skill.COOKING, 100, false);
  });
  assert.deepEqual(events, [100, 30], "100, then the 30 left under the cap; nothing at the cap or while locked");
});

// ---- Effects, batch 2 ----

const GEAR = {
  bandos: [11832, 11834, 11836],
  bandosGodsword: 11804,
  armadyl: [11826, 11828, 11830, 11785],
  zamorak: [2657, 2653, 2655, 2659],
  saradomin: [2665, 2661, 2663, 2667],
};
const WORN_SLOTS = ["HEAD_SLOT", "BODY_SLOT", "LEG_SLOT", "SHIELD_SLOT"];

/** Wears the items, the weapon in its slot and the rest one to a slot. */
function wear(player, items, weapon = null) {
  const equipment = player.getEquipment();
  items.forEach((id, index) => equipment.setItem(core.Equipment[WORN_SLOTS[index]], new core.Item(id, 1)));
  if (weapon) equipment.setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
}

/** A real packet sender, for plugins (Slayer) that read back the varps they set. */
function withVars(player) {
  player.getSession = () => ({ sendClientPacket() {}, write() {} });
  const sender = new PacketSender(player);
  player.getPacketSender = () => sender;
  return player;
}

function npcNamed(name) {
  const count = core.CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const type = core.CacheDefinitions.getNpc(id);
    if (type?.name !== name || !(type.actions ?? []).includes("Attack")) continue;
    const definition = core.NpcDefinition.forId(id);
    return { getId: () => id, getCurrentDefinition: () => definition, getDefinition: () => definition, getLocation: () => new core.Location(3200, 3200, 0) };
  }
  throw new Error(`no attackable NPC named ${name}`);
}

test("Tactical Duelist saves a melee weapon's charge (combat:melee-charge from the crystal halberd)", () => {
  const CrystalHalberd = require("../plugins/items/CrystalHalberd.plugin");
  const player = warrior("duelist", 10);
  equip(player, 2);
  const halberd = new core.Item(CrystalHalberd._test.buildIdMaps(core.ItemIdentifiers).keys().next().value, 1);
  halberd.setMetaValue("crystal-halberd", { charges: 100 });
  Math.random = () => 0;
  CrystalHalberd.useCharge(player, halberd);
  assert.equal(CrystalHalberd.charges(halberd), 100, "saved");
  Math.random = () => 0.5;
  CrystalHalberd.useCharge(player, halberd);
  assert.equal(CrystalHalberd.charges(halberd), 99, "20% at level 1: a 50 roll spends it");
  setXp(player, 2, 8000);
  Math.random = () => 0.79;
  CrystalHalberd.useCharge(player, halberd);
  assert.equal(CrystalHalberd.charges(halberd), 99, "80% at level 3");
  const staff = { player, itemId: 11905, skip: false };
  Effects.chargeSaving(staff);
  assert.equal(staff.skip, false, "never a powered staff's charge: that is Arcane Conduit's");
});

test("Arcane Conduit does not save a crystal halberd charge through the shared charge event", () => {
  const CrystalHalberd = require("../plugins/items/CrystalHalberd.plugin");
  const player = warrior("conduit-melee", 10);
  equip(player, 6);
  const halberd = new core.Item(CrystalHalberd._test.buildIdMaps(core.ItemIdentifiers).keys().next().value, 1);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, halberd);
  halberd.setMetaValue("crystal-halberd", { charges: 100 });
  Math.random = () => 0;
  CrystalHalberd.useCharge(player, halberd);
  assert.equal(CrystalHalberd.charges(halberd), 99, "Arcane Conduit saves magic charges only");
});

test("Livin' On A Prayer: active prayers drain 15/30/60% slower (PrayerHandler)", () => {
  const { PrayerHandler, PrayerData } = require("../dist/game/content/PrayerHandler");
  PrayerData.initializeMaps();
  const piety = PrayerData.PIETY.prayerId;
  const drained = (player, ticks) => {
    const skills = player.getSkillManager();
    skills.setMaxLevels(core.Skill.PRAYER, 99, false);
    skills.setCurrentLevel(core.Skill.PRAYER, 99, false);
    player.getPrayerActive()[piety] = true;
    player.setDrainingPrayer(true);
    for (let tick = 0; tick < ticks; tick++) PrayerHandler.processDrain(player);
    return 99 - skills.getCurrentLevel(core.Skill.PRAYER);
  };
  assert.equal(drained(warrior("pious"), 100), 40, "Piety: 24 a tick against 60 resistance, 40 points in 100 ticks");
  const player = warrior("prayerful", 300);
  equip(player, 8);
  assert.equal(drained(player, 100), 34, "15% slower: 20.4 a tick, 34 points");
  setXp(player, 8, 8000);
  player.setPrayerPointDrain(0);
  assert.equal(drained(player, 100), 16, "60% slower at level 3");
});

test("Special Discount caps what a special costs and drains (CombatSpecial)", () => {
  const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
  const special = (cost) => ({ getId: () => "fragment-cost-test", getDrainAmountForWeaponId: () => cost });
  const plain = warrior("full-price");
  assert.equal(CombatSpecial.energyCost(plain, special(55)), 55);
  const player = warrior("discount", 10);
  equip(player, 12);
  assert.equal(CombatSpecial.energyCost(player, special(55)), 50, "more than 50% costs 50% at level 1 (param 1456: 500 tenths)");
  assert.equal(CombatSpecial.energyCost(player, special(25)), 25, "a cheaper one is unchanged");
  player.setSpecialPercentage(100);
  CombatSpecial.drain(player, 55);
  assert.equal(player.getSpecialPercentage(), 50, "and drains only that");
  setXp(player, 12, 8000);
  assert.equal(CombatSpecial.energyCost(player, special(50)), 25, "25% at level 3");
  player.setSpecialPercentage(100);
  CombatSpecial.drain(player, 100, false);
  assert.equal(player.getSpecialPercentage(), 0, "an amount that isn't a cost (the Dragon hasta's Unleash) is never capped");
});

test("Thrall Damage multiplies a thrall's max hit (magic:thrall-max-hit)", () => {
  const player = warrior("necromancer", 10);
  const max = (maxHit) => emit("magic:thrall-max-hit", { player, maxHit }).maxHit;
  assert.equal(max(3), 3);
  equip(player, 7);
  assert.equal(max(3), 6, "x2 at level 1");
  setXp(player, 7, 8000);
  assert.equal(max(3), 12, "x4 at level 3");
});

test("Superior Tracking: 1 in 150/100/30, without Bigger and Badder; never when toggled off", () => {
  const Superiors = require("../plugins/skills/slayer/Superiors.Slayer");
  const State = require("../plugins/skills/slayer/State.Slayer");
  const bloodveld = npcNamed("Bloodveld");
  const plain = withVars(warrior("no-tracking"));
  assert.equal(Superiors.taskKill({ player: plain, npc: bloodveld }, () => 0), null, "locked without the fragment");
  const player = withVars(warrior("tracker", 300));
  equip(player, 15);
  assert.equal(Superiors.taskKill({ player, npc: bloodveld }, () => 0.0067), null, "a 1-in-150 miss");
  assert.ok(Superiors.taskKill({ player, npc: bloodveld }, () => 0.006), "1 in 150 at level 1");
  assert.equal(core.CacheDefinitions.getNpc(spawned.at(-1).id).name, "Insatiable Bloodveld");
  setXp(player, 15, 8000);
  assert.ok(Superiors.taskKill({ player, npc: bloodveld }, () => 0.033), "1 in 30 at level 3");
  State.setVarbit(player, "slayer_toggleoff_superiormobs", 1);
  assert.equal(Superiors.taskKill({ player, npc: bloodveld }, () => 0), null, "toggled off");
});

test("Slay 'n' Pay: a task's points raised by 10/20/50%", () => {
  const Tasks = require("../plugins/skills/slayer/Tasks.Slayer");
  const State = require("../plugins/skills/slayer/State.Slayer");
  const complete = (player) => {
    State.setVarbit(player, "slayer_points", 0);
    State.setVarbit(player, "slayer_tasks_completed", 5);
    Tasks.complete(player, { masterId: 2, original: 10, task: { displayName: "bats" } });
    return State.varbit(player, "slayer_points");
  };
  assert.equal(complete(withVars(warrior("unpaid"))), 6, "Mazchna's 6 points");
  const player = withVars(warrior("paid", 10));
  equip(player, 16);
  setXp(player, 16, 8000);
  assert.equal(complete(player), 9, "50% more at level 3");
});

test("Bandosian Might: melee max hit +1/2/4 per tick of attack speed, with four Bandos items", () => {
  const player = warrior("bandosian", 10);
  equip(player, 17);
  wear(player, GEAR.bandos);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(4151, 1));
  assert.equal(Effects.bandosianMight(player, 40), 40, "three Bandos items and a whip: not four");
  wear(player, GEAR.bandos, GEAR.bandosGodsword);
  assert.equal(Effects.bandosianMight(player, 40), 46, "the godsword is the fourth (God Wars counts it); 6 ticks x 1");
  setXp(player, 17, 8000);
  assert.equal(Effects.bandosianMight(player, 40), 64, "x 4 at level 3");
  const npc = { isPlayer: () => false };
  assert.equal(Effects.bandosianMight(npc, 40), 40, "never an NPC");
});

test("Zamorakian Sight and Armadylean Decree, with four of their god's items", () => {
  const zamorakian = warrior("zamorakian", 10);
  equip(zamorakian, 19);
  wear(zamorakian, GEAR.zamorak.slice(0, 3));
  assert.equal(Effects.zamorakianSight(zamorakian, 1000), 1000, "three items");
  wear(zamorakian, GEAR.zamorak);
  assert.equal(Effects.zamorakianSight(zamorakian, 1000), 1500, "+50% magic accuracy at level 1");
  const armadylean = warrior("armadylean", 10);
  equip(armadylean, 18);
  wear(armadylean, GEAR.armadyl.slice(0, 3), GEAR.armadyl[3]);
  const bolt = emit("combat:bolt-effect-chance", { player: armadylean, effect: "lucky-lightning", chance: 0.1 });
  assert.equal(bolt.chance, 0.125, "bolt effects 25% likelier at level 1");
});

test("Saradominist Defence: max hit +2/5/10 within 6 ticks of combat damage landing", () => {
  const player = warrior("saradominist", 10);
  equip(player, 20);
  wear(player, GEAR.saradomin);
  const npc = { isPlayer: () => false, isNpc: () => true };
  const landed = (attacker, damage) => Effects.hitResolved({ attacker, target: player, hit: { getTotalDamage: () => damage } });
  World.processCycle = 5000;
  assert.equal(Effects.saradoministDefence(player, 30), 30, "not hit yet");
  landed(npc, 0);
  assert.equal(Effects.saradoministDefence(player, 30), 30, "a 0 isn't damage");
  landed(null, 4);
  assert.equal(Effects.saradoministDefence(player, 30), 30, "nor is damage with no attacker (poison)");
  landed(npc, 4);
  World.processCycle = 5006;
  assert.equal(Effects.saradoministDefence(player, 30), 32, "+2 at level 1, 6 ticks on");
  World.processCycle = 5007;
  assert.equal(Effects.saradoministDefence(player, 30), 30, "gone after 3.6 seconds");
});

test("Knife's Edge: +0.3% / 0.6% damage per hitpoint missing", () => {
  const player = warrior("knife", 300);
  const skills = player.getSkillManager();
  skills.setMaxLevels(core.Skill.HITPOINTS, 99, false);
  skills.setCurrentLevel(core.Skill.HITPOINTS, 49, false);
  equip(player, 8, 20);
  assert.equal(Fragments.setTier(player, 10), 1, "Livin' On A Prayer and Saradominist Defence list Knife's Edge");
  assert.equal(Effects.knifesEdge(player, 100), 115, "50 missing x 0.3%");
  equip(player, 1);
  assert.equal(Fragments.setTier(player, 10), 2, "Unholy Warrior makes three");
  assert.equal(Effects.knifesEdge(player, 100), 130, "50 missing x 0.6%");
});

test("Fast Metabolism: each Hitpoints regen heals 4 (stats:hitpoints-regen from Player)", () => {
  const regen = (player) => {
    const skills = player.getSkillManager();
    skills.setMaxLevels(core.Skill.HITPOINTS, 50, false);
    skills.setCurrentLevel(core.Skill.HITPOINTS, 10, false);
    stubbing(PluginManager, { emitCustomEvent: (name, payload) => emit(name, payload) }, () => {
      player.processStatRestoration(10000);
      player.processStatRestoration(10100);
    });
    return skills.getCurrentLevel(core.Skill.HITPOINTS);
  };
  assert.equal(regen(warrior("slow")), 11, "a point a minute");
  const player = warrior("metabolic", 300);
  equip(player, 11, 13);
  assert.equal(Fragments.setTier(player, 8), 1, "Larger Recharger and Venomaster list Fast Metabolism");
  assert.equal(regen(player), 14, "four times as much");
});

test("another league's character gets none of it", () => {
  const echoes = character("echoes-frag", { league: 5 });
  worldLeague = 5;
  try {
    Math.random = () => 0;
    gain(echoes, "FISHING", 500);
    assert.equal(echoes.getInventory().contains(ITEMS.harvesting), false);
    echoes.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 0, false);
    assert.equal(Effects.accuracy("melee")(echoes, 1000), 1000);
    assert.equal(Fragments.equippedLevel(echoes, 1), 0);
  } finally {
    worldLeague = 3;
  }
});
