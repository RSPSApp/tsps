// Run after `yarn build`: node --test tests/vale-totems.test.cjs
const assert = require("node:assert/strict");
const { test, before, beforeEach } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const ValeTotems = require("../plugins/minigames/ValeTotems.plugin");
const Shared = require("../plugins/minigames/valetotems/Shared.ValeTotems");
const State = require("../plugins/minigames/valetotems/State.ValeTotems");
const Ents = require("../plugins/minigames/valetotems/Ents.ValeTotems");

const hooks = { objects: {}, items: {}, events: [] };
const SITE = 3;
const SITE_BASE = 57028;
const SITE_OFFERINGS = 57032;

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onPlayerLogin() {},
    onPlayerLogout() {},
    onPlayerMapSquareChange() {},
    onServerStartup() {},
    registerCommand() {},
    spawnNpc() {},
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    emitCustomEvent: (name, payload) => hooks.events.push({ name, ...payload }),
  };
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ValeTotems.register(fakeApi());
});

beforeEach(() => {
  hooks.events.length = 0;
});

const obj = (name) => CacheDefinitions.getObjId(name);
const varbit = (name) => CacheDefinitions.getVarbitId(name);

/** A player with real varp/varbit maths, 28 inventory slots and the given Fletching level. */
function createPlayer({ fletching = 99, items = [] } = {}) {
  const varps = new Map();
  const inventory = Array.from({ length: 28 }, (_, slot) => items[slot] ?? null);
  const stacks = (id) => PluginManager.getCoreApi().ItemDefinition.forId(id)?.isStackable?.() === true;
  const xp = {};
  const said = [];
  const messages = [];
  const animations = [];
  const attributes = new Map();
  let menu = null;
  let energy = 50;
  const location = { getX: () => 1386, getY: () => 3276, getZ: () => 0, equals: () => true };
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig: (id, value) => { varps.set(id, value); return sender; },
    getVarbit: (id) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const width = endBit - startBit + 1;
      return ((varps.get(baseVar) ?? 0) >>> startBit) & ((1 << width) - 1);
    },
    sendVarbit: (id, value) => {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    sendCreationMenu: (value) => { menu = value; return sender; },
    sendSound: () => sender,
    sendRunEnergy: () => sender,
  };
  const player = {
    inventory, xp, said, messages, animations, attributes,
    menu: () => menu,
    isPlayerBot: () => false,
    getLocation: () => location,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (text) => messages.push(text),
    performAnimation: (animation) => animations.push(animation.getId()),
    setPositionToFace() {},
    getRunEnergy: () => energy,
    setRunEnergy: (value) => { energy = value; },
    getDialogueManager: () => ({ startDialogues: (builder) => said.push([...builder.getDialogues().values()][0].getText()) }),
    getEquipment: () => ({ contains: () => false }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill.getName?.() ?? String(skill)).toLowerCase().includes("fletch") ? fletching : 1,
      getMaxLevel: () => 1,
      addExperiences: (skill, amount) => {
        const name = (skill.getName?.() ?? String(skill)).toLowerCase();
        xp[name] = (xp[name] ?? 0) + amount;
      },
    }),
    getInventory: () => ({
      contains: (id) => inventory.some((item) => item?.id === id),
      getAmount: (id) => inventory.filter((item) => item?.id === id).reduce((sum, item) => sum + item.amount, 0),
      getFreeSlots: () => inventory.filter((item) => !item).length,
      refreshItems() {},
      delete: (id, amount) => {
        let left = amount;
        for (let slot = 0; slot < 28 && left > 0; slot++) {
          const item = inventory[slot];
          if (item?.id !== id) continue;
          const take = Math.min(left, item.amount);
          item.amount -= take;
          left -= take;
          if (item.amount === 0) inventory[slot] = null;
        }
      },
      adds: (id, amount) => {
        const stack = stacks(id) && inventory.find((item) => item?.id === id);
        if (stack) stack.amount += amount;
        else if (stacks(id)) inventory[inventory.indexOf(null)] = { id, amount };
        else for (let i = 0; i < amount; i++) inventory[inventory.indexOf(null)] = { id, amount: 1 };
      },
    }),
  };
  return player;
}

const item = (name, amount = 1) => ({ id: obj(name), amount });
const site = (player, field) => State.get(player, SITE, field);
const click = (player, name, option, objectId = SITE_BASE) => hooks.objects[name][option]({ player, objectId });
const ticks = (count) => { for (let i = 0; i < count; i++) TaskManager.process(); };

function setAnimals(player, animals) {
  State.set(player, SITE, { animal_1: animals[0], animal_2: animals[1], animal_3: animals[2] });
}

/** Builds and carves a totem of this wood at site 3 with these animals. */
function carvedTotem(player, woodIndex, animals) {
  State.erect(player, SITE, woodIndex);
  for (const animal of animals) State.carve(player, SITE, animal, Shared.DATA.woods[woodIndex - 1].durability);
}

test("the data: every gameval it names exists in the cache, and each site's locs are the captured ids", () => {
  const { woods, loot, animals } = Shared.DATA;
  for (const wood of woods) {
    for (const name of [wood.log, ...wood.decorations]) assert.notEqual(obj(name), null, name);
  }
  const lootItems = [...loot.uniques, ...loot.table.filter((entry) => entry.item), ...loot.roots, ...loot.nests, ...loot.seedTiers.flatMap((tier) => tier.seeds)];
  for (const entry of lootItems) assert.notEqual(obj(entry.item), null, entry.item);
  for (const animal of animals) assert.notEqual(obj(`ent_totems_animal_icon_${animal.key}_disabled`), null);
  for (const { site: number } of Shared.DATA.sites) {
    assert.equal(CacheDefinitions.getLocId(`ent_totems_site_${number}_base`), 57016 + 6 * (number - 1));
    assert.notEqual(CacheDefinitions.getNpcId(`ent_totems_site_${number}_animal_e_1`), null);
  }
  assert.equal(State.siteOfLoc(SITE_BASE), SITE);
  assert.equal(State.siteOfLoc(SITE_OFFERINGS), SITE);
  assert.equal(CacheDefinitions.getItem(obj("ent_totems_loot")).name, "Vale offerings");
});

test("as captured: Build - nothing to build with, too low a level, then the best log a tick later and the carve menu", () => {
  const empty = createPlayer();
  click(empty, "Totem site", "Build");
  assert.deepEqual(empty.messages, ["You don't have any logs to build a totem with."]);

  const low = createPlayer({ fletching: 40, items: [item("maple_logs")] });
  click(low, "Totem site", "Build");
  assert.deepEqual(low.messages, ["You need a Fletching level of 50 to build a maple totem."]);

  const player = createPlayer({ fletching: 55, items: [item("oak_logs"), item("maple_logs"), item("yew_logs"), item("knife")] });
  click(player, "Totem site", "Build");
  assert.equal(site(player, "base"), 0, "a tick after arriving");
  ticks(1);
  assert.deepEqual([site(player, "base"), site(player, "base_multiloc"), site(player, "low"), site(player, "mid"), site(player, "top")], [3, 3, 3, 3, 3]);
  assert.equal(player.getInventory().contains(obj("maple_logs")), false, "the maple log, the best the level allows");
  assert.deepEqual(player.messages, ["You erect a maple totem."]);
  assert.equal(player.xp.fletching, 50.8);
  assert.equal(player.getRunEnergy(), 65, "15% run energy");
  const menu = player.menu();
  assert.equal(menu.getTitle(), "What animal would you like to carve?");
  assert.deepEqual(menu.getOptions().labels, ["Buffalo", "Jaguar", "Eagle", "Snake", "Scorpion"]);
  assert.deepEqual([menu.getOptions().mode, menu.getOptions().maxAmount, menu.getOptions().lastAmount], [34, 1, 1]);
});

test("as captured: three carvings - each sets its piece to 9 + the animal; the last sets the carved base and durability", () => {
  const player = createPlayer({ items: [item("knife")] });
  State.erect(player, SITE, 1);
  click(player, "Oak totem", "Carve");
  player.menu().execute(obj("ent_totems_animal_icon_a"));
  assert.equal(site(player, "low"), 10);
  assert.deepEqual(player.messages, ["You carve a buffalo into the totem."]);
  click(player, "Oak totem", "Carve");
  assert.equal(player.menu().getItems()[0], obj("ent_totems_animal_icon_a_disabled"), "a carved animal is greyed out");
  player.menu().execute(obj("ent_totems_animal_icon_a_disabled"));
  assert.equal(site(player, "mid"), 1, "and can't be carved again");
  player.menu().execute(obj("ent_totems_animal_icon_d"));
  click(player, "Oak totem", "Carve");
  player.menu().execute(obj("ent_totems_animal_icon_c"));
  assert.deepEqual([site(player, "mid"), site(player, "top")], [13, 12]);
  assert.deepEqual([site(player, "base_carved"), site(player, "base_multiloc"), site(player, "decay")], [1, 9, 2]);
  assert.equal(player.xp.fletching, 12.5 * 3);
});

test("as captured: decorating - an item every two ticks, the fourth is the final one, a fifth is refused", () => {
  const player = createPlayer({ items: [item("unstrung_oak_shortbow"), item("oak_shortbow"), item("oak_shield"), item("xbows_crossbow_stock_oak"), item("unstrung_willow_shortbow")] });
  setAnimals(player, [1, 4, 3]);
  carvedTotem(player, 1, [1, 4, 3]);
  click(player, "Oak totem", "Decorate");
  assert.equal(site(player, "decorations"), 0);
  ticks(1);
  assert.equal(site(player, "decorations"), 1);
  ticks(6);
  assert.equal(site(player, "decorations"), 4);
  assert.deepEqual(player.messages, ["You decorate the totem.", "You decorate the totem.", "You decorate the totem.", "You add the final decoration to the totem."]);
  assert.equal(player.getInventory().contains(obj("unstrung_willow_shortbow")), true, "only the totem's own wood");
  assert.equal(Math.round(player.xp.fletching * 10), 2048);
  click(player, "Oak totem", "Decorate");
  assert.deepEqual(player.said, ["You have already added as many decorations as possible to the<br>totem."]);
});

test("Wiki: each wrong animal takes 25% off the decoration xp; nothing to decorate with says so", () => {
  const player = createPlayer({ items: [item("oak_shield")] });
  setAnimals(player, [1, 4, 3]);
  carvedTotem(player, 1, [1, 4, 5]);
  click(player, "Oak totem", "Decorate");
  ticks(2);
  assert.equal(Math.round(player.xp.fletching * 10), 384, "51.2 x 0.75");
  const none = createPlayer();
  carvedTotem(none, 1, [1, 4, 3]);
  click(none, "Oak totem", "Decorate");
  assert.deepEqual(none.messages, ["You don't have anything to decorate the totem with."]);
});

test("captured visits: the Wiki's offerings per wood, a point of durability each, the collapse on the last", () => {
  const perVisit = { 1: 10, 2: 10, 3: 10, 4: 13, 5: 15, 6: 15 };
  for (const [wood, offerings] of Object.entries(perVisit)) {
    const player = createPlayer();
    setAnimals(player, [2, 5, 4]);
    carvedTotem(player, Number(wood), [2, 5, 4]);
    State.set(player, SITE, { decorations: 4 });
    Ents.visitAll(player);
    assert.equal(site(player, "points"), offerings, `wood ${wood}`);
    assert.equal(site(player, "decay"), Shared.DATA.woods[wood - 1].durability - 1);
  }
  const bare = createPlayer();
  setAnimals(bare, [2, 5, 4]);
  carvedTotem(bare, 3, [2, 5, 4]);
  Ents.visitAll(bare);
  assert.equal(site(bare, "points"), 2, "no decorations: the base");

  const oak = createPlayer();
  setAnimals(oak, [1, 3, 4]);
  carvedTotem(oak, 1, [1, 3, 4]);
  State.set(oak, SITE, { decorations: 4 });
  Ents.visitAll(oak);
  Ents.visitAll(oak);
  assert.equal(site(oak, "points"), 20);
  assert.deepEqual([site(oak, "base"), site(oak, "base_carved"), site(oak, "low"), site(oak, "decorations"), site(oak, "decay")], [0, 0, 0, 0, 0], "an oak totem lasts two visits");
});

test("captured visit: one wrong animal on a decorated maple totem leaves 6", () => {
  const player = createPlayer();
  setAnimals(player, [4, 5, 3]);
  carvedTotem(player, 3, [2, 3, 4]);
  State.set(player, SITE, { decorations: 4 });
  Ents.visitAll(player);
  assert.equal(site(player, "points"), 6);
});

test("Wiki: spirits change at sites with no totem, never at a built one", () => {
  const player = createPlayer();
  setAnimals(player, [1, 2, 3]);
  State.erect(player, SITE, 1);
  for (let i = 0; i < 20; i++) Ents.visitAll(player);
  assert.deepEqual(State.animals(player, SITE), [1, 2, 3], "an uncarved totem keeps them and gets nothing");
  assert.equal(site(player, "points"), 0);
  const empty = createPlayer();
  Ents.visitAll(empty);
  const animals = State.animals(empty, SITE);
  assert.equal(new Set(animals).size, 3);
  for (const animal of animals) assert.ok(animal >= 1 && animal <= 5);
  const shown = Shared.DATA.animals.filter((animal, index) => State.get(empty, SITE, `multianimal_${animal.key}_1`) === 1).map((_, i) => i);
  assert.equal(shown.length, 3, "the three spirit NPCs show");
});

test("as captured: claiming the pile, inspecting it, and the 15,000 limit", () => {
  const player = createPlayer();
  State.set(player, SITE, { points: 10 });
  click(player, "Offerings", "Inspect", SITE_OFFERINGS);
  assert.deepEqual(player.said, ["There are ten offerings here."]);
  click(player, "Offerings", "Claim", SITE_OFFERINGS);
  ticks(1);
  assert.deepEqual(player.messages, ["You collect 10 offerings."]);
  assert.equal(player.getInventory().getAmount(obj("ent_totems_loot")), 10);
  assert.equal(site(player, "points"), 0);
  const full = createPlayer({ items: [item("oak_logs")] });
  State.set(full, SITE, { points: 15000 });
  click(full, "Totem site", "Build");
  assert.deepEqual(full.said, ["You should take some of the offerings already here before building a new totem."]);
});

test("as captured: rummaging - 100 at a time every two ticks, a research point each, the first one announced", () => {
  const player = createPlayer({ items: [item("ent_totems_loot", 250)] });
  hooks.items["Vale offerings"].Rummage({ player });
  ticks(4);
  assert.equal(player.getInventory().getAmount(obj("ent_totems_loot")), 50);
  assert.equal(State.researchPoints(player), 2);
  assert.equal(player.messages.filter((text) => text === "You rummage through the offerings...").length, 2);
  assert.ok(player.messages.includes("<col=229628>You now have 1 Vale Research Point!</col>"));
  assert.ok(player.messages.includes("Ranulph offers rewards to those who help with his research."));
  assert.ok(player.messages.some((text) => text.startsWith("You find some loot: ")));
  hooks.items["Vale offerings"].Rummage({ player });
  assert.deepEqual(player.said, ["You don't have enough offerings to rummage through.<br>You need at least 100."]);
});

test("as captured: hasty-rummage takes up to five at once; Inspect counts them", () => {
  const player = createPlayer({ items: [item("ent_totems_loot", 430)] });
  hooks.items["Vale offerings"].Inspect({ player });
  assert.equal(player.said[0], "You have enough offerings to rummage through them <col=06600c>4<br><col=06600c>times</col>.<br><br>You've earned <col=06600c>0 Vale Research Points</col>.");
  hooks.items["Vale offerings"]["Hasty-rummage"]({ player });
  assert.equal(player.messages[0], "You rummage through the offerings four times...");
  assert.equal(player.getInventory().getAmount(obj("ent_totems_loot")), 30);
  assert.equal(State.researchPoints(player), 4);
});

test("a full inventory can't rummage, even when the loot would join a stack it holds", () => {
  const full = Array.from({ length: 28 }, (_, slot) => (slot === 0 ? item("ent_totems_loot", 500)
    : slot === 1 ? item("dirty_arrowtips", 30) : slot === 2 ? item("feather", 100) : item("oak_logs")));
  const player = createPlayer({ items: full });
  hooks.items["Vale offerings"].Rummage({ player });
  ticks(4);
  hooks.items["Vale offerings"]["Hasty-rummage"]({ player });
  assert.equal(player.getInventory().getAmount(obj("ent_totems_loot")), 500);
  assert.equal(State.researchPoints(player), 0);
  assert.deepEqual(player.messages, ["You don't have enough inventory space.", "You don't have enough inventory space."]);
});
