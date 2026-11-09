// Run after `yarn build`: node --test tests/colossal-wyrm-agility.test.cjs
//
// The Colossal Wyrm Agility Course's termites (Wiki; rsprox 237/01106, 237/01108) and Worm
// Tongue's Wares, the cache omnishop that takes them (#3908).
const assert = require("node:assert/strict");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

const Wyrm = require("../plugins/areas/ColossalWyrmAgility.plugin");
const { Loc } = require("../plugins/skills/agility/courses/ColossalWyrmSteps.Agility");

let core;
let hooks;
const random = Math.random;

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const events = new Map();
  const buttons = new Map();
  hooks = { events, buttons, npcs: {}, login: [], floor: [], courseItems: [] };
  const api = {
    core,
    persistAttribute() {},
    onPlayerLogin: (fn) => hooks.login.push(fn),
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onCustomEvent(name, fn) { (events.get(name) ?? events.set(name, []).get(name)).push(fn); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); },
    onInterfaceActionButton(ids, fn) { for (const id of [ids].flat()) buttons.set(id, fn); },
    getItemOnGroundManager: () => ({ registerLocation: (player, item) => hooks.floor.push(item) }),
  };
  api.onCustomEvent("agility:course-item", (request) => hooks.courseItems.push({ ...request }));
  require("../plugins/interface/Omnishop.plugin").register(api);
  Wyrm.register(api);
  hooks.api = api;
});

afterEach(() => {
  Math.random = random;
  hooks.floor.length = 0;
  hooks.courseItems.length = 0;
});

/** A real player with only the network stubbed; varbits, sounds and map anims are recorded. */
function createPlayer() {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  player.setUsername("wyrmtester");
  player.setLocation(new core.Location(1649, 2910, 1));
  const state = { messages: [], varbits: new Map(), sounds: [], graphics: [], areaSounds: [] };
  player.sendMessage = (text) => state.messages.push(text);
  const sender = player.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { state.varbits.set(id, value); return sendVarbit(id, value); };
  sender.sendSoundEffect = (id) => { state.sounds.push(id); return sender; };
  sender.sendGraphic = (graphic, at) => { state.graphics.push([graphic.id, at.getX(), at.getY(), at.getZ()]); return sender; };
  player.state = state;
  return player;
}

const MARKER_VARBIT = 11412; // varlamore_wyrm_agility_termite_obstacle

/** Math.random answering `values` in order, then the last one. */
function randoms(...values) {
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
}

test("the marker varbit and markers are the cache's", () => {
  assert.equal(core.CacheDefinitions.getVarbitId("varlamore_wyrm_agility_termite_obstacle"), MARKER_VARBIT);
  assert.deepEqual(Object.keys(Wyrm.MARKERS).map(Number), [1, 2, 3, 4, 5, 8, 9, 10]);
  // Every course marker is collected by an obstacle on that course's route.
  const collected = [...Wyrm.OBSTACLE_MARKERS.values()].flat();
  for (const markers of Object.values(Wyrm.COURSE_MARKERS)) for (const marker of markers) assert.ok(collected.includes(marker), marker);
});

test("a lap spawns termites on one of its own course's markers, and a lap without keeps them", () => {
  const player = createPlayer();
  randoms(Wyrm.SPAWN_CHANCE - 0.01, 0.99); // spawns, the last of the advanced course's markers
  hooks.api.emitCustomEvent("agility:lap", { player, course: "wyrm-advanced", laps: 1, count: 1 });
  assert.equal(player.getAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE), 10);
  assert.equal(player.state.varbits.get(MARKER_VARBIT), 10);

  randoms(Wyrm.SPAWN_CHANCE + 0.01);
  hooks.api.emitCustomEvent("agility:lap", { player, course: "wyrm-basic", laps: 1, count: 1 });
  assert.equal(player.getAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE), 10, "no spawn leaves the old marker (rsprox 237/01106)");

  randoms(0, 0.5); // spawns, the third of the basic course's markers
  hooks.api.emitCustomEvent("agility:lap", { player, course: "wyrm-basic", laps: 2, count: 1 });
  assert.equal(player.state.varbits.get(MARKER_VARBIT), 3, "a new spawn replaces one not yet collected");

  randoms(0);
  hooks.api.emitCustomEvent("agility:lap", { player, course: "gnome", laps: 1, count: 1 });
  assert.equal(player.state.varbits.get(MARKER_VARBIT), 3, "other courses spawn none");
});

test("finishing the obstacle that ends at the marker scoops the termites and bone shards (rsprox 237/01108)", () => {
  const player = createPlayer();
  player.setAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE, 2);

  hooks.api.emitCustomEvent("agility:obstacle", { player, objectId: Loc.BASIC_TIGHTROPE, location: null, shortcut: null });
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.TERMITES), 0, "another obstacle scoops nothing");

  randoms(0.99, 0.5, 0.99); // the most termites, shards (0.5 < 80%), the most shards
  hooks.api.emitCustomEvent("agility:obstacle", { player, objectId: Loc.TIGHTROPE, location: null, shortcut: null });
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.TERMITES), 14, "11-14 on a shared marker");
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.BLESSED_BONE_SHARDS), 38);
  assert.deepEqual(player.state.messages, [
    "You managed to scoop up <col=ff3045>14 termites</col>!",
    "You also find <col=ff3045>38 piles of bone shards</col> they chipped off!",
  ]);
  assert.equal(player.getAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE), 0);
  assert.equal(player.state.varbits.get(MARKER_VARBIT), 0);
  assert.deepEqual(player.state.sounds, [2581]);
  assert.deepEqual(player.state.graphics, [[2967, 1649, 2910, 1]], "wyrm_agility_termite_despawn on the marker");
  assert.deepEqual(hooks.courseItems.map(({ itemId, amount }) => [itemId, amount]),
    [[core.ItemIdentifiers.TERMITES, 14], [core.ItemIdentifiers.BLESSED_BONE_SHARDS, 38]]);

  // An advanced marker: 16-21, and no shards on a roll of 80% or more.
  player.state.messages.length = 0;
  player.setAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE, 9);
  randoms(0, 0.8);
  hooks.api.emitCustomEvent("agility:obstacle", { player, objectId: Loc.ADVANCED_TIGHTROPE, location: null, shortcut: null });
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.TERMITES), 14 + 16);
  assert.deepEqual(player.state.messages, ["You managed to scoop up <col=ff3045>16 termites</col>!"]);
});

test("the marker is kept across logins", () => {
  const player = createPlayer();
  player.setAttribute(Wyrm.TERMITE_MARKER_ATTRIBUTE, 8);
  for (const fn of hooks.login) fn({ player });
  assert.equal(player.state.varbits.get(MARKER_VARBIT), 8);
});

/** Opens Worm Tongue's Shop option and buys a stock row through the omnishop list. */
function shop(player) {
  assert.equal(core.NpcDefinition.forId(13982).getActions()[2], "Shop", "Worm Tongue's op3 (cache)");
  hooks.npcs["Worm Tongue"].Shop({ player });
  const cache = core.CacheDefinitions;
  const row = cache.getDbRow(cache.getDbRowId(Wyrm.SHOP));
  const stock = row.column(cache.getDbColumn(row.tableId, "omnishop_shop_stock")).map(Number);
  return (rowName) => {
    const index = stock.indexOf(cache.getDbRowId(rowName));
    assert.ok(index >= 0, rowName);
    const buttonId = cache.getComponentId("omnishop_main:list");
    hooks.buttons.get(buttonId)({ player, buttonId, slot: index * 12, action: 2, handled: false });
  };
}

test("Worm Tongue's Wares sells at the Wiki's prices: 100, 40, 650 and 900 termites", () => {
  const player = createPlayer();
  const inventory = player.getInventory();
  const buy = shop(player);
  const { TERMITES, AMYLASE_PACK, COLOSSAL_WYRM_TELEPORT_SCROLL, CALCIFIED_ACORN } = core.ItemIdentifiers;
  inventory.adds(TERMITES, 99);
  buy("wyrm_agility_rewards_shop_stock_1");
  assert.equal(inventory.getAmount(AMYLASE_PACK), 0);
  assert.equal(player.state.messages.at(-1), "You don't have enough Termites.");
  inventory.adds(TERMITES, 1 + 40 + 900);
  buy("wyrm_agility_rewards_shop_stock_1");
  buy("wyrm_agility_rewards_shop_stock_2");
  buy("wyrm_agility_rewards_shop_stock_4");
  assert.equal(inventory.getAmount(AMYLASE_PACK), 1);
  assert.equal(inventory.getAmount(COLOSSAL_WYRM_TELEPORT_SCROLL), 1);
  assert.equal(inventory.getAmount(CALCIFIED_ACORN), 1);
  assert.equal(inventory.getAmount(TERMITES), 0);
});

test("the graceful crafting kit swaps a full plain graceful set for the Varlamore one", () => {
  const player = createPlayer();
  const inventory = player.getInventory();
  const buy = shop(player);
  const { TERMITES, GRACEFUL_CRAFTING_KIT } = core.ItemIdentifiers;
  const [plain, varlamore] = [0, 1].map((side) => Wyrm.GRACEFUL_MAKEOVER.map((pair) => core.ItemIdentifiers[pair[side]]));
  inventory.adds(TERMITES, 650);
  for (const id of plain.slice(0, 5)) inventory.adds(id, 1);
  buy("wyrm_agility_rewards_shop_stock_3");
  assert.equal(player.state.messages.at(-1), "You don't have enough Graceful Boots.");
  assert.equal(inventory.getAmount(TERMITES), 650, "nothing taken without the full set");

  inventory.adds(plain[5], 1);
  buy("wyrm_agility_rewards_shop_stock_3");
  assert.equal(inventory.getAmount(TERMITES), 0);
  for (const id of plain) assert.equal(inventory.getAmount(id), 0, `plain ${id} taken`);
  for (const id of varlamore) assert.equal(inventory.getAmount(id), 1, `Varlamore ${id} given`);
  assert.equal(inventory.getAmount(GRACEFUL_CRAFTING_KIT), 0, "no kit is handed over");
});
