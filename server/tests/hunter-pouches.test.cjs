// Run after `yarn build`: node --test tests/hunter-pouches.test.cjs
// The Hunters' Guild meat and fur pouches (docs/storage-items.md), with a real Player, the cache and
// the StorageItems plugin's hooks, and Hunter's catch delivery into an open pouch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const StorageItems = require("../plugins/items/StorageItems.plugin");
const Storage = require("../plugins/items/storage/Common.StorageItems");
const Pouches = require("../plugins/items/storage/HunterPouches.StorageItems");
const C = require("../plugins/skills/hunter/Context.Hunter");

let core;
let index = 9400;
/** What `league:near-bank` answers in these tests (LeagueMode's answer is stood in for). */
let nearBank = false;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  StorageItems.register(PluginManager.createApi("HunterPouchesTest"));
  PluginManager.createApi("NearBankTest").onCustomEvent("league:near-bank", (query) => { query.near = nearBank; });
  C.H.core = core;
  C.H.api = PluginManager.createApi("HunterTest");
});

function actor(t, items = [], location = new core.Location(3200, 3200, 0)) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++);
  player.setUsername(`pouch${player.getIndex()}`);
  player.setRegistered(true);
  player.setLocation(location);
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player, "sendMessage", (text) => { messages.push(text); });
  for (const [id, amount] of items) player.getInventory().adds(id, amount);
  nearBank = false;
  return { player, messages };
}

function option(player, id, name) {
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex((item) => item?.getId() === id);
  const item = inventory.getItems()[slot];
  const clickType = CacheDefinitions.getItem(id).inventoryActions.indexOf(name) + 1;
  assert.ok(clickType > 0, `${name} is an op of ${id}`);
  return PluginManager.emitItemAction({ player, interfaceId: 149 << 16, item, itemId: id, slot, clickType, option: name, handled: false });
}

const meat = () => Storage.FAMILIES.get("meat-pouch");
const fur = () => Storage.FAMILIES.get("fur-pouch");

test("every pouch's op is answered: Fill, Empty, Check and Open or Close", (t) => {
  for (const id of [I.SMALL_MEAT_POUCH, I.LARGE_MEAT_POUCH, I.SMALL_FUR_POUCH, I.MEDIUM_FUR_POUCH, I.LARGE_FUR_POUCH]) {
    for (const name of ["Fill", "Empty", "Check", "Open"]) {
      const { player } = actor(t, [[id, 1]]);
      assert.equal(option(player, id, name), true, `${CacheDefinitions.getItem(id).name} ${name}`);
    }
  }
  const { player } = actor(t, [[I.SMALL_MEAT_POUCH, 1]]);
  option(player, I.SMALL_MEAT_POUCH, "Open");
  const openId = player.getInventory().getItems()[0].getId();
  assert.equal(CacheDefinitions.getItem(openId).name, "Small meat pouch (open)");
  assert.equal(option(player, openId, "Close"), true);
  assert.equal(player.getInventory().getItems()[0].getId(), I.SMALL_MEAT_POUCH);
});

test("a small meat pouch holds 14 hunter meats, not bird meat, and Check gives the count", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.RAW_PYRE_FOX, 16], [I.RAW_BIRD_MEAT, 2]]);
  option(player, I.SMALL_MEAT_POUCH, "Fill");
  assert.equal(Storage.total(player, meat()), 14);
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 2);
  assert.equal(player.getInventory().getAmount(I.RAW_BIRD_MEAT), 2, "raw bird meat is no hunter meat");
  assert.equal(messages.at(-1), "Your pouch is full.");
  option(player, I.SMALL_MEAT_POUCH, "Check");
  assert.equal(messages.at(-1), "Your pouch contains 14 pieces of meat.");
});

test("fur pouches hold 14, 21 or 28 hunter furs by the largest carried, never tatty fur", (t) => {
  for (const [pouch, holds] of [[I.SMALL_FUR_POUCH, 14], [I.MEDIUM_FUR_POUCH, 21], [I.LARGE_FUR_POUCH, 28]]) {
    const { player } = actor(t, [[pouch, 1], [I.GRAAHK_FUR, 20], [I.TATTY_GRAAHK_FUR, 2], [I.BEAR_FUR, 1]]);
    Storage.store(player, fur(), I.KYATT_FUR, 5);
    option(player, pouch, "Fill");
    assert.equal(Storage.total(player, fur()), Math.min(holds, 25), CacheDefinitions.getItem(pouch).name);
    assert.equal(player.getInventory().getAmount(I.TATTY_GRAAHK_FUR), 2);
    assert.equal(player.getInventory().getAmount(I.BEAR_FUR), 1);
  }
});

test("a meat pouch empties only at a bank or on the Hunters' Guild's top floor", (t) => {
  const { player, messages } = actor(t, [[I.LARGE_MEAT_POUCH, 1]]);
  Storage.store(player, meat(), I.RAW_SUNLIGHT_ANTELOPE, 3);
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can't empty your meat pouch here.");
  assert.equal(Storage.total(player, meat()), 3);

  player.setLocation(new core.Location(1556, 3046, 2));
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(Storage.total(player, meat()), 0);
  assert.equal(player.getInventory().getAmount(I.RAW_SUNLIGHT_ANTELOPE), 3);
  assert.equal(messages.at(-1), "You empty your pouch.");

  player.setLocation(new core.Location(1556, 3046, 0));
  Storage.store(player, meat(), I.RAW_PYRE_FOX, 1);
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can't empty your meat pouch here.", "the guild's ground floor is not its top floor");
  nearBank = true;
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 1);
});

test("a fur pouch empties only into an open bank, also from the bank panel's op", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_FUR_POUCH, 1]]);
  Storage.store(player, fur(), I.LARUPIA_FUR, 4);
  nearBank = true;
  option(player, I.SMALL_FUR_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can only empty your fur pouch into a bank.");
  assert.equal(Storage.total(player, fur()), 4);

  player.setStatus(PlayerStatus.BANKING);
  player.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  const item = player.getInventory().getItems()[0];
  const event = { player, item, slot: 0, op: 9, handled: false };
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, event);
  assert.equal(event.handled, true);
  assert.equal(Storage.total(player, fur()), 0);
  assert.equal(player.getBank(Bank.getTabForItem(player, I.LARUPIA_FUR)).getAmount(I.LARUPIA_FUR), 4);
});

test("an open pouch takes a catch's meat and fur without inventory room; a closed one doesn't", (t) => {
  const { player } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.SMALL_FUR_POUCH, 1], [I.COINS, 1]]);
  player.getInventory().adds(I.LOGS, 24); // one slot free
  const loot = [[I.BONES, 1], [I.RAW_PYRE_FOX, 1], [I.FOX_FUR, 1]];
  assert.equal(C.catchExchange(player, [], loot, false), false, "closed pouches leave the catch needing three slots");

  option(player, I.SMALL_MEAT_POUCH, "Open");
  option(player, I.SMALL_FUR_POUCH, "Open");
  assert.equal(C.catchExchange(player, [], loot, false), true, "one slot for the bones is enough");
  assert.equal(C.catchExchange(player, [], loot), true);
  assert.equal(Storage.amountOf(player, meat(), I.RAW_PYRE_FOX), 1);
  assert.equal(Storage.amountOf(player, fur(), I.FOX_FUR), 1);
  assert.equal(player.getInventory().getAmount(I.BONES), 1);
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 0);
});

test("a full open pouch leaves the catch to the inventory", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1]]);
  option(player, I.SMALL_MEAT_POUCH, "Open");
  Storage.store(player, meat(), I.RAW_LARUPIA, 13);
  assert.equal(C.catchExchange(player, [], [[I.RAW_LARUPIA, 1]]), true);
  assert.equal(Storage.total(player, meat()), 14);
  assert.equal(messages.at(-1), "Your pouch is full.");
  assert.equal(C.catchExchange(player, [], [[I.RAW_LARUPIA, 1]]), true);
  assert.equal(player.getInventory().getAmount(I.RAW_LARUPIA), 1);
});

test("every small and large meat pouch shares one store; the last one destroyed takes it along", (t) => {
  const { player } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.LARGE_MEAT_POUCH, 1]]);
  Storage.store(player, meat(), I.RAW_KYATT, 20);
  assert.equal(Storage.total(player, meat()), 20, "the large pouch carried sets the room");
  player.getInventory().deleteNumber(I.LARGE_MEAT_POUCH, 1);
  assert.equal(Storage.store(player, meat(), I.RAW_KYATT, 1), 0, "a small pouch alone is over-full");
  player.getInventory().deleteNumber(I.SMALL_MEAT_POUCH, 1);
  PluginManager.emitCustomEvent("destroy-item:destroyed", { player, itemId: I.SMALL_MEAT_POUCH, amount: 1 });
  assert.equal(Storage.total(player, meat()), 0);
});

test("the guild's top floor covers its walls on plane 2 only", () => {
  const at = (x, y, z) => Pouches.inGuildTopFloor({ getLocation: () => new core.Location(x, y, z) });
  assert.equal(at(1556, 3046, 2), true);
  assert.equal(at(1552, 3033, 2), true);
  assert.equal(at(1551, 3046, 2), false);
  assert.equal(at(1556, 3046, 1), false);
});

test("a noose-wand catch puts its fur in an open fur pouch, so a full inventory still takes it", (t) => {
  const Tracking = require("../plugins/skills/hunter/Tracking.Hunter");
  const { player, messages } = actor(t, [[I.NOOSE_WAND, 1], [I.SMALL_FUR_POUCH, 1]]);
  player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 99).setMaxLevel(core.Skill.HUNTER, 99);
  option(player, I.SMALL_FUR_POUCH, "Open");
  player.getInventory().adds(I.LOGS, 24); // two slots left: the bones and the beast meat
  const varbits = new Map();
  t.mock.method(player.getPacketSender(), "sendVarbit", (id, value) => { varbits.set(id, value); return player.getPacketSender(); });
  const at = ([x, y, z]) => new core.GameObject(1, new core.Location(x, y, z), 10, 0, null);
  const segmentOf = (varbit) => Tracking.data.segments.find((s) => s.varbit === varbit);
  const burrow = at(Tracking.data.segments.find((s) => s.burrow && s.kebbit === "feldip_weasel").start);
  player.setLocation(burrow.getLocation().clone());
  Tracking.inspect({ player, object: burrow, definition: { getName: () => "Burrow" } });
  let searches = 0;
  while (!messages.at(-1)?.startsWith("Something is moving here") && searches++ < 15) {
    const varbit = [...varbits.keys()].at(-1), segment = segmentOf(varbit);
    const forwards = varbits.get(varbit) === (segment.inverted ? 5 : 4);
    const spot = at(forwards ? segment.end : segment.start);
    player.setLocation(spot.getLocation().clone());
    Tracking.inspect({ player, object: spot, definition: { getName: () => "Bush" } });
  }
  assert.ok(searches < 15, "the trail ends at the weasel");
  const here = player.getLocation();
  Tracking.catchPrey({ player, object: at([here.getX(), here.getY(), here.getZ()]) });
  for (let i = 0; i < 3; i++) { C.H.tick++; C.processActions(); }
  assert.equal(Storage.amountOf(player, fur(), I.FELDIP_WEASEL_FUR), 1, "the fur went into the pouch");
  assert.equal(player.getInventory().getAmount(I.FELDIP_WEASEL_FUR), 0);
  assert.equal(player.getInventory().getAmount(I.BONES), 1);
  Tracking.clear({ player });
});

test("Empty with no inventory room moves nothing and says the inventory is full", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1]]);
  player.getInventory().adds(I.LOGS, 27);
  Storage.store(player, meat(), I.RAW_PYRE_FOX, 2);
  nearBank = true;
  option(player, I.SMALL_MEAT_POUCH, "Empty");
  assert.equal(Storage.total(player, meat()), 2);
  assert.equal(messages.at(-1), "Not enough space in your inventory.");
});
