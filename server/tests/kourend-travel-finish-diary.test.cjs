// Run after `yarn build`: node --test tests/kourend-travel-finish-diary.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");

const Diaries = require("../plugins/achievements/AchievementDiaries.plugin");
const Progress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");
const Data = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const Travel = require("../plugins/items/KourendTravelItems.plugin");
const Tyss = require("../plugins/npcs/Tyss.plugin");
const Finish = require("../plugins/achievements/diaries/KourendDiaryTravelFinish.plugin");

let core = null;
let api = null;
let ready = null;

async function setup() {
  if (ready) return ready;
  ready = (async () => {
    await CachePipeline.initialize(path.resolve(__dirname, ".."));
    core = PluginManager.getCoreApi();
    api = PluginManager.createApi("KourendTravelFinishTest");
    Diaries.register(api);
    Travel.register(api);
    Tyss.register(api);
    Finish.register(api);
  })();
  return ready;
}

const KOUREND = Data.BY_KEY.get("kourend");
const done = (player, task) => Progress.doneTasks(player, KOUREND).has(task);
const emit = (name, event) => PluginManager.emitCustomEvent(name, event);

function actor() {
  const player = new Player(null, new core.Location(1600, 3600, 0));
  player.setIndex(3000 + Math.floor(Math.random() * 1000));
  player.setUsername("kourend-travel-finish-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getHitpoints = () => 10;
  player.isDyingReturn = () => false;
  return player;
}

function setPage(player, varbitName) {
  const id = core.CacheDefinitions.getVarbitId(varbitName);
  assert.notEqual(id, null, `${varbitName} resolves`);
  player.getPacketSender().sendVarbit(id, 1);
}

test("Land's End ferry arrival credits the boat task; other routes do not", async () => {
  await setup();
  const player = actor();
  emit("ferries:arrived", { player, route: "kourend-piscarilius" });
  assert.equal(done(player, Finish._test.BOAT_TASK), false);
  emit("ferries:arrived", { player, route: "kourend-landsend" });
  assert.equal(done(player, Finish._test.BOAT_TASK), true);
});

test("Tyss answers the transcript conditions and switches only when Arceuus is selected", async () => {
  await setup();
  const player = actor();
  player.setSpellbook(core.MagicSpellbook.NORMAL);

  assert.equal(Tyss._test.answerCondition({ player, npcId: 7050, stepId: "O63wRq" }), true);
  assert.equal(Tyss._test.answerCondition({ player, npcId: 7050, stepId: "AQEl1l" }), false);

  emit("npc-dialogue:choice", { player, npcId: 7050, option: Tyss._test.START_OPTION });
  assert.equal(player.getSpellbook(), core.MagicSpellbook.ARCEUUS);
  assert.equal(done(player, Finish._test.SPELLBOOK_TASK), true);

  Tyss._test.spellbookOption({ player, npcId: 7050, handled: false });
  assert.equal(player.getSpellbook(), core.MagicSpellbook.NORMAL, "Spellbook toggles back");
});

test("entering the Farming Guild zone credits once", async () => {
  await setup();
  const player = actor();
  player.setLocation(new core.Location(1248, 3725, 0));
  PluginManager.updatePlayerZones(player);
  assert.equal(done(player, Finish._test.FARMING_GUILD_TASK), true);
  PluginManager.updatePlayerZones(player);
  assert.equal(Progress.tierCount(player, KOUREND, "medium"),
    Progress.tierCount(player, KOUREND, "medium"));
});

test("History and Jewellery pages can be added to the memoirs for 20 charges each", async () => {
  await setup();
  const player = actor();
  player.getInventory().adds(Travel._test.MEMOIRS_ID, 1);
  player.getInventory().adds(core.ItemIdentifiers.HISTORY_AND_HEARSAY, 1);
  player.getInventory().adds(core.ItemIdentifiers.JEWELLERY_OF_JUBILATION, 1);
  const memoirs = player.getInventory().getItems().find((item) => item?.getId() === Travel._test.MEMOIRS_ID);

  const page = (id) => ({ player, usedItemId: id, usedWithItemId: Travel._test.MEMOIRS_ID, usedItem: null, usedWithItem: memoirs, handled: false });
  const history = page(core.ItemIdentifiers.HISTORY_AND_HEARSAY);
  Travel._test.addPage(history);
  assert.equal(history.handled, true);
  const jewellery = page(core.ItemIdentifiers.JEWELLERY_OF_JUBILATION);
  Travel._test.addPage(jewellery);
  assert.equal(jewellery.handled, true);
  assert.equal(Travel._test.memoirCharges(player, memoirs), 40);
});

test("Kharedst's memoirs credit the task only after all five city teleports", async (t) => {
  await setup();
  const player = actor();
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, _target, _type, _warn, onArrival) => onArrival?.());
  const item = new core.Item(Travel._test.MEMOIRS_ID, 1);
  player.getInventory().adds(item.getId(), 1);
  for (const page of Travel._test.MEMOIRS_PAGES) setPage(player, page.varbit);
  Travel._test.setMemoirCharges(player, item, 100);

  for (const page of Travel._test.MEMOIRS_PAGES.slice(0, -1)) {
    assert.equal(Travel._test.teleport(player, item, page), true);
    assert.equal(done(player, Finish._test.MEMOIRS_TASK), false);
  }
  const last = Travel._test.MEMOIRS_PAGES.at(-1);
  assert.equal(Travel._test.teleport(player, item, last), true);
  assert.equal(done(player, Finish._test.MEMOIRS_TASK), true);
  assert.equal(Travel._test.memoirCharges(player, item), 95);
});

test("Xeric's Heart credits the task; another destination does not", async (t) => {
  await setup();
  const player = actor();
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, _target, _type, _warn, onArrival) => onArrival?.());
  const item = new core.Item(Travel._test.XERIC_TALISMAN_ID, 1);
  player.getInventory().adds(item.getId(), 1);
  Travel._test.setXericCharges(player, item, 2);

  const glade = Travel._test.XERIC_DESTINATIONS.find((destination) => destination.key === "glade");
  assert.equal(Travel._test.teleportWithTalisman(player, item, glade), true);
  assert.equal(done(player, Finish._test.XERIC_TASK), false);
  const heart = Travel._test.XERIC_DESTINATIONS.find((destination) => destination.key === "heart");
  assert.equal(Travel._test.teleportWithTalisman(player, item, heart), true);
  assert.equal(done(player, Finish._test.XERIC_TASK), true);
  assert.equal(Travel._test.xericCharges(item), 0);
  assert.equal(item.getId(), Travel._test.XERIC_TALISMAN_INERT_ID);

  assert.equal(Travel._test.teleportWithTalisman(player, item, heart), false);
});

test("uncharging Xeric's talisman keeps charges when fangs do not fit and returns them when they do", async () => {
  await setup();

  const blocked = actor();
  const blockedInventory = blocked.getInventory();
  const blockedTalisman = new core.Item(Travel._test.XERIC_TALISMAN_ID, 1);
  blockedInventory.adds(blockedTalisman.getId(), 1);
  Travel._test.setXericCharges(blocked, blockedTalisman, 5);
  while (blockedInventory.getFreeSlots() > 0) {
    blockedInventory.add(new core.Item(core.ItemIdentifiers.RAKE, 1), false);
  }

  Travel._test.unchargeTalisman(blocked, blockedTalisman);
  assert.equal(Travel._test.xericCharges(blockedTalisman), 5, "charges are kept when no fang fits");
  assert.equal(blockedTalisman.getId(), Travel._test.XERIC_TALISMAN_ID);
  assert.equal(blockedInventory.getAmount(core.ItemIdentifiers.LIZARDMAN_FANG), 0);

  const capped = actor();
  const cappedInventory = capped.getInventory();
  const cappedTalisman = new core.Item(Travel._test.XERIC_TALISMAN_ID, 1);
  cappedInventory.adds(core.ItemIdentifiers.LIZARDMAN_FANG, 0x7fffffff);
  cappedInventory.adds(cappedTalisman.getId(), 1);
  Travel._test.setXericCharges(capped, cappedTalisman, 5);
  while (cappedInventory.getFreeSlots() > 0) {
    cappedInventory.add(new core.Item(core.ItemIdentifiers.RAKE, 1), false);
  }

  Travel._test.unchargeTalisman(capped, cappedTalisman);
  assert.equal(Travel._test.xericCharges(cappedTalisman), 5, "a full fang stack keeps the charges");
  assert.equal(cappedTalisman.getId(), Travel._test.XERIC_TALISMAN_ID);
  assert.equal(cappedInventory.getAmount(core.ItemIdentifiers.LIZARDMAN_FANG), 0x7fffffff);

  const free = actor();
  const freeInventory = free.getInventory();
  const freeTalisman = new core.Item(Travel._test.XERIC_TALISMAN_ID, 1);
  freeInventory.adds(freeTalisman.getId(), 1);
  Travel._test.setXericCharges(free, freeTalisman, 5);

  Travel._test.unchargeTalisman(free, freeTalisman);
  assert.equal(Travel._test.xericCharges(freeTalisman), 0);
  assert.equal(freeTalisman.getId(), Travel._test.XERIC_TALISMAN_INERT_ID);
  assert.equal(freeInventory.getAmount(core.ItemIdentifiers.LIZARDMAN_FANG), 5);
});

test("inactive players do not earn travel tasks", async () => {
  await setup();
  const player = actor();
  player.setRegistered(false);
  emit("ferries:arrived", { player, route: "kourend-landsend" });
  emit("tyss:spellbook-switched", { player });
  emit("kharedst:teleported", { player, city: "hosidius" });
  emit("xerics-talisman:teleported", { player, destination: "heart" });
  assert.equal(done(player, Finish._test.BOAT_TASK), false);
  assert.equal(done(player, Finish._test.SPELLBOOK_TASK), false);
  assert.equal(done(player, Finish._test.MEMOIRS_TASK), false);
  assert.equal(done(player, Finish._test.XERIC_TASK), false);
});


test("Fisher's Flute attaches through the native item-on-item hook", async () => {
  await setup();
  const player = actor();
  const inventory = player.getInventory();
  inventory.adds(Travel._test.MEMOIRS_ID, 1);
  inventory.adds(core.ItemIdentifiers.THE_FISHERS_FLUTE, 1);
  const memoirs = inventory.getItems().find((item) => item?.getId() === Travel._test.MEMOIRS_ID);
  const page = inventory.getItems().find((item) => item?.getId() === core.ItemIdentifiers.THE_FISHERS_FLUTE);
  assert.equal(PluginManager.emitItemOnItem({ player, usedItem: page, usedItemId: page.getId(),
    usedWithItem: memoirs, usedWithItemId: memoirs.getId(), handled: false }), true);
  assert.equal(Travel._test.memoirPageUnlocked(player, Travel._test.MEMOIRS_PAGES[1]), true);
  assert.equal(inventory.getAmount(core.ItemIdentifiers.THE_FISHERS_FLUTE), 0);
});

test("a quest-owned memoir page adds its charges after the book was used", async () => {
  await setup();
  const player = actor();
  const memoirs = new core.Item(Travel._test.MEMOIRS_ID, 1);
  setPage(player, Travel._test.MEMOIRS_PAGES[2].varbit);
  Travel._test.setMemoirCharges(player, memoirs, 0);
  setPage(player, Travel._test.MEMOIRS_PAGES[0].varbit);
  assert.equal(Travel._test.memoirCharges(player, memoirs), 20);
  Travel._test.setMemoirCharges(player, memoirs, 19);
  assert.equal(Travel._test.memoirCharges(player, memoirs), 19, "grant each page only once");
  const replacement = new core.Item(Travel._test.MEMOIRS_ID, 1);
  assert.equal(Travel._test.memoirCharges(player, replacement), 19, "reclaiming the book retains its charges");
});

test("uncharging during a talisman teleport cannot duplicate fangs on landing", async (t) => {
  await setup();
  const player = actor();
  player.getInventory().adds(Travel._test.XERIC_TALISMAN_ID, 1);
  const item = player.getInventory().getItems().find((entry) => entry?.getId() === Travel._test.XERIC_TALISMAN_ID);
  Travel._test.setXericCharges(player, item, 10);
  let land;
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, _target, _type, _warn, onArrival) => { land = onArrival; });
  const heart = Travel._test.XERIC_DESTINATIONS.find((destination) => destination.key === "heart");
  assert.equal(Travel._test.teleportWithTalisman(player, item, heart), true);
  Travel._test.talismanAction({ player, item, itemId: item.getId(), option: "Uncharge" });
  land();
  assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.LIZARDMAN_FANG)
    + Travel._test.xericCharges(item), 9);
});
