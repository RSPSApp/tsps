// Run after `yarn build`: node --test tests/revenants.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const Data = require("../plugins/npcs/revenants/Data.Revenants");
const { createRevenantCombat, chooseStyle, takeHeal } = require("../plugins/npcs/revenants/Combat.Revenants");
const Drops = require("../plugins/npcs/revenants/Drops.Revenants");
const Bracelet = require("../plugins/npcs/revenants/Bracelet.Revenants");
const Revenants = require("../plugins/npcs/revenants/Common.Revenants");
const Loot = require("../plugins/npcs/revenants/Loot.Revenants");

const { ITEMS } = Data;
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  await new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
});

/** An item with charges kept in its metadata, as the server's items do. */
function item(id, amount = 1) {
  const meta = new Map();
  return {
    id,
    amount,
    getId() { return this.id; },
    setId(next) { this.id = next; },
    getAmount() { return this.amount; },
    getMetaValue: (key) => meta.get(key),
    setMetaValue: (key, value) => (value === undefined ? meta.delete(key) : meta.set(key, value)),
  };
}

function player({ hands = null, amulet = null, protect = null, at = new Location(3200, 10100, 0) } = {}) {
  const attributes = new Map();
  const messages = [];
  const equipment = [];
  equipment[9] = hands;
  equipment[2] = amulet;
  const inventory = [];
  const p = {
    messages,
    protect,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    getLocation: () => at,
    getSize: () => 1,
    getPrivateArea: () => null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => messages.push(message),
    isSkulled: () => false,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getInventory: () => ({
      getItems: () => inventory,
      refreshItems() {},
      delete(id, amount) { const i = inventory.find((x) => x?.getId() === id); i.amount -= amount; },
      adds(id, amount) { inventory.push(item(id, amount)); },
      deleteAtSlot(slot) { inventory[slot] = null; },
      contains: (id) => inventory.some((x) => x?.getId() === id),
      getFreeSlots: () => 28 - inventory.filter(Boolean).length,
    }),
    getCombat: () => ({ getTarget: () => null }),
    performGraphic: (graphic) => messages.push(`gfx ${graphic.getId()}`),
    getPacketSender: () => ({ sendSound: (id) => messages.push(`sound ${id}`) }),
  };
  return p;
}

// ------------------------------------------------------------------ data

test("each revenant attacks, blocks and dies with its own animations (cache lists, captures)", () => {
  const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
  const expected = {
    7881: [169, 170, 172], 7931: [6184, 6183, 6182], 7932: [1582, 1581, 1580], 7933: [164, 165, 167],
    7934: [4652, 4651, 4653], 7935: [6579, 6578, 6558], 7936: [64, 65, 67], 7937: [4320, 4322, 4321],
    7938: [2731, 2732, 2733], 7939: [390, 388, 836], 7940: [80, 89, 92],
  };
  for (const [id, [attack, block, death]] of Object.entries(expected)) {
    const definition = NpcDefinition.forId(Number(id));
    assert.match(definition.getName(), /^Revenant /);
    assert.deepEqual([definition.getAttackAnim(), definition.getDefenceAnim(), definition.getDeathAnim()], [attack, block, death], id);
  }
  assert.equal(NpcDefinition.forId(7935).getDeathSound(), 3718, "hellhound death sound, captured");
});

test("the drop table's item ids are the items the Wiki names", () => {
  const name = (id) => CacheDefinitions.getItem(id).name;
  assert.deepEqual(Drops.UNIQUES.map(([id]) => name(id)),
    ["Amulet of avarice", "Craw's bow (u)", "Thammaron's sceptre (u)", "Viggora's chainmace (u)"]);
  assert.equal(name(Drops.MAIN[0][0]), "Bracelet of ethereum (uncharged)");
  assert.equal(Drops.MAIN.reduce((sum, row) => sum + row[1], 0), Drops.MAIN_TOTAL);
  assert.equal(Drops.BLIGHTED.reduce((sum, row) => sum + row[1], 0), 100);
  assert.equal(Drops.ARTEFACTS.reduce((sum, row) => sum + row[1], 0), 39, "plus the unique slot: 40");
  assert.deepEqual([ITEMS.ETHER, ITEMS.BRACELET_CHARGED].map(name), ["Revenant ether", "Bracelet of ethereum"]);
});

// ------------------------------------------------------------------ combat

test("style: melee next to the target unless protected, Magic further away unless protected", () => {
  assert.equal(chooseStyle(true, {}), "melee");
  assert.equal(chooseStyle(true, { melee: true }), "magic");
  assert.equal(chooseStyle(false, {}), "magic");
  assert.equal(chooseStyle(false, { magic: true }), "ranged");
  assert.equal(chooseStyle(false, { melee: true }), "magic");
});

test("heals: below half, 15 ticks apart, and only as many times as rolled", () => {
  const state = { left: 2, readyAt: 0 };
  assert.equal(takeHeal(state, 40, 80, 100), false, "at half health");
  assert.equal(takeHeal(state, 39, 80, 100), true);
  assert.equal(takeHeal(state, 39, 80, 114), false, "cooldown");
  assert.equal(takeHeal(state, 39, 80, 115), true);
  assert.equal(takeHeal(state, 10, 80, 200), false, "no heals left");
});

/** The method with a recording core: projectiles, hits and freezes are logged. */
function combatHarness({ others = [] } = {}) {
  const log = [];
  class FakeHit {
    constructor(npc, target, method, delay) {
      this.target = target;
      this.type = core.CombatType[method.type()];
      this.delay = delay;
      this.damage = 20;
      log.push(`hit ${this.type} delay ${delay}`);
    }
    getTotalDamage() { return this.damage; }
    setTotalDamage(damage) { this.damage = damage; }
    isAccurate() { return true; }
  }
  const projectile = (id) => ({ withProgress() { return this; }, sendProjectile: () => log.push(`projectile ${id}`) });
  const RevenantCombat = createRevenantCombat({
    ...core,
    PendingHit: FakeHit,
    Projectile: { createProjectile: (n, t, id) => projectile(id), arrivalCycles: () => 56 },
    Sounds: { sendSound: (who, sound) => log.push(`sound ${sound.getId()}`) },
    CombatFactory: { freeze: () => log.push("frozen") },
    World: { getProcessCycle: () => 100, getPlayers: () => others },
    PrayerHandler: { ...core.PrayerHandler, isActivated: (target, prayer) => target.protect === prayer },
  });
  return { method: new RevenantCombat(), log };
}

function revenant(id, { distance = 1, hitpoints = 80, max = 80 } = {}) {
  const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
  const animations = [];
  return {
    animations,
    getId: () => id,
    getDefinition: () => NpcDefinition.forId(id),
    getHitpoints: () => hitpoints,
    getMaxHitpoints: () => max,
    heal(amount) { hitpoints = Math.min(max, hitpoints + amount); },
    calculateDistance: () => distance,
    performAnimation: (animation) => animations.push(animation.getId()),
    performGraphic: (graphic) => animations.push(`gfx ${graphic.getId()}`),
    getCombat: () => ({ getAttacker: () => null }),
  };
}

test("a pyrefiend melees next to you and casts from afar (captured animations and projectile)", () => {
  const { method, log } = combatHarness();
  const target = player();
  const near = revenant(Data.REVENANTS.PYREFIEND, { distance: 1 });
  method.start(near, target);
  method.hits(near, target);
  assert.deepEqual(near.animations, [1582]);
  assert.deepEqual(log, ["sound 696", "hit MELEE delay 0"]);

  log.length = 0;
  const far = revenant(Data.REVENANTS.PYREFIEND, { distance: 5 });
  method.start(far, target);
  method.hits(far, target);
  assert.deepEqual(far.animations, [7820], "pyrefiend_casting");
  assert.deepEqual(log.slice(0, 3), ["sound 696", "sound 162", "projectile 1415"]);
  assert.ok(log.includes("hit MAGIC delay 3"));
  assert.ok(target.messages.includes("gfx 1454") || target.messages.includes("gfx 369"));
});

test("against Protect from Magic a revenant at range shoots (projectile 206)", () => {
  const { method, log } = combatHarness();
  const target = player({ protect: core.PrayerHandler.PROTECT_FROM_MAGIC });
  const ork = revenant(Data.REVENANTS.ORK, { distance: 4 });
  method.start(ork, target);
  method.hits(ork, target);
  assert.deepEqual(ork.animations, [6972], "the ork's ranged attack");
  assert.deepEqual(log, ["projectile 206", "hit RANGED delay 2"]);
});

test("Magic also hits the others on the target's tile", () => {
  const bystander = player();
  const { method, log } = combatHarness({ others: [bystander, player({ at: new Location(1, 1, 0) })] });
  const target = player();
  const dragon = revenant(Data.REVENANTS.DRAGON, { distance: 6 });
  method.start(dragon, target);
  assert.equal(method.hits(dragon, target).length, 2, "the target and the one player beside them");
  assert.deepEqual(dragon.animations, [80], "its attack animation (captured)");
});

test("below half health it heals 20 instead of attacking (graphic 1221)", () => {
  const { method, log } = combatHarness();
  const hurt = revenant(Data.REVENANTS.HELLHOUND, { hitpoints: 30, max: 80 });
  method.start(hurt, player());
  assert.deepEqual(method.hits(hurt, player()), []);
  assert.equal(hurt.getHitpoints(), 50);
  assert.deepEqual(hurt.animations, ["gfx 1221", 65535], "the heal graphic and a reset animation, as captured");
  assert.deepEqual(log, ["sound 3887"]);
});

test("a charged bracelet: 75% off for a charge, and no aggression until attacked", () => {
  const bracelet = item(ITEMS.BRACELET_CHARGED);
  bracelet.setMetaValue("charges", 2);
  const target = player({ hands: bracelet });
  const { method, log } = combatHarness();
  const knight = revenant(Data.REVENANTS.KNIGHT, { distance: 1 });
  assert.equal(method.canAttack(knight, target), false, "tolerant");
  const attacked = { ...knight, getCombat: () => ({ getAttacker: () => target }) };
  assert.equal(method.canAttack(attacked, target), true, "fights back");

  method.start(knight, target);
  const [hit] = method.hits(knight, target);
  assert.equal(hit.getTotalDamage(), 5, "20 -> 5");
  assert.equal(Bracelet.charges(bracelet), 1);
  method.start(knight, target);
  method.hits(knight, target);
  assert.equal(bracelet.getId(), ITEMS.BRACELET_UNCHARGED, "out of charges");
  assert.ok(target.messages.includes("Your bracelet of ethereum has run out of charges."));
});

// ------------------------------------------------------------------ the bracelet

test("bracelet messages as captured: charging, check and the absorption toggle", () => {
  const p = player();
  const uncharged = item(ITEMS.BRACELET_UNCHARGED);
  const ether = item(ITEMS.ETHER, 100);
  p.getInventory().getItems().push(ether, uncharged);
  Bracelet.chargeWithEther({ player: p, usedItem: ether, usedItemId: ITEMS.ETHER, usedWithItem: uncharged });
  assert.equal(uncharged.getId(), ITEMS.BRACELET_CHARGED);
  assert.equal(p.messages.at(-1), "The bracelet has 100 (<col=007f00>0.6%</col>) charges, it will not absorb ether from defeated revenants.");
  Bracelet.toggleAbsorption({ player: p });
  assert.equal(p.messages.at(-1), "Your bracelet will now automatically absorb ether from defeated revenants.");
  Bracelet.toggleAbsorption({ player: p });
  assert.equal(p.messages.at(-1), "Your bracelet will no longer automatically absorb ether from defeated revenants.");
});

// ------------------------------------------------------------------ drops

test("drop thresholds follow the Wiki's formula", () => {
  assert.deepEqual(Drops.thresholds(135), { A: 200, B: 205 }, "dragon: no coins row");
  assert.deepEqual(Drops.thresholds(7), { A: 1100, B: 37 }, "imp: mostly coins");
});

test("every kill drops an even amount of ether in range; the rolls land in the right tables", () => {
  for (let i = 0; i < 200; i++) {
    const [ether] = Drops.rollDrops({ npcId: 7940, combat: 135 });
    assert.equal(ether.itemId, ITEMS.ETHER);
    assert.ok(ether.amount % 2 === 0 && ether.amount >= 2 && ether.amount <= 24, String(ether.amount));
  }
  const high = () => 0.999;
  const dragon = Drops.rollDrops({ npcId: 7940, combat: 135, random: high });
  assert.ok(Drops.MAIN.some(([id]) => id === dragon[1].itemId), "dragon: the main table");
  const imp = Drops.rollDrops({ npcId: 7881, combat: 7, random: high });
  assert.equal(imp[1].itemId, ITEMS.COINS, "imp: coins");
  const lucky = Drops.rollDrops({ npcId: 7881, combat: 7, random: () => 0 });
  assert.equal(lucky[1].itemId, 22557, "a unique on a perfect roll");
});

test("loot: under the revenant for the killer, ether absorbed, avarice notes", () => {
  const registered = [];
  Revenants.init({
    core: { ...core, ItemOnGroundManager: { registerLocation: (owner, i, at) => registered.push([i.getId(), i.getAmount()]) } },
    emitCustomEvent: () => {},
  });
  const bracelet = item(ITEMS.BRACELET_CHARGED);
  bracelet.setMetaValue("charges", 10);
  const killer = player({ hands: bracelet, amulet: item(ITEMS.AMULET_OF_AVARICE) });
  killer.setAttribute(Bracelet.ABSORB_ATTRIBUTE, true);
  const npc = { getDefinition: () => ({ getCombatLevel: () => 135 }), getLocation: () => new Location(3240, 10200, 0) };
  const random = Math.random;
  Math.random = () => 0.999;
  try {
    Loot.dropLoot({ killer, npc, npcId: 7940 });
  } finally {
    Math.random = random;
  }
  assert.ok(!registered.some(([id]) => id === ITEMS.ETHER), "the ether went into the bracelet");
  assert.ok(Bracelet.charges(bracelet) > 10);
  const [id] = registered[0];
  assert.ok(CacheDefinitions.getItem(id).noteTemplate > 0 || CacheDefinitions.getItem(id).stackable, "noted by the amulet");
});

// ------------------------------------------------------------------ spawns

test("the caves' spawns: the Wiki's 30 revenant tiles and the captured ghosts, all walkable", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const spawns = require("../data/definitions/npc-spawns.json");
  const inCaves = spawns.filter((s) => s.x >= 3136 && s.x <= 3271 && s.y >= 10036 && s.y <= 10249 && s.level === 0);
  const count = (id) => inCaves.filter((s) => s.id === id).length;
  const { REVENANTS: R } = Data;
  assert.deepEqual(
    [R.IMP, R.GOBLIN, R.PYREFIEND, R.HOBGOBLIN, R.CYCLOPS, R.HELLHOUND, R.DEMON, R.ORK, R.DARK_BEAST, R.KNIGHT, R.DRAGON].map(count),
    [4, 2, 4, 2, 2, 2, 4, 4, 2, 2, 2],
  );
  assert.equal(count(10474), 5, "the uninteractable ghosts");
  assert.equal(spawns.filter((s) => /^Revenant /.test(s.name)).length, 30, "none outside the caves");
  RegionManager.init();
  for (const s of inCaves) {
    RegionManager.loadMapFiles(s.x, s.y);
    assert.equal(RegionManager.getClipping(s.x, s.y, 0, null) & 0x100, 0, `${s.name} at ${s.x},${s.y}`);
  }
});

test("the freeze's Ice Barrage impact is on the ground; the revenant impact at height 124", () => {
  const { Graphic } = core;
  const freeze = new Graphic(Data.MAGIC.freezeGraphic, Data.MAGIC.graphicDelay);
  assert.deepEqual([freeze.getDelay(), freeze.getHeight()], [56, 0]);
  const impact = new Graphic(Data.MAGIC.impact, Data.MAGIC.graphicDelay, Data.MAGIC.graphicHeight);
  assert.deepEqual([impact.getDelay(), impact.getHeight()], [56, 124]);
});

// ------------------------------------------------------------------ the maledictus

const Maledictus = require("../plugins/npcs/revenants/Maledictus.Revenants");
const Avarice = require("../plugins/npcs/revenants/Avarice.Revenants");

function maledictusHarness({ players = [] } = {}) {
  const spawned = [];
  const ground = [];
  const surged = [];
  const fakeCore = {
    ...core,
    World: { ...core.World, getPlayers: () => players },
    TaskManager: { submit() {} },
    ItemOnGroundManager: { registerLocation: (owner, i) => ground.push([owner.name, i.getId(), i.getAmount()]) },
  };
  const api = {
    spawnNpc: (def) => {
      const npc = { def, multi: false, setMultiCombat(v) { this.multi = v; }, getLocation: () => new Location(def.x, def.y, 0), getSize: () => 5, getHitpoints: () => 1250 };
      spawned.push(npc);
      return npc;
    },
    removeNpc() {},
  };
  const m = Maledictus.createMaledictus(api, fakeCore, { inCaves: Data.inCaves, surge: { grant: (p) => surged.push(p.name) } });
  return { m, spawned, ground, surged };
}

function caver(name, at = new Location(3200, 10100, 0)) {
  const p = player({ at });
  p.name = name;
  p.getUsername = () => name;
  p.getHitpoints = () => 99;
  p.isRegistered = () => true;
  p.getPacketSender = () => ({ sendEntityHint() {}, sendPositionalHint() {}, clearHintArrow() {}, sendSound() {} });
  return p;
}

test("maledictus: specials come every 2-3 standard attacks, never the same one twice running", () => {
  const { m } = maledictusHarness();
  const boss = {};
  const seen = Array.from({ length: 60 }, () => m.nextAttack(boss));
  const specials = seen.map((a, i) => [a, i]).filter(([a]) => a !== "standard");
  for (let i = 1; i < specials.length; i++) {
    const gap = specials[i][1] - specials[i - 1][1] - 1;
    assert.ok(gap === 2 || gap === 3, `gap ${gap}`);
    assert.notEqual(specials[i][0], specials[i - 1][0]);
  }
  assert.ok(new Set(specials.map(([a]) => a)).size === 3, "ice, surge and blood all appear");
});

test("maledictus: revenant kills add up until a roll spawns it, announced in the caves; then 45 quiet minutes", () => {
  Maledictus.state.boss = null;
  Maledictus.state.quietUntil = 0;
  Maledictus.state.total = 0;
  const inside = caver("inside");
  const outside = caver("outside", new Location(3200, 3600, 0));
  const { m, spawned } = maledictusHarness({ players: [inside, outside] });
  assert.equal(m.onRevenantKilled(135, () => 0.5), false, "135 of 10,000 against a roll of 5,000");
  assert.equal(Maledictus.state.total, 135);
  assert.equal(m.onRevenantKilled(135, () => 0.02), true, "270 beats a roll of 200");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].multi, true, "multi-combat in the singles caves");
  assert.ok(Maledictus.SPAWNS.some((s) => s.x === spawned[0].def.x && s.y === spawned[0].def.y));
  assert.match(inside.messages.at(-1), /^<col=ef1020>A superior revenant has been awoken in the (north|middle|south) of the caves\.\.$/);
  assert.deepEqual(outside.messages, []);
  Maledictus.state.boss = null;
  assert.equal(m.onRevenantKilled(135, () => 0), false, "the 45-minute cooldown");
  Maledictus.state.quietUntil = 0;
});

test("maledictus loot: the top damager's artefact and dragon rolls, blighted supplies for the rest, announced to all", () => {
  const top = caver("top");
  const helper = caver("helper");
  const { m, ground, surged } = maledictusHarness({ players: [top, helper] });
  const npc = { getId: () => Maledictus.ID, getCombat: () => ({ getRecentDamagerEntries: () => [{ player: helper, damage: 100 }, { player: top, damage: 900 }] }) };
  m.rememberDamagers({ npc });
  m.dropLoot({ npc });
  const topItems = ground.filter(([owner]) => owner === "top").map(([, id]) => id);
  assert.ok(topItems[0] === 21807 || topItems[0] === 21810, "an emblem or totem first");
  assert.deepEqual(surged, ["top"], "Forinthry surge goes to the top damager");
  const helperItems = ground.filter(([owner]) => owner === "helper");
  assert.deepEqual(helperItems[0].slice(1), [24598, 1], "a blighted super restore");
  assert.equal(helperItems.length, 3, "and two blighted food");
  assert.ok([24589, 24592, 24595].includes(helperItems[1][1]));
  assert.match(helper.messages.find((x) => /top received/.test(x)), /^<col=005f00>top received a drop: Ancient (emblem|totem)<\/col> <col=106f10>\(Revenant maledictus\)<\/col>$/);
  assert.ok(top.messages.some((x) => x === "<col=005f00>helper received a drop: Blighted super restore(4)</col> <col=106f10>(Revenant maledictus)</col>"));
});

test("maledictus spawn tiles are walkable, in the caves", () => {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  RegionManager.init();
  for (const s of Maledictus.SPAWNS) {
    assert.ok(Data.inCaves({ x: s.x, y: s.y, z: 0 }));
    RegionManager.loadMapFiles(s.x, s.y);
    assert.equal(RegionManager.getClipping(s.x, s.y, 0, null) & 0x100, 0, `${s.x},${s.y}`);
  }
});

test("an NPC marked multi-combat ignores the singles rule; others don't", () => {
  const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
  const npc = (multi) => ({ isNpc: () => true, getAsNpc: () => ({ isMultiCombat: () => multi }), getArea: () => null, getLocation: () => new Location(3200, 10100, 0) });
  const someone = { isNpc: () => false, getArea: () => null, getLocation: () => new Location(3200, 10100, 0) };
  assert.equal(CombatFactory.multiCombatBetween(someone, npc(true)), true);
  assert.equal(CombatFactory.multiCombatBetween(someone, npc(false)), false, "the caves are singles");
});

test("the amulet of avarice: +20% against revenants in the caves, and Forinthry surge 15% more", () => {
  const target = { isNpc: () => true, getAsNpc: () => ({ getId: () => Data.REVENANTS.DRAGON }) };
  const p = player({ amulet: item(ITEMS.AMULET_OF_AVARICE) });
  p.getCombat = () => ({ getTarget: () => target });
  assert.equal(Avarice.boost(p, 1000), 1200);
  p.setAttribute(Avarice.SURGE_ATTRIBUTE, Date.now() + 60_000);
  assert.equal(Avarice.boost(p, 1000), 1380);
  const bare = player();
  bare.getCombat = () => ({ getTarget: () => target });
  assert.equal(Avarice.boost(bare, 1000), 1000, "no amulet");
  const outside = player({ amulet: item(ITEMS.AMULET_OF_AVARICE), at: new Location(3200, 3600, 0) });
  outside.getCombat = () => ({ getTarget: () => target });
  assert.equal(Avarice.boost(outside, 1000), 1000, "outside the caves");
});
