// Run after `yarn build`: node --test tests/hunter-pouches.test.cjs
// The Hunters' Guild meat and fur pouches (docs/storage-items.md), with a real Player, the cache and
// the StorageItems plugin's hooks, and Hunter's catch delivery into an open pouch. Lines and behaviour:
// rsprox captures pyre-fur-and-smallpouch-1 to -4 (rev 242).
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
  const spam = [];
  const sounds = [];
  t.mock.method(player, "sendMessage", (text) => { messages.push(text); });
  t.mock.method(player.getPacketSender(), "sendTypedMessage", (_type, text) => { spam.push(text); return player.getPacketSender(); });
  t.mock.method(core.Sounds, "sendSound", (_player, sound) => { sounds.push(sound.getId?.() ?? sound.id); });
  for (const [id, amount] of items) player.getInventory().adds(id, amount);
  nearBank = false;
  return { player, messages, spam, sounds };
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
  const { player, messages } = actor(t, [[I.LARGE_MEAT_POUCH, 1]]);
  option(player, I.LARGE_MEAT_POUCH, "Open");
  const openId = player.getInventory().getItems()[0].getId();
  assert.equal(CacheDefinitions.getItem(openId).name, "Large meat pouch (open)");
  assert.equal(messages.at(-1), "You open your large meat pouch.");
  assert.equal(option(player, openId, "Close"), true);
  assert.equal(player.getInventory().getItems()[0].getId(), I.LARGE_MEAT_POUCH);
  assert.equal(messages.at(-1), "You close your large meat pouch.");
});

test("a small meat pouch holds 14 hunter meats, not bird meat, with the captured Fill and Check lines", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.RAW_BIRD_MEAT, 2]]);
  option(player, I.SMALL_MEAT_POUCH, "Check");
  assert.equal(messages.at(-1), "Your meat pouch is currently holding 0 meat.");
  option(player, I.SMALL_MEAT_POUCH, "Fill");
  assert.equal(messages.at(-1), "You don't have any meats that can go into this pouch.", "raw bird meat is no hunter meat");
  player.getInventory().adds(I.RAW_PYRE_FOX, 16);
  const before = messages.length;
  option(player, I.SMALL_MEAT_POUCH, "Fill");
  assert.equal(messages.length, before, "Fill is silent");
  assert.equal(Storage.total(player, meat()), 14);
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 2);
  assert.equal(player.getInventory().getAmount(I.RAW_BIRD_MEAT), 2);
  option(player, I.SMALL_MEAT_POUCH, "Fill");
  assert.equal(messages.at(-1), "Your pouch is full.");
  option(player, I.SMALL_MEAT_POUCH, "Check");
  assert.equal(messages.at(-1), "Your meat pouch is currently holding 14 meat.");
});

test("one meat used on a closed pouch puts every meat carried in, silently", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.RAW_PYRE_FOX, 3]]);
  const inventory = player.getInventory();
  const pouch = inventory.getItems()[0];
  const meatItem = inventory.getItems()[1];
  const event = { player, usedItem: meatItem, usedWithItem: pouch, usedItemId: meatItem.getId(), usedWithItemId: pouch.getId(), handled: false };
  PluginManager.emitItemOnItem(event);
  assert.equal(Storage.total(player, meat()), 3);
  assert.equal(inventory.getAmount(I.RAW_PYRE_FOX), 0);
  assert.deepEqual(messages, []);
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
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(messages.at(-1), "Your meat pouch is empty.", "an empty pouch says so anywhere");
  Storage.store(player, meat(), I.RAW_SUNLIGHT_ANTELOPE, 3);
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can't empty your meat pouch here.");
  assert.equal(Storage.total(player, meat()), 3);

  player.setLocation(new core.Location(1556, 3046, 2));
  const before = messages.length;
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(Storage.total(player, meat()), 0);
  assert.equal(player.getInventory().getAmount(I.RAW_SUNLIGHT_ANTELOPE), 3);
  assert.equal(messages.length, before, "emptying into the inventory is silent");

  player.setLocation(new core.Location(1556, 3046, 0));
  Storage.store(player, meat(), I.RAW_PYRE_FOX, 1);
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can't empty your meat pouch here.", "the guild's ground floor is not its top floor");
  nearBank = true;
  option(player, I.LARGE_MEAT_POUCH, "Empty");
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 1);
});

test("a fur pouch empties only into an open bank; the bank panel's op deposits with the captured line", (t) => {
  const { player, messages, spam, sounds } = actor(t, [[I.SMALL_FUR_POUCH, 1]]);
  Storage.store(player, fur(), I.LARUPIA_FUR, 4);
  nearBank = true;
  option(player, I.SMALL_FUR_POUCH, "Empty");
  assert.equal(messages.at(-1), "You can't empty your fur pouch here.");
  assert.equal(Storage.total(player, fur()), 4);

  player.setStatus(PlayerStatus.BANKING);
  player.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  const item = player.getInventory().getItems()[0];
  const event = { player, item, slot: 0, op: 9, handled: false };
  PluginManager.emitCustomEvent(Bank.INVENTORY_OP_EVENT, event);
  assert.equal(event.handled, true);
  assert.equal(Storage.total(player, fur()), 0);
  assert.equal(player.getBank(Bank.getTabForItem(player, I.LARUPIA_FUR)).getAmount(I.LARUPIA_FUR), 4);
  assert.deepEqual(spam, ["You deposit some fur into your bank."]);
  assert.deepEqual(sounds, [2285]);
});

test("a catch needs room for all its loot even with open pouches, which then take the meat and fur", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1], [I.SMALL_FUR_POUCH, 1], [I.COINS, 1]]);
  player.getInventory().adds(I.LOGS, 25); // nothing free
  const loot = [[I.BONES, 1], [I.RAW_PYRE_FOX, 1], [I.FOX_FUR, 1]];
  option(player, I.SMALL_MEAT_POUCH, "Open");
  option(player, I.SMALL_FUR_POUCH, "Open");
  assert.equal(C.catchExchange(player, [], loot, false), false, "captured: an open pouch with room doesn't lower the slots needed");
  C.catchRefusal(player, [], loot);
  assert.equal(messages.at(-1), "You don't have enough inventory space. You need 3 more free slots.");

  player.getInventory().deleteNumber(I.LOGS, 3);
  assert.equal(C.catchExchange(player, [], loot, false), true);
  assert.equal(C.catchExchange(player, [], loot), true);
  assert.equal(Storage.amountOf(player, meat(), I.RAW_PYRE_FOX), 1);
  assert.equal(Storage.amountOf(player, fur(), I.FOX_FUR), 1);
  assert.equal(player.getInventory().getAmount(I.BONES), 1);
  assert.equal(player.getInventory().getAmount(I.RAW_PYRE_FOX), 0);
});

test("an open pouch filling up from a catch says nothing; a full one leaves the catch to the inventory", (t) => {
  const { player, messages } = actor(t, [[I.SMALL_MEAT_POUCH, 1]]);
  option(player, I.SMALL_MEAT_POUCH, "Open");
  Storage.store(player, meat(), I.RAW_LARUPIA, 13);
  const before = messages.length;
  assert.equal(C.catchExchange(player, [], [[I.RAW_LARUPIA, 1]]), true);
  assert.equal(Storage.total(player, meat()), 14);
  assert.equal(messages.length, before);
  assert.equal(C.catchExchange(player, [], [[I.RAW_LARUPIA, 1]]), true);
  assert.equal(player.getInventory().getAmount(I.RAW_LARUPIA), 1);
});

test("Destroy warns with the captured line", (t) => {
  const { player } = actor(t, [[I.LARGE_MEAT_POUCH, 1]]);
  const prompt = { player, item: player.getInventory().getItems()[0], question: "q", warning: "w" };
  PluginManager.emitCustomEvent("destroy-item:prompt", prompt);
  assert.equal(prompt.warning, "If you destroy this item, you will lose all contents stored within.");
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

test("a noose-wand catch puts its fur in an open fur pouch", (t) => {
  const Tracking = require("../plugins/skills/hunter/Tracking.Hunter");
  const { player, messages } = actor(t, [[I.NOOSE_WAND, 1], [I.SMALL_FUR_POUCH, 1]]);
  player.getSkillManager().setCurrentLevels(core.Skill.HUNTER, 99).setMaxLevel(core.Skill.HUNTER, 99);
  option(player, I.SMALL_FUR_POUCH, "Open");
  player.getInventory().adds(I.LOGS, 23); // three slots left: room for the whole catch
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

test("a sewn pouch takes the first free slot, not the fur's (captured)", (t) => {
  const { TaskManager } = require("../dist/game/task/TaskManager");
  if (!globalThis.__craftingRegistered) {
    require("../plugins/skills/Crafting.plugin").register(PluginManager.createApi("HunterPouchesCrafting"));
    globalThis.__craftingRegistered = true;
  }
  const { player, messages } = actor(t, [[I.COINS, 1], [I.NEEDLE, 1], [I.THREAD, 1], [I.LOGS, 1]]);
  player.getSkillManager().setCurrentLevels(core.Skill.CRAFTING, 99).setMaxLevel(core.Skill.CRAFTING, 99);
  player.getInventory().adds(I.FOX_FUR, 4);
  player.getInventory().deleteNumber(I.COINS, 1); // slot 0 free, the fur in slots 3-6
  const fur = player.getInventory().getItems().find((item) => item?.getId() === I.FOX_FUR);
  const needle = player.getInventory().getItems().find((item) => item?.getId() === I.NEEDLE);
  PluginManager.emitItemOnItem({ player, usedItem: needle, usedWithItem: fur, usedItemId: I.NEEDLE, usedWithItemId: I.FOX_FUR, handled: false });
  for (let i = 0; i < 4; i++) TaskManager.process();
  assert.ok(messages.length === 0 || !messages.includes("Nothing interesting happens."));
  assert.equal(player.getInventory().getItems()[0]?.getId(), I.SMALL_MEAT_POUCH);
  assert.equal(player.getInventory().getAmount(I.FOX_FUR), 0);
});
