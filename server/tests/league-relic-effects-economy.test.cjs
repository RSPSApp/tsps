// Run after `yarn build`: node --test tests/league-relic-effects-economy.test.cjs
// The economy and farming relics (docs/leagues.md): Fire Sale and Farmer's Fortune (Trailblazer
// Reloaded), Golden God, Overgrown and Pocket Kingdom (Raging Echoes). Each works for a character of
// its league who chose it, and for nobody else: not a character of that league without it, not the
// other league's character with the same slots, not a main character. Through the owners' own
// code: the shop's buy and sell, the alchemy cast, the bone altars' offering, Farming's planting
// and picking, and Managing Miscellania's upkeep.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameConstants } = require("../dist/game/GameConstants");
const { Skill } = require("../dist/game/model/Skill");
const { Location } = require("../dist/game/model/Location");
const { Item } = require("../dist/game/model/Item");
const { ShopDefinition } = require("../dist/game/definition/ShopDefinition");
const { ShopManager } = require("../dist/game/model/container/shop/ShopManager");
const { MagicOnItemPacketListener } = require("../dist/net/packet/impl/MagicOnItemPacketListener");

let core;
const hooks = {};
const custom = {};
const itemActions = new Map();
const realRandom = Math.random;
let cycle = 100;
let realCycle;
let I;
let Data;
let Model;
let Patches;
let Guild;
let Vault;
let Kingdom;
const farming = {};
let farmingOptionHandler;
const harvestEvents = new WeakMap();
const onlineFixtures = new WeakMap();
const onlineActors = new WeakSet();
const plantingObservers = new WeakMap();
const observedPinChecks = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // Item values, sellability and alchemy values (data/definitions/item-gameplay.json).
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  I = core.ItemIdentifiers;
  realCycle = core.World.getProcessCycle;
  core.World.getProcessCycle = () => cycle;
  GameConstants.setWorldProfile("league"); // a Trailblazer Reloaded world (the league type is the plugin config below)
  // Core and Farming emit through the real PluginManager; the plugins here emit through this api.
  const real = PluginManager.createApi("LeagueRelicEconomyTest");
  real.onCustomEvent("farming:plant-rules", (event) => plantingObservers.get(event.player)?.(event));
  real.onCustomEvent("bank-pin:guard", ({ player }) => {
    const observed = observedPinChecks.get(player);
    if (observed) observed.count++;
  });
  for (const name of ["farming:harvested", "farming:harvest"]) real.onCustomEvent(name, (event) => {
    const counts = harvestEvents.get(event.player);
    if (counts) counts[name] = (counts[name] ?? 0) + 1;
  });
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
    getPluginConfig: (key, fallback) => (key === "league:type" ? 4 : fallback),
    setWorldProfile: (profile) => GameConstants.setWorldProfile(profile),
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    getAreaManager: () => ({ inMulti: () => false }),
    registerCommand: (name, handler) => (hooks[`command:${name}`] = handler),
    registerMagicAttackAccuracyModifier() {},
    registerMagicDamageBonusModifier() {},
    registerMeleeAttackAccuracyModifier() {},
    registerRangedAttackAccuracyModifier() {},
    registerMeleeDefenseModifier() {},
    registerMagicDefenseModifier() {},
    registerWeaponProfile() {},
    registerRangedAmmoHandler() {},
    onItemAction: (name, actions) => itemActions.set(name, { ...(itemActions.get(name) ?? {}), ...actions }),
    onInterfaceActionButton: (ids, handler) => {
      for (const id of [].concat(ids)) on(`button:${id}`)(handler);
    },
    onCanGainExperience: (handler) => {
      on("onCanGainExperience")(handler);
      real.onCanGainExperience((event) => { if (onlineActors.has(event.player)) handler(event); });
    },
    onCustomEvent: (name, handler) => {
      custom[name] = (custom[name] ?? []).concat(handler);
      real.onCustomEvent(name, handler);
    },
    emitCustomEvent: (name, payload) => {
      for (const handler of custom[name] ?? []) handler(payload);
    },
  }, { get: (target, key) => (key in target ? target[key] : on(String(key))) });
  require("../plugins/modes/LeagueMode.plugin").register(api);
  require("../plugins/modes/LeaguePoints.plugin").register(api);
  require("../plugins/modes/LeagueRelics.plugin").register(api);
  require("../plugins/skills/Prayer.plugin").register(api);
  require("../plugins/skills/BoneAltars.plugin").register(api);
  Kingdom = require("../plugins/world/managingmiscellania/Common.ManagingMiscellania");
  require("../plugins/world/managingmiscellania/Ghrim.ManagingMiscellania")(api);

  require("../plugins/skills/farming/Core.Farming").init({ core });
  Data = require("../plugins/skills/farming/Data.Farming");
  Model = require("../plugins/skills/farming/Model.Farming");
  Patches = require("../plugins/skills/farming/Patches.Farming");
  Guild = require("../plugins/skills/farming/Guild.Farming");
  Vault = require("../plugins/skills/farming/Vault.Farming");
  Data.initializeFarmingData();
  Patches.attach(new Proxy({}, { get: (_, name) => (...args) => {
    farming[name] ??= args[0];
    if (name === "onInterfaceActionClick" && args[0].name === "farmingOptionClick") farmingOptionHandler = args[0];
  } }));
  api.onCustomEvent("farming:open-seed-vault", Guild.openSeedVault);
});

afterEach(() => {
  Math.random = realRandom;
});

test.after(() => {
  core.World.getProcessCycle = realCycle;
});

function emit(name, payload) {
  for (const handler of custom[name] ?? []) handler(payload);
  return payload;
}

/** A real player of `profile`, logged in, with the given relic picks (tier index -> slot). */
function character(name, profile, picks = {}, leagueType = 4) {
  const player = new Player(null);
  player.setUsername(name);
  player.setProfile(profile);
  player.setLocation(new Location(3200, 3200, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false); // in the world, as after the login's first tick
  player.interfaces = [];
  const sender = new Proxy({}, { get: (_, key) => (key === "sendInterface" ? (id) => { player.interfaces.push(id); return sender; }
    // A typed line (the farming spam) joins the game messages in the order it was sent.
    : key === "sendTypedMessage" ? (_type, text) => { player.messages.push(text); return sender; } : () => sender) });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.messages = [];
  player.sendMessage = (message) => player.messages.push(message);
  if (profile === "league") {
    player.setAttribute("league:type", leagueType);
    player.setAttribute("league:relics", picks);
  }
  hooks.onPlayerLogin({ player, username: name, isNewAccount: false, profile });
  return player;
}

function cases(picks, league = 4) {
  return {
    relic: character("relic", "league", picks, league),
    without: character("without", "league", {}, league),
    other: character("other", "league", picks, league === 4 ? 5 : 4),
    main: character("main", "main"),
  };
}

function others(who) {
  return [who.without, who.other, who.main];
}

const FIRE_SALE = { 2: 2 };
const FARMERS_FORTUNE = { 5: 2 };
const GOLDEN_GOD = { 3: 1 };
const POCKET_KINGDOM = { 6: 1 };
const OVERGROWN = { 6: 3 };

// --- Shops

const COIN_SHOP = 990001;
const TOKKUL_SHOP = 990002;

function shops() {
  ShopDefinition.replace([
    new ShopDefinition(COIN_SHOP, "Test Axes", "COINS", [
      { id: I.STEEL_AXE, amount: 5, restockTicks: null, price: null },
      { id: I.FIRE_RUNE, amount: 500, restockTicks: null, price: null },
    ], 100, 100, 100, "test"),
    new ShopDefinition(TOKKUL_SHOP, "Test Tokkul", "TOKKUL", [
      { id: I.STEEL_AXE, amount: 5, restockTicks: null, price: null },
    ], 100, 100, 100, "test"),
  ]);
  ShopManager.initialize();
}

function buy(player, shopId, displaySlot, itemId, option = "Buy 1") {
  ShopManager.open(player, shopId);
  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.MAIN_INTERFACE_ID, childId: 16, buttonNum: 0, option, slot: displaySlot + 1, itemId,
  });
}

function sell(player, shopId, slot) {
  ShopManager.open(player, shopId);
  ShopManager.handleWidgetAction(player, {
    groupId: ShopManager.SIDE_INTERFACE_ID, childId: 0, buttonNum: 0, option: "Sell 1", slot,
  });
}

const amount = (player, itemId) => player.getInventory().getAmount(itemId);
const notedOf = (itemId) => core.ItemDefinition.forId(itemId).getNoteId();

test("Fire Sale: coin shops sell for nothing, noted when they can be; they buy nothing for coins; Tokkul shops as usual", () => {
  shops();
  const who = cases(FIRE_SALE);
  buy(who.relic, COIN_SHOP, 0, I.STEEL_AXE, "Buy 5");
  assert.equal(amount(who.relic, notedOf(I.STEEL_AXE)), 5, "five steel axes, noted, with no coins at all");
  assert.equal(amount(who.relic, I.STEEL_AXE), 0);
  buy(who.relic, COIN_SHOP, 0, I.STEEL_AXE);
  assert.equal(amount(who.relic, notedOf(I.STEEL_AXE)), 5, "the stock still limits it: none left");
  buy(who.relic, COIN_SHOP, 1, I.FIRE_RUNE, "Buy 50");
  assert.equal(amount(who.relic, I.FIRE_RUNE), 50, "runes have no note: they come as they are");
  buy(who.relic, TOKKUL_SHOP, 0, I.STEEL_AXE);
  assert.equal(amount(who.relic, I.STEEL_AXE), 0, "a Tokkul shop still wants Tokkul");

  who.relic.getInventory().add(new Item(I.STEEL_AXE, 1), false);
  const slot = who.relic.getInventory().getSlotForItemId(I.STEEL_AXE);
  sell(who.relic, COIN_SHOP, slot);
  assert.equal(amount(who.relic, I.STEEL_AXE), 1, "a coin shop buys nothing from the relic");
  assert.equal(amount(who.relic, I.COINS), 0);
  const value = { player: who.relic, currency: "COINS", itemId: I.STEEL_AXE, buyPrice: 200, price: 130 };
  PluginManager.emitCustomEvent("shop:sell-price", value);
  assert.equal(value.price, 0, "the shop shows nothing to be had for it");
  const tokkul = { player: who.relic, currency: "TOKKUL", itemId: I.STEEL_AXE, sellable: true };
  PluginManager.emitCustomEvent("shop:can-sell", tokkul);
  assert.equal(tokkul.sellable, true, "selling for Tokkul is untouched");

  shops();
  for (const player of others(who)) {
    buy(player, COIN_SHOP, 0, I.STEEL_AXE);
    assert.equal(amount(player, I.STEEL_AXE) + amount(player, notedOf(I.STEEL_AXE)), 0, `${player.getUsername()} cannot afford it`);
    player.getInventory().add(new Item(I.COINS, 100000), false);
    buy(player, COIN_SHOP, 0, I.STEEL_AXE);
    assert.equal(amount(player, I.STEEL_AXE), 1, `${player.getUsername()} buys it unnoted`);
    assert.ok(amount(player, I.COINS) < 100000, `${player.getUsername()} pays for it`);
    const coins = amount(player, I.COINS);
    sell(player, COIN_SHOP, player.getInventory().getSlotForItemId(I.STEEL_AXE));
    assert.equal(amount(player, I.STEEL_AXE), 0, `${player.getUsername()} sells it back ${player.messages.join(" | ")}`);
    assert.ok(amount(player, I.COINS) > coins);
  }
});

// --- Alchemy

const listener = new MagicOnItemPacketListener();
const HIGH = MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID;

function alch(player, itemId) {
  cycle += 10;
  listener.castAlchemy(player, HIGH, player.getInventory().getSlotForItemId(itemId), itemId);
}

test("Golden God: High Alchemy with no runes or level, 15% more coins, a 65% chance to keep the item, cast again on the stack", () => {
  const who = cases(GOLDEN_GOD, 5);
  const value = core.ItemDefinition.forId(I.RUNE_PLATEBODY).getHighAlchValue();
  assert.ok(value > 0);
  who.relic.getInventory().add(new Item(I.RUNE_PLATEBODY, 1), false);
  Math.random = () => 0.5;
  alch(who.relic, I.RUNE_PLATEBODY);
  assert.equal(amount(who.relic, I.COINS), Math.floor((value * 115) / 100), "Magic level 1, no runes, 15% more coins");
  assert.equal(amount(who.relic, I.RUNE_PLATEBODY), 1, "a 50 keeps the item (65%)");
  assert.deepEqual(who.relic.getAttribute("magic:alchemy-queued")?.itemId, I.RUNE_PLATEBODY, "and the next cast waits on it");
  who.relic.setAttribute("magic:alchemy-queued", null);
  Math.random = () => 0.9;
  alch(who.relic, I.RUNE_PLATEBODY);
  assert.equal(amount(who.relic, I.RUNE_PLATEBODY), 0, "a 90 uses it");
  assert.equal(who.relic.getAttribute("magic:alchemy-queued"), null, "nothing left to cast on");

  // A kept item frees no slot: with a full inventory and no coins, the cast waits for room.
  const full = character("full", "league", GOLDEN_GOD, 5);
  full.getInventory().add(new Item(I.RUNE_PLATEBODY, 1), false);
  full.getInventory().add(new Item(I.BRONZE_DAGGER, 1), false);
  while (full.getInventory().getFreeSlots() > 0) full.getInventory().add(new Item(I.BRONZE_DAGGER, 1), false);
  Math.random = () => 0.5;
  alch(full, I.RUNE_PLATEBODY);
  assert.equal(amount(full, I.RUNE_PLATEBODY), 1);
  assert.equal(amount(full, I.COINS), 0);
  assert.equal(full.getSkillManager().getExperience(Skill.MAGIC), 0, "no cast, no XP, no coins lost");
  assert.match(full.messages.at(-1), /enough inventory space/);
  Math.random = () => 0.9;
  alch(full, I.RUNE_PLATEBODY);
  assert.equal(amount(full, I.RUNE_PLATEBODY), 0, "a used item's slot holds the coins");
  assert.equal(amount(full, I.COINS), Math.floor((value * 115) / 100));

  // Any character: a full inventory, no coins, two noted platebodies and exactly the last runes. The
  // runes' slots come free as the cast uses them, so the coins have a place.
  const ordinary = character("lastrunes", "main");
  const notedPlate = core.ItemDefinition.forId(I.RUNE_PLATEBODY).getNoteId();
  ordinary.getSkillManager().setCurrentLevel(Skill.MAGIC, 99, false);
  ordinary.getInventory().add(new Item(notedPlate, 2), false).add(new Item(I.NATURE_RUNE, 1), false).add(new Item(I.FIRE_RUNE, 5), false);
  while (ordinary.getInventory().getFreeSlots() > 0) ordinary.getInventory().add(new Item(I.BRONZE_DAGGER, 1), false);
  alch(ordinary, notedPlate);
  assert.equal(amount(ordinary, notedPlate), 1, "cast with the last runes");
  assert.equal(amount(ordinary, I.COINS), value);
  assert.equal(amount(ordinary, I.NATURE_RUNE) + amount(ordinary, I.FIRE_RUNE), 0);

  for (const player of others(who)) {
    player.getInventory().add(new Item(I.RUNE_PLATEBODY, 1), false);
    alch(player, I.RUNE_PLATEBODY);
    assert.equal(amount(player, I.RUNE_PLATEBODY), 1, `${player.getUsername()} needs the level`);
    assert.match(player.messages.at(-1), /Magic level of 55/);
    player.getSkillManager().setCurrentLevel(Skill.MAGIC, 99, false);
    alch(player, I.RUNE_PLATEBODY);
    assert.equal(amount(player, I.RUNE_PLATEBODY), 1, `${player.getUsername()} needs the runes`);
    player.getInventory().add(new Item(I.NATURE_RUNE, 1), false).add(new Item(I.FIRE_RUNE, 5), false);
    alch(player, I.RUNE_PLATEBODY);
    assert.equal(amount(player, I.RUNE_PLATEBODY), 0, `${player.getUsername()} alchs it as usual`);
    assert.equal(amount(player, I.COINS), value);
  }
});

test("Golden God: automatic recasts execute with the original item and reject a replaced copy", (t) => {
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => tasks.push(task));
  const player = character("autorecast", "league", GOLDEN_GOD, 5);
  const value = Math.floor(core.ItemDefinition.forId(I.RUNE_PLATEBODY).getHighAlchValue() * 115 / 100);
  player.getInventory().add(new Item(I.RUNE_PLATEBODY, 1), false);
  Math.random = () => 0.5;
  alch(player, I.RUNE_PLATEBODY);
  const queued = player.getAttribute("magic:alchemy-queued");
  assert.equal(queued.item, player.getInventory().getItems()[queued.slot]);
  const firstRecast = tasks.at(-1);
  cycle += 5;
  firstRecast.execute();
  assert.equal(amount(player, I.COINS), value * 2, "the automatic cast runs after the cooldown");
  const replacementRecast = tasks.at(-1);
  player.getInventory().setItem(queued.slot, new Item(I.RUNE_PLATEBODY, 1));
  cycle += 5;
  replacementRecast.execute();
  assert.equal(amount(player, I.COINS), value * 2, "a same-id replacement is never borrowed by a stale cast");
});

test("Golden God: another plugin's alchemy (a cast worth no coins) keeps only the free runes and the level", () => {
  const who = cases(GOLDEN_GOD, 5);
  const policy = { player: who.relic, itemId: I.RUNE_PLATEBODY, allowed: true, coins: 0, requiredLevel: 55, freeRunes: false, keepItem: false, recast: false };
  PluginManager.emitCustomEvent("magic:alchemy-policy", policy);
  assert.deepEqual([policy.requiredLevel, policy.freeRunes, policy.keepItem, policy.recast, policy.coins], [0, true, false, false, 0]);
});

// --- The altar

function altar() {
  const at = new Location(3200, 3201, 0);
  return { getId: () => 409, getLocation: () => at, getFace: () => 0, getDefinition: () => ({ getActions: () => ["Pray-at"] }) };
}

function offerCoins(player) {
  const event = { player, object: altar(), objectId: 409, itemId: I.COINS, location: { x: 3200, y: 3201, z: 0 }, handled: false };
  hooks.onItemOnObject(event);
  return event;
}

test("Golden God: 20,000 coins on an altar for a dragon bone's Prayer XP, and noted purchases at coin shops; nobody else's", () => {
  const who = cases(GOLDEN_GOD, 5);
  const bone = { itemId: I.DRAGON_BONES, bone: null };
  emit("prayer:bone", bone);
  who.relic.getInventory().add(new Item(I.COINS, 50000), false);
  const event = offerCoins(who.relic);
  assert.equal(event.handled, true);
  assert.equal(amount(who.relic, I.COINS), 30000, "one offering: 20,000 coins");
  assert.equal(who.relic.getSkillManager().getExperience(Skill.PRAYER), bone.bone.xp, "a dragon bone's burying XP at a plain altar");
  for (const player of others(who)) {
    player.getInventory().add(new Item(I.COINS, 50000), false);
    assert.equal(offerCoins(player).handled, false, `${player.getUsername()}'s coins are not an offering`);
    assert.equal(amount(player, I.COINS), 50000);
  }
  const delivery = (player, currency) => {
    const request = { player, currency, itemId: I.STEEL_AXE, deliverId: I.STEEL_AXE };
    PluginManager.emitCustomEvent("shop:delivery", request);
    return request.deliverId;
  };
  assert.equal(delivery(who.relic, "COINS"), notedOf(I.STEEL_AXE), "a coin shop's purchase comes noted");
  assert.equal(delivery(who.relic, "TOKKUL"), I.STEEL_AXE, "not another currency's");
  const price = { player: who.relic, currency: "COINS", itemId: I.STEEL_AXE, price: 200 };
  PluginManager.emitCustomEvent("shop:buy-price", price);
  assert.equal(price.price, 200, "Golden God's shops are not free (that is Fire Sale)");
  for (const player of others(who)) assert.equal(delivery(player, "COINS"), I.STEEL_AXE, player.getUsername());
  assert.equal(require("../plugins/modes/leaguerelics/Common.LeagueRelics").noted(notedOf(I.STEEL_AXE)), notedOf(I.STEEL_AXE), "a note stays a note");
});

test("Golden God: coins on the Chaos Temple's altar at its 3.5 times, kept half the time; a house's altars are the house's", () => {
  const who = cases(GOLDEN_GOD, 5);
  const bone = emit("prayer:bone", { itemId: I.DRAGON_BONES, bone: null }).bone;
  const data = require("../plugins/skills/data/bone-altars.json").altars[0];
  const chaos = (player) => {
    const at = new Location(data.x, data.y, data.z);
    const event = { player, objectId: core.CacheDefinitions.getLocId(data.loc), itemId: I.COINS, location: { x: data.x, y: data.y, z: data.z }, handled: false,
      object: { getId: () => core.CacheDefinitions.getLocId(data.loc), getLocation: () => at, getFace: () => 0, getDefinition: () => ({ getActions: () => ["Pray-at"] }) } };
    hooks.onItemOnObject(event);
    return event;
  };
  who.relic.getInventory().add(new Item(I.COINS, 50000), false);
  Math.random = () => 0.9;
  assert.equal(chaos(who.relic).handled, true);
  assert.equal(amount(who.relic, I.COINS), 30000);
  assert.equal(who.relic.getSkillManager().getExperience(Skill.PRAYER), Math.ceil(bone.xp * data.xpScale), "the altar's own experience");
  Math.random = () => 0.1;
  chaos(who.relic);
  assert.equal(amount(who.relic, I.COINS), 30000, "the altar spares the coins as it spares a bone");

  const host = character("host", "league", GOLDEN_GOD, 5);
  host.getInventory().add(new Item(I.COINS, 50000), false);
  host.getPrivateArea = () => ({});
  assert.equal(offerCoins(host).handled, false, "left to the house's own altar");
  assert.equal(amount(host, I.COINS), 50000);
});

// --- Farming

const HERB_PATCH = () => Data.CACHE.patches.find((patch) => patch.type === "HERB" && patch.x === 3058);

function farmer(player, patch, state = null) {
  const farm = { offset: 0, patches: {}, tools: {} };
  farm.patches[Data.patchKey(patch)] = state ?? Model.emptyPatch(Date.now(), farm);
  player.setAttribute(Patches.FARM_ATTRIBUTE, farm);
  player.moveTo(new Location(patch.x, patch.y, patch.z));
  player.performAnimation = () => {};
  player.busy = () => false;
  player.getClickDelay = () => ({ elapsedTime: () => true, reset() {} });
  player.getSkillManager().setMaxLevels(Skill.FARMING, 99, false).setCurrentLevel(Skill.FARMING, 99, false);
  for (const tool of ["Seed dibber", "Spade"]) player.getInventory().add(new Item(Data.itemId(tool)), false);
  return farm.patches[Data.patchKey(patch)];
}

/** Plants and lets the seed take root: three farming ticks after the dibbing, as captured. */
function plant(player, patch, seedId) {
  player.getInventory().add(new Item(seedId, 1), false);
  farming.onItemOnObject({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z },
    itemId: seedId, itemSlot: player.getInventory().getSlotForItemId(seedId) });
  for (let i = 0; i < 3; i++) Patches.tick();
}

/** One pick: the herb patch's swing on the click, its harvest the next farming tick, as captured. */
function pick(player, patch) {
  farming.onObjectInteraction({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z }, clickType: 1 });
  Patches.tick();
}

function mockScenery(t) {
  const farmingCore = require("../plugins/skills/farming/Core.Farming");
  const originals = ["MapObjects", "ObjectDefinition"].map((key) => [key, Object.getOwnPropertyDescriptor(farmingCore, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(farmingCore, key, descriptor);
      else delete farmingCore[key];
    }
  });
  farmingCore.MapObjects = { get: () => null, getType: () => null };
  farmingCore.ObjectDefinition = { forPlayer: () => ({ getInteractions: () => ["Pick"], getName: () => "Herb patch" }) };
  t.mock.method(require("../plugins/skills/farming/Services.Farming"), "cropRewards", () => {});
}

test("Farmer's Fortune: a 20% chance to keep the seed, grown at once and free of disease; 25 picks an action, triple and noted", (t) => {
  mockScenery(t);
  const patch = HERB_PATCH();
  assert.ok(patch, "Falador's herb patch");
  const guam = Data.itemId("Guam seed");
  const grimy = Data.itemId("Grimy guam leaf");
  const who = cases(FARMERS_FORTUNE);

  let state = farmer(who.relic, patch);
  Math.random = () => 0.1;
  plant(who.relic, patch, guam);
  assert.equal(amount(who.relic, guam), 1, "a 10 keeps the seed (20%)");
  assert.equal(state.status, "grown", "grown at once");
  assert.equal(state.diseaseFree, true, "and never diseased");
  assert.ok(state.lives > 0);
  const lives = state.lives;
  Math.random = () => 0.99;
  pick(who.relic, patch);
  assert.equal(amount(who.relic, notedOf(grimy)), lives * 3, "every herb in one action, three noted each");
  assert.equal(amount(who.relic, grimy), 0);

  state = farmer(who.relic, patch);
  who.relic.getInventory().resetItems();
  farmer(who.relic, patch, state);
  Math.random = () => 0.5;
  plant(who.relic, patch, guam);
  assert.equal(amount(who.relic, guam), 0, "a 50 uses it");

  for (const player of others(who)) {
    const theirs = farmer(player, patch);
    Math.random = () => 0.1;
    plant(player, patch, guam);
    assert.equal(amount(player, guam), 0, `${player.getUsername()} uses the seed`);
    assert.equal(theirs.status, "growing", `${player.getUsername()}'s herbs grow as usual`);
    assert.notEqual(theirs.diseaseFree, true);
    const grown = farmer(player, patch, { ...Model.emptyPatch(Date.now(), { offset: 0 }), crop: "GUAM", status: "grown", stage: Data.CROPS.get("GUAM").stages, lives: 3, checked: true });
    Math.random = () => 0.99;
    pick(player, patch);
    assert.equal(amount(player, grimy), 1, `${player.getUsername()} picks one herb an action`);
    assert.equal(amount(player, notedOf(grimy)), 0);
    assert.equal(grown.lives, 2);
  }
});

test("Overgrown: 75% to keep the seed, crops never die; the vault opens the seed vault anywhere", (t) => {
  mockScenery(t);
  const patch = HERB_PATCH();
  const guam = Data.itemId("Guam seed");
  const who = cases(OVERGROWN, 5);
  const state = farmer(who.relic, patch);
  Math.random = () => 0.5;
  plant(who.relic, patch, guam);
  assert.equal(amount(who.relic, guam), 1, "a 50 keeps the seed (75%)");
  assert.deepEqual(who.relic.messages.slice(-2), ["You plant a guam seed in the herb patch.", "Botanical allows you to keep your guam seed."], "after the planting's own line");
  assert.equal(state.status, "growing", "no instant growth");
  assert.equal(state.undying, true);

  const farm = who.relic.getAttribute(Patches.FARM_ATTRIBUTE);
  Object.assign(state, { status: "diseased", stage: 2, nextAt: Date.now() - 1 });
  Model.advanceFarm(farm, Date.now() + 60 * 60 * 1000);
  assert.equal(state.status, "diseased", "the disease waits for a cure; it does not kill");

  const seedVault = core.CacheDefinitions.getInterfaceId?.("seed_vault") ?? null;
  who.relic.setNeedsPlacement(false); // the farm's move to the patch has been placed
  itemActions.get("Leprechaun's vault").Open({ player: who.relic, slot: 0 });
  assert.equal(who.relic.interfaces.length, 1, "the seed vault, far from the guild");
  if (seedVault != null) assert.equal(who.relic.interfaces[0], seedVault);

  for (const player of others(who)) {
    const theirs = farmer(player, patch);
    Math.random = () => 0.5;
    plant(player, patch, guam);
    assert.equal(amount(player, guam), 0, `${player.getUsername()} uses the seed`);
    assert.notEqual(theirs.undying, true);
    Object.assign(theirs, { status: "diseased", stage: 2, nextAt: Date.now() - 1 });
    Model.advanceFarm(player.getAttribute(Patches.FARM_ATTRIBUTE), Date.now() + 60 * 60 * 1000);
    assert.equal(theirs.status, "dead", `${player.getUsername()}'s diseased herbs die`);
    player.setNeedsPlacement(false);
    itemActions.get("Leprechaun's vault").Open({ player, slot: 0 });
    assert.equal(player.interfaces.length, 0, `${player.getUsername()}'s vault does nothing`);
  }
});

// Scope deterministic rolls to the function that actually consumes them; all other RNG is real.
function farmingRandom({ saveSeed = false, contractRoll = null } = {}) {
  const calls = { planting: 0, assignment: 0 };
  Math.random = () => {
    const frame = new Error().stack.split("\n")[2] ?? "";
    if (frame.includes("Overgrown.LeagueRelics.js") && /\bat (?:Object\.)?planting\b/.test(frame)) { calls.planting++; return saveSeed ? 0.1 : 0.99; }
    if (frame.includes("Patches.Farming.js") && /\bat (?:Object\.)?(?:automaticHerb|harvest)\b/.test(frame)) return 0.99;
    if (frame.includes("Model.Farming.js") && /\bat (?:Object\.)?advanceFarm\b/.test(frame)) return 0.99;
    if (contractRoll !== null && frame.includes("Guild.Farming.js") && /\bat (?:Object\.)?assign\b/.test(frame)) { calls.assignment++; return contractRoll; }
    return realRandom();
  };
  return calls;
}
// The automatic cycle uses the existing growth and vault actions, with an online tracked player.
function onlineHerb(t, name, picks = OVERGROWN, seedCount = 2, patch = HERB_PATCH(), compost = "Ultracompost", profile = "league", leagueType = 5) {
  let fixture = onlineFixtures.get(t);
  if (!fixture) {
    fixture = { players: [], errors: [] };
    onlineFixtures.set(t, fixture);
    const report = console.error.bind(console);
    t.mock.method(console, "error", (...args) => { fixture.errors.push(args); report(...args); });
    t.after(() => {
      for (const actor of fixture.players) {
        try { farming.onPlayerLogout({ player: actor }); Vault.logout({ player: actor }); }
        catch (error) { fixture.errors.push([error]); }
      }
      assert.deepEqual(fixture.errors, [], "no swallowed Farming errors or teardown failures");
    });
  }
  const player = character(name, profile, picks, leagueType);
  fixture.players.push(player);
  onlineActors.add(player);
  harvestEvents.set(player, {});
  const previousSender = player.getPacketSender();
  const sender = new Proxy(previousSender, { get(target, key) {
    return key === "getVarbit" || key === "getVarp" ? () => 0 : Reflect.get(target, key);
  } });
  player.getPacketSender = () => sender;
  const state = farmer(player, patch);
  const skill = player.getSkillManager();
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  skill.setExperience(Skill.FARMING, SkillManager.getExperienceForLevel(99));
  player.setNeedsPlacement(false);
  farming.onPlayerLogin({ player });
  const seed = Data.itemId("Guam seed"), herb = Data.itemId("Grimy guam leaf");
  assert.equal(seed, 5291, "active cache matches pinned guam_seed");
  assert.equal(herb, 199, "active cache matches pinned unidentified_guam");
  if (seedCount) depositSeeds(player, seed, seedCount);
  const ultra = Data.itemId(compost);
  player.getInventory().add(new Item(ultra), false);
  farming.onItemOnObject({ player, object: { getId: () => patch.id }, location: { x: patch.x, y: patch.y, z: patch.z },
    itemId: ultra, itemSlot: player.getInventory().getSlotForItemId(ultra) });
  for (let i = 0; i < 2; i++) Patches.tick();
  assert.equal(state.compost, compost === "Ultracompost" ? 3 : 2, "real compost action completed");
  plant(player, patch, seed);
  assert.equal(state.status, "growing", "manual seed planting completed");
  return { player, patch, state, seed, herb, farm: player.getAttribute(Patches.FARM_ATTRIBUTE) };
}
function depositSeeds(player, seed, count) {
  const farm = player.getAttribute(Patches.FARM_ATTRIBUTE);
  const before = farm.vault?.[seed] ?? 0;
  for (let i = 0; i < count; i++) player.getInventory().add(new Item(seed), false);
  const carried = amount(player, seed);
  player.getInterfaceId = () => core.CacheDefinitions.getInterfaceId("seed_vault");
  Vault.open({ player, anywhere: true });
  Vault.click({ player, buttonId: core.CacheDefinitions.getComponentId("seed_vault:deposit_all"), action: 1 });
  assert.equal(farm.vault[seed], before + carried, "vault deposit producer");
  assert.equal(amount(player, seed), 0);
}
function matureHerb(player) {
  const event = { player, ms: 4 * 60 * 60 * 1000, handledBy: [] };
  Patches.advanceTime(event);
  assert.deepEqual(event.handledBy, ["Farming"], "actual online growth hook");
}
function bankAmount(player, id) {
  return player.getBank(core.Bank.getTabForItem(player, id)).getAmount(id);
}

test("Overgrown: treated herbs mature online into bank and replant repeatedly from vault", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "autogrow", OVERGROWN, 2);
  const key = Data.patchKey(patch), xp = player.getSkillManager().getExperience(Skill.FARMING);
  const rewards = require("../plugins/skills/farming/Services.Farming").cropRewards;
  const skill = player.getSkillManager(), awardCalls = [], realAward = skill.addExperiences.bind(skill);
  const crop = Data.CROPS.get("GUAM");
  const pickGate = PluginManager.emitCanGainExperience(player, Skill.FARMING, crop.harvest);
  const plantGate = PluginManager.emitCanGainExperience(player, Skill.FARMING, crop.plant);
  assert.ok(pickGate.multiplier > 1, "registered League experience multiplier is active");
  const applied = (base, gate) => Math.floor(base * GameConstants.EXPERIENCE_MULTIPLIER * gate.multiplier * 10 + 1e-6) / 10;
  const expectedXp = 6 * applied(crop.harvest, pickGate) + applied(crop.plant, plantGate);
  t.mock.method(skill, "addExperiences", (which, xpAmount) => { awardCalls.push([which, xpAmount]); return realAward(which, xpAmount); });
  assert.equal(bankAmount(player, herb), 0);
  matureHerb(player);
  assert.equal(state.lives, 0);
  assert.equal(bankAmount(player, herb), 6, "six individual crops deposited");
  assert.equal(amount(player, herb), 0, "not carried");
  assert.equal(farm.vault[seed], 1, "one matching vault seed consumed");
  assert.equal(farm.patches[key].status, "growing");
  assert.equal(farm.patches[key].crop, "GUAM");
  assert.equal(farm.patches[key].compost, 3);
  assert.equal(Math.round((skill.getExperience(Skill.FARMING) - xp) * 10), Math.round(expectedXp * 10),
    "actual XP delta matches each native multiplied award exactly once");
  assert.deepEqual(awardCalls, [...Array(6)].map(() => [Skill.FARMING, crop.harvest]).concat([[Skill.FARMING, crop.plant]]),
    "each banked pick and the pending planting XP are awarded once at native base rates");
  assert.equal(rewards.mock.calls.length, 0, "no pet or Hespori roll");
  assert.deepEqual(harvestEvents.get(player), {}, "no manual harvesting or task events");
  matureHerb(player);
  assert.equal(bankAmount(player, herb), 12, "second real growth produces one more crop");
  assert.equal(farm.vault[seed], 0);
  assert.equal(farm.patches[key].status, "growing");
  matureHerb(player);
  assert.equal(bankAmount(player, herb), 12, "no vault seed means no later automatic harvest");
  assert.equal(farm.patches[key].status, "grown");
});

test("Overgrown: no matching seed and no relic leave a grown patch for manual harvest", (t) => {
  mockScenery(t);
  farmingRandom();
  for (const [name, picks, seedCount] of [["noseed", OVERGROWN, 0], ["norelic", {}, 2]]) {
    const { player, patch, state, herb } = onlineHerb(t, name, picks, seedCount);
    matureHerb(player);
    assert.equal(state.status, "grown");
    assert.equal(bankAmount(player, herb), 0);
    pick(player, patch);
    assert.equal(amount(player, herb), 1, "ordinary manual pick still works");
    assert.equal(harvestEvents.get(player)["farming:harvested"], 1, "observer sees the manual event");
  }
});

test("Overgrown: full bank defers without losing seed, herbs or XP", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, state, seed, herb, farm } = onlineHerb(t, "fullbank", OVERGROWN, 1);
  const bank = player.getBank(core.Bank.getTabForItem(player, herb));
  bank.add(new Item(herb, 2147483647), false);
  assert.equal(bank.getAmount(herb), 2147483647);
  const xp = player.getSkillManager().getExperience(Skill.FARMING);
  matureHerb(player);
  assert.equal(state.status, "grown");
  assert.equal(state.lives, 6);
  assert.equal(bank.getAmount(herb), 2147483647);
  assert.equal(farm.vault[seed], 1);
  assert.equal(player.getSkillManager().getExperience(Skill.FARMING), xp);
});

test("Overgrown: partially banked herbs resume once without duplicating output or seed", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "partial", OVERGROWN, 1);
  const bank = player.getBank(core.Bank.getTabForItem(player, herb));
  bank.add(new Item(herb, 2147483646), false);
  const xp = player.getSkillManager().getExperience(Skill.FARMING);
  matureHerb(player);
  assert.equal(bank.getAmount(herb), 2147483647);
  assert.equal(state.lives, 5);
  assert.equal(farm.vault[seed], 1, "seed remains until harvest completes");
  assert.ok(player.getSkillManager().getExperience(Skill.FARMING) > xp);
  bank.deleteNumber(herb, 10);
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(bank.getAmount(herb), 2147483642, "five remaining herbs deposited once");
  assert.equal(state.lives, 0);
  assert.equal(farm.vault[seed], 0);
  assert.equal(farm.patches[Data.patchKey(patch)].status, "growing");
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(bank.getAmount(herb), 2147483642, "refresh cannot duplicate harvest");
});

test("Overgrown: a manual pick cancels the partial cycle on the same patch state", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "manualcancel", OVERGROWN, 1);
  const bank = player.getBank(core.Bank.getTabForItem(player, herb));
  bank.add(new Item(herb, 2147483646), false);
  matureHerb(player);
  assert.equal(state.lives, 5);
  bank.deleteNumber(herb, 10);
  const before = bank.getAmount(herb);
  pick(player, patch);
  assert.equal(state.lives, 4);
  assert.equal(amount(player, herb), 1);
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(bank.getAmount(herb), before);
  assert.equal(farm.vault[seed], 1);
  assert.equal(farm.patches[Data.patchKey(patch)], state);
});

test("Overgrown: depositing the seed after maturity does not restart the missed cycle", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "lateseed", OVERGROWN, 0);
  matureHerb(player);
  assert.equal(state.status, "grown");
  depositSeeds(player, seed, 1);
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(state.status, "grown");
  assert.equal(bankAmount(player, herb), 0);
  assert.equal(farm.vault[seed], 1);
  pick(player, patch);
  assert.equal(amount(player, herb), 1);
});

test("Overgrown: a real Farming Guild contract completes without manual harvest events", (t) => {
  mockScenery(t);
  farmingRandom();
  const patch = Data.CACHE.patches.find(p => p.type === "HERB" && p.x >= 1216 && p.x <= 1279 && p.y >= 3712 && p.y <= 3775 && p.z === 0);
  assert.ok(patch, "active Farming Guild herb patch");
  const { player, farm } = onlineHerb(t, "guildauto", OVERGROWN, 1, patch);
  const options = Guild.CONTRACTS[0].filter(([level]) => level <= 99)
    .flatMap(([, , keys]) => keys.split(" "));
  const index = options.indexOf("GUAM");
  assert.ok(index >= 0);
  const randomCalls = farmingRandom({ contractRoll: (index + 0.1) / options.length });
  const npc = { getLocation: () => player.getLocation() };
  Guild.guildNpc({ player, npc, definition: { getName: () => "Guildmaster Jane" } });
  assert.ok(farmingOptionHandler, "registered farming dialogue owner");
  farmingOptionHandler({ player, buttonId: core.OptionDialogue.OPTIONS_WIDGET_ID, action: 1, slot: -1 });
  assert.equal(randomCalls.assignment, 1);
  assert.equal(farm.contract.crop, "GUAM", "actual Jane assignment");
  assert.equal(farm.contract.complete, false);
  matureHerb(player);
  assert.equal(farm.contract.complete, true);
  assert.deepEqual(harvestEvents.get(player), {}, "no manual task events");
});

test("Overgrown: each harvest uses the current level before that pick's XP", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player } = onlineHerb(t, "levelup", OVERGROWN, 1);
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const skill = player.getSkillManager();
  skill.setExperience(Skill.FARMING, SkillManager.getExperienceForLevel(99) - 1);
  skill.setMaxLevels(Skill.FARMING, 98, false).setCurrentLevel(Skill.FARMING, 98, false);
  assert.equal(skill.getCurrentLevel(Skill.FARMING), 98);
  const levels = [], original = Model.saveLifeChance;
  t.mock.method(Model, "saveLifeChance", (...args) => { levels.push(args[1]); return original(...args); });
  matureHerb(player);
  assert.equal(levels.length, 6);
  assert.equal(levels[0], 98);
  assert.equal(levels[1], 99, "first XP award changes the following pick");
});

test("Overgrown: automatic replant applies the existing seed-save roll", (t) => {
  mockScenery(t);
  const randomCalls = farmingRandom({ saveSeed: true });
  const { player, patch, seed, herb, farm } = onlineHerb(t, "seedkeep", OVERGROWN, 1);
  const before = randomCalls.planting;
  matureHerb(player);
  assert.equal(randomCalls.planting, before + 1, "one actual Overgrown planting roll at replant");
  assert.equal(bankAmount(player, herb), 6);
  assert.equal(farm.vault[seed], 1, "successful roll keeps the matching vault seed");
  assert.equal(farm.patches[Data.patchKey(patch)].status, "growing");
});

test("Overgrown: withdrawing the matching seed cancels a partial automatic harvest", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "seedwithdraw", OVERGROWN, 1);
  const bank = player.getBank(core.Bank.getTabForItem(player, herb));
  bank.add(new Item(herb, 2147483646), false);
  matureHerb(player);
  assert.equal(state.lives, 5);
  Vault.open({ player, anywhere: true });
  const slot = farm.vaultOrder.indexOf(seed);
  assert.ok(slot >= 0);
  Vault.click({ player, buttonId: core.CacheDefinitions.getComponentId("seed_vault:obj_list"), slot, itemId: seed, action: 1 });
  assert.equal(farm.vault[seed], 0, "actual vault withdrawal");
  bank.deleteNumber(herb, 10);
  const before = bank.getAmount(herb);
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(bank.getAmount(herb), before);
  assert.equal(farm.patches[Data.patchKey(patch)], state);
  assert.equal(state.lives, 5);
});

test("Overgrown: session and relic loss cancel a partially banked cycle", (t) => {
  mockScenery(t);
  farmingRandom();
  for (const mode of ["relic", "disconnect", "logout"]) {
    const { player, patch, state, seed, herb, farm } = onlineHerb(t, `cancel${mode}`, OVERGROWN, 1);
    const bank = player.getBank(core.Bank.getTabForItem(player, herb));
    bank.add(new Item(herb, 2147483646), false);
    matureHerb(player);
    assert.equal(state.lives, 5);
    if (mode === "relic") player.setAttribute("league:relics", {});
    else if (mode === "disconnect") farming.onPlayerDisconnect?.({ player });
    else farming.onPlayerLogout({ player });
    bank.deleteNumber(herb, 10);
    const before = bank.getAmount(herb);
    if (mode !== "logout") Patches.advanceTime({ player, ms: 0, handledBy: [] });
    if (mode === "logout") { farming.onPlayerLogin({ player }); Patches.advanceTime({ player, ms: 0, handledBy: [] }); }
    assert.equal(bank.getAmount(herb), before, mode);
    assert.equal(farm.vault[seed], 1, mode);
    assert.equal(farm.patches[Data.patchKey(patch)], state, mode);
    assert.equal(state.lives, 5, mode);
  }
});

test("Overgrown: a different vault seed and non-ultracomposted herb do not start this bounded cycle", (t) => {
  mockScenery(t);
  farmingRandom();
  const wrong = onlineHerb(t, "wrongseed", OVERGROWN, 0);
  const marrentill = Data.itemId("Marrentill seed");
  assert.equal(marrentill, 5292, "active cache matches pinned marrentill_seed");
  depositSeeds(wrong.player, marrentill, 1);
  matureHerb(wrong.player);
  assert.equal(wrong.state.status, "grown");
  assert.equal(bankAmount(wrong.player, wrong.herb), 0);
  assert.equal(wrong.farm.vault[marrentill], 1);
  const untreated = onlineHerb(t, "notultra", OVERGROWN, 1, HERB_PATCH(), "Supercompost");
  matureHerb(untreated.player);
  assert.equal(untreated.state.status, "grown");
  assert.equal(bankAmount(untreated.player, untreated.herb), 0);
  assert.equal(untreated.farm.vault[untreated.seed], 1);
});

test("Overgrown: a crop that matured while offline is left for manual harvesting", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, state, seed, herb, farm } = onlineHerb(t, "offlinemature", OVERGROWN, 1);
  farming.onPlayerLogout({ player });
  Model.advanceFarm(farm, Date.now() + 4 * 60 * 60 * 1000);
  assert.equal(state.status, "grown", "existing model advanced the offline crop");
  farming.onPlayerLogin({ player });
  assert.equal(state.status, "grown");
  assert.equal(bankAmount(player, herb), 0);
  assert.equal(farm.vault[seed], 1);
});

test("Overgrown: all bank slots occupied also preserves a grown herb and seed", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, state, seed, herb, farm } = onlineHerb(t, "noslots", OVERGROWN, 1);
  const bank = player.getBank(0);
  for (let id = 1; id < core.CacheDefinitions.getCounts().items && bank.getFreeSlots() > 0; id++) {
    const definition = core.CacheDefinitions.getItem(id);
    if (!definition?.name || definition.name.toLowerCase() === "null" || definition.noteTemplate >= 0
      || definition.placeholderTemplate >= 0 || core.Bank.sharesPlaceholder(id, herb)) continue;
    bank.add(new Item(id, 1), false);
  }
  assert.equal(bank.getFreeSlots(), 0, "native global bank capacity is full");
  const destination = player.getBank(core.Bank.getTabForItem(player, herb));
  assert.equal(destination.getAddableAmount(new Item(herb, 1)), 0, "no produce stack or placeholder");
  const xp = player.getSkillManager().getExperience(Skill.FARMING);
  matureHerb(player);
  assert.equal(state.status, "grown");
  assert.equal(state.lives, 6);
  assert.equal(bankAmount(player, herb), 0);
  assert.equal(farm.vault[seed], 1);
  assert.equal(player.getSkillManager().getExperience(Skill.FARMING), xp);
});

test("Overgrown: another league and main accounts do not automatically harvest", (t) => {
  mockScenery(t);
  farmingRandom();
  for (const [name, profile, leagueType] of [["wrongleague", "league", 4], ["mainaccount", "main", 5]]) {
    const { player, state, seed, herb, farm } = onlineHerb(t, name, OVERGROWN, 1, HERB_PATCH(), "Ultracompost", profile, leagueType);
    matureHerb(player);
    assert.equal(state.status, "grown", profile);
    assert.equal(bankAmount(player, herb), 0, profile);
    assert.equal(farm.vault[seed], 1, profile);
  }
});

test("Overgrown: synchronous seed withdrawal prevents replant without duplicate rewards", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "hookwithdraw", OVERGROWN, 1);
  let calls = 0;
  plantingObservers.set(player, () => {
    calls++;
    Vault.open({ player, anywhere: true });
    Vault.click({ player, buttonId: core.CacheDefinitions.getComponentId("seed_vault:obj_list"),
      slot: farm.vaultOrder.indexOf(seed), itemId: seed, action: 1 });
  });
  matureHerb(player);
  assert.equal(calls, 1);
  assert.equal(bankAmount(player, herb), 6);
  assert.equal(farm.vault[seed], 0);
  assert.equal(state.lives, 0);
  assert.equal(farm.patches[Data.patchKey(patch)].crop, undefined, "only the exhausted original is cleared");
  Patches.advanceTime({ player, ms: 0, handledBy: [] });
  assert.equal(bankAmount(player, herb), 6, "no repeated harvest");
});

test("Overgrown: a synchronous replacement crop is not overwritten by replant", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, seed, herb, farm } = onlineHerb(t, "hookreplace", OVERGROWN, 1);
  const replacement = { ...Model.emptyPatch(Date.now(), farm), crop: "MARRENTILL", status: "growing" };
  plantingObservers.set(player, () => { farm.patches[Data.patchKey(patch)] = replacement; });
  matureHerb(player);
  assert.equal(bankAmount(player, herb), 6);
  assert.equal(farm.vault[seed], 1, "no seed debit after replacement");
  assert.equal(farm.patches[Data.patchKey(patch)], replacement);
});

// Capture the same vault-inventory calls a visible Seed Vault receives, without a client/socket.
function captureVaultInventory(player) {
  const original = player.getPacketSender(), packets = [];
  const sender = new Proxy(original, { get(target, key) {
    if (key === "sendInventory") return (id, capacity, items) => {
      packets.push({ id, capacity, items: items.map(item => item ? { ...item } : null) });
      return sender;
    };
    return Reflect.get(target, key);
  } });
  player.getPacketSender = () => sender;
  const vaultId = core.CacheDefinitions.getInventoryId("seed_vault");
  assert.equal(vaultId, 626, "active cache seed_vault inventory matches pinned inv.sym");
  return { packets, vaultPackets: () => packets.filter(packet => packet.id === vaultId) };
}
function seedCell(packet, farm, seed) {
  assert.equal(packet.capacity, 104);
  const slot = farm.vaultOrder.indexOf(seed);
  assert.ok(slot >= 0, "the vault retains the seed's actual slot");
  return packet.items[slot];
}

test("Overgrown: an open Seed Vault updates its seed count after a replant", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, patch, seed, farm } = onlineHerb(t, "vaultcount", OVERGROWN, 2);
  const { vaultPackets } = captureVaultInventory(player);
  const pins = { count: 0 }; observedPinChecks.set(player, pins);
  let inventoryRefreshes = 0;
  const inventory = player.getInventory(), refreshInventory = inventory.refreshItems.bind(inventory);
  t.mock.method(inventory, "refreshItems", (...args) => { inventoryRefreshes++; return refreshInventory(...args); });
  Vault.open({ player, anywhere: true });
  const shown = vaultPackets();
  assert.equal(shown.length, 1, "actual vault open sent its inventory");
  assert.deepEqual(seedCell(shown[0], farm, seed), { id: seed, amount: 2 });
  assert.equal(farm.vault[seed], 2);
  const guards = pins.count, refreshes = inventoryRefreshes;
  assert.ok(guards > 0, "actual open checked the PIN guard");
  assert.ok(refreshes > 0, "actual open refreshed carried inventory");
  matureHerb(player);
  assert.equal(farm.vault[seed], 1, "real automatic replant consumed one seed");
  assert.equal(farm.patches[Data.patchKey(patch)].status, "growing", "replacement is committed");
  const after = vaultPackets();
  assert.equal(after.length, 2, "open vault receives the new inventory");
  assert.deepEqual(seedCell(after[1], farm, seed), { id: seed, amount: 1 });
  assert.deepEqual(seedCell(after[0], farm, seed), { id: seed, amount: 2 }, "prior packet is a snapshot");
  assert.equal(pins.count, guards, "background refresh does not reopen or prompt for PIN");
  assert.equal(inventoryRefreshes, refreshes, "background vault update does not refresh carried inventory");
});

test("Overgrown: an open Seed Vault receives the empty seed placeholder", (t) => {
  mockScenery(t);
  farmingRandom();
  const { player, seed, farm } = onlineHerb(t, "vaultempty", OVERGROWN, 1);
  const { vaultPackets } = captureVaultInventory(player);
  Vault.open({ player, anywhere: true });
  assert.deepEqual(seedCell(vaultPackets()[0], farm, seed), { id: seed, amount: 1 });
  const placeholder = core.CacheDefinitions.getItem(seed).placeholder;
  assert.ok(placeholder > 0, "active cache has the seed placeholder");
  matureHerb(player);
  assert.equal(farm.vault[seed], 0);
  const after = vaultPackets();
  assert.equal(after.length, 2);
  assert.deepEqual(seedCell(after[1], farm, seed), { id: placeholder, amount: 1 });
});

test("Overgrown: saving the seed does not send an unnecessary vault refresh", (t) => {
  mockScenery(t);
  farmingRandom({ saveSeed: true });
  const { player, patch, state, seed, herb, farm } = onlineHerb(t, "vaultsaved", OVERGROWN, 1);
  const { vaultPackets } = captureVaultInventory(player);
  Vault.open({ player, anywhere: true });
  assert.equal(vaultPackets().length, 1);
  matureHerb(player);
  assert.equal(bankAmount(player, herb), 6, "the automatic harvest happened");
  assert.notEqual(farm.patches[Data.patchKey(patch)], state, "a new crop was planted");
  assert.equal(farm.patches[Data.patchKey(patch)].status, "growing");
  assert.equal(farm.vault[seed], 1);
  assert.equal(vaultPackets().length, 1);
});

test("Overgrown: a stale or closed Seed Vault is not refreshed", (t) => {
  mockScenery(t);
  farmingRandom();
  for (const state of ["stale", "closed"]) {
    const { player, seed, farm } = onlineHerb(t, `vault${state}`, OVERGROWN, 1);
    const { vaultPackets } = captureVaultInventory(player);
    Vault.open({ player, anywhere: true });
    assert.equal(vaultPackets().length, 1);
    if (state === "stale") player.getInterfaceId = () => -1;
    else Vault.logout({ player });
    matureHerb(player);
    assert.equal(farm.vault[seed], 0, "replant still consumes the seed");
    assert.equal(vaultPackets().length, 1, `${state} vault received no background inventory`);
  }
});

// --- Managing Miscellania

test("Pocket Kingdom: the kingdom without the quests, half-price workers, twice the resources, approval held at its maximum", () => {
  const who = cases(POCKET_KINGDOM, 5);
  const rules = Kingdom.rules(who.relic);
  assert.deepEqual([rules.ruler, rules.royalTrouble, rules.payMultiplier, rules.outputMultiplier, rules.approval, rules.visiting], [true, true, 0.5, 2, 127, true]);
  const ruled = Kingdom.catchUp(who.relic);
  assert.ok(ruled, "the relic rules the kingdom without the quest");
  assert.equal(ruled.lastVisitDay, Kingdom.today(), "managed from Lumbridge, it counts as a visit: the subjects keep working");
  for (const player of others(who)) {
    const theirs = Kingdom.rules(player);
    assert.deepEqual([theirs.ruler, theirs.payMultiplier, theirs.outputMultiplier, theirs.approval], [false, 1, 1, null], player.getUsername());
    assert.equal(Kingdom.catchUp(player), null, `${player.getUsername()} needs the quest`);
  }

  const kingdom = { ...Kingdom.kingdomOf(who.relic, 10), coffer: 100000, points: 0, lastDay: 9, lastVisitDay: 9 };
  const usual = Kingdom.payDays(kingdom, 100, 10, false);
  const cheap = Kingdom.payDays(kingdom, 127, 10, false, { payMultiplier: 0.5, approval: 127 });
  assert.equal(100000 - usual.kingdom.coffer, 10005, "the usual day's pay");
  assert.equal(100000 - cheap.kingdom.coffer, 5003, "half of it");
  assert.ok(cheap.kingdom.points > usual.kingdom.points, "the same work, at the full approval");
  assert.equal(cheap.favour, 127, "approval does not fall");
  assert.ok(usual.favour < 100, "the usual approval falls");

  const working = { ...kingdom, points: 100000, workers: { ...kingdom.workers, mine: 10 } };
  const once = Kingdom.gather(working, () => 0.5);
  const twice = Kingdom.gather(working, () => 0.5, 2);
  const coal = Kingdom.items().COAL;
  assert.ok(once.get(coal) > 0);
  assert.equal(twice.get(coal), once.get(coal) * 2, "twice the coal");
  const clues = { ...working, workers: { ...working.workers, mine: 0, fish: 10 } };
  const random = () => 0.999;
  assert.ok(Kingdom.gather(clues, random).get("clue") > 0, "the fishing table's clue");
  assert.equal(Kingdom.gather(clues, random, 2).get("clue"), Kingdom.gather(clues, random).get("clue"), "the clues stay as rolled");

  itemActions.get("Pocket kingdom").Check({ player: who.relic, slot: 0 });
  assert.match(who.relic.messages.at(-1), /approval rating is \d+% and its coffers hold/);
  for (const player of others(who)) {
    const before = player.messages.length;
    itemActions.get("Pocket kingdom").Check({ player, slot: 0 });
    assert.equal(player.messages.length, before, `${player.getUsername()}'s pocket kingdom does nothing`);
  }
});
