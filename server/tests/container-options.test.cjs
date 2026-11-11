// Run after `yarn build`: node --test tests/container-options.test.cjs
// Issue 4462: Empty did nothing on a bucket of milk, jug of water, pot of flour, bucket of slime and plant cure (nor
// bowls of water, super/ultracompost and the pot of cornflour); Fill did nothing on an empty sack or basket, nor
// Fill/Remove-one on a filled one; and Potatoes(3)'s Empty was swallowed by The Final Dawn outside the quest.
// Expected values: rsprox captures, recording 20261111T230428 unless noted. Real engine: every plugin loaded, a real Player and Inventory, each item's own
// option through PluginManager.emitItemAction with its cache option index.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, obj, next = 9620;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  obj = (name) => core.CacheDefinitions.getObjId(name);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, items = []) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("cont" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  items.forEach(([id, amount = 1], slot) => p.getInventory().setItem(slot, new core.Item(id, amount)));
  const messages = [], sounds = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  t.mock.method(p.getPacketSender(), "sendTypedMessage", (_type, m) => { messages.push(m); return p.getPacketSender(); });
  t.mock.method(core.Sounds, "sendSound", (_p, sound) => sounds.push(sound.getId?.() ?? sound.id));
  return { p, messages, sounds };
}

function click(p, slot, option) {
  const item = p.getInventory().getItems()[slot];
  const clickType = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf(option) + 1;
  assert.ok(clickType > 0, `${option} is an option of ${item.getId()}`);
  const event = { player: p, item, interfaceId: core.CacheDefinitions.getComponentId("inventory:items"), itemId: item.getId(), slot, clickType, option, handled: false };
  PM.emitItemAction(event);
  return event;
}
const idAt = (p, slot) => p.getInventory().getItems()[slot]?.getId();

for (const [full, empty, message, sound] of [
  ["bucket_milk", "bucket_empty", "You empty the contents of the bucket on the floor.", 2401],
  ["pot_flour", "pot_empty", "You empty the contents of the pot on the floor.", 2584],
  ["bucket_ectoplasm", "bucket_empty", "You empty the contents of the bucket on the floor.", 2401], // Bucket of slime
  ["jug_water", "jug_empty", "You empty the contents of the jug on the floor.", 2401],
  ["plant_cure", "vial_empty", "You empty the contents of the vial on the floor.", 2401],
  ["bowl_water", "bowl_empty", "You empty the contents of the bowl on the floor.", 2401],
  ["bucket_supercompost", "bucket_empty", "You empty the bucket of supercompost.", undefined],
  ["bucket_ultracompost", "bucket_empty", "You empty the bucket of ultracompost.", undefined],
]) {
  test(`Empty on ${full} leaves ${empty} in its slot`, (t) => {
    const f = player(t, [[obj("coins"), 5], [obj(full)]]);
    assert.equal(click(f.p, 1, "Empty").handled, true);
    assert.equal(idAt(f.p, 1), obj(empty));
    assert.deepEqual(f.messages, [message]);
    assert.deepEqual(f.sounds, sound === undefined ? [] : [sound]);
  });
}

test("an empty sack fills with cabbages first, then onions, then potatoes, up to 10, in its own slot", (t) => {
  const potato = obj("potato"), onion = obj("onion"), cabbage = obj("cabbage");
  const f = player(t, [[obj("sack_empty")], ...Array(3).fill([potato]), ...Array(12).fill([onion]), ...Array(4).fill([cabbage])]);
  click(f.p, 0, "Fill");
  assert.equal(core.CacheDefinitions.getItem(idAt(f.p, 0)).name, "Cabbages(4)");
  assert.equal(f.p.getInventory().getAmount(cabbage), 0);
  assert.equal(f.p.getInventory().getAmount(onion), 12, "only one vegetable per sack");
  assert.deepEqual(f.messages, []);
});

test("Draynor Manor cabbages don't go in a sack (Wiki)", (t) => {
  const draynor = obj("magic_cabbage"); // the Draynor Manor cabbage, the second "Cabbage" in the cache
  assert.equal(core.CacheDefinitions.getItem(draynor).name, "Cabbage");
  const f = player(t, [[obj("sack_empty")], [draynor], [obj("onion")]]);
  click(f.p, 0, "Fill");
  assert.equal(core.CacheDefinitions.getItem(idAt(f.p, 0)).name, "Onions(1)");
  assert.equal(idAt(f.p, 1), draynor);
});

test("Fill on Potatoes(3) tops it up to 10 with potatoes only, silently; a full sack does nothing", (t) => {
  const potato = obj("potato");
  const f = player(t, [[obj("sack_potato_3")], ...Array(9).fill([potato]), [obj("onion")]]);
  click(f.p, 0, "Fill");
  assert.equal(idAt(f.p, 0), obj("sack_potato_10"));
  assert.equal(f.p.getInventory().getAmount(potato), 2);
  assert.equal(f.p.getInventory().getAmount(obj("onion")), 1);
  click(f.p, 0, "Fill");
  assert.equal(idAt(f.p, 0), obj("sack_potato_10"));
  assert.deepEqual(f.messages, []);
});

test("Remove-one takes one out with live's line; with a full inventory the sack is kept", (t) => {
  const f = player(t, [[obj("sack_potato_10")], [obj("sack_onion_10")]]);
  click(f.p, 0, "Remove-one");
  assert.equal(idAt(f.p, 0), obj("sack_potato_9"));
  assert.equal(f.p.getInventory().getAmount(obj("potato")), 1);
  click(f.p, 1, "Remove-one");
  assert.deepEqual(f.messages, ["You take a potato out of the potato sack.", "You take an onion out of the onion sack."]);
  const full = player(t, [[obj("sack_potato_10")], ...Array(27).fill([obj("logs")])]);
  click(full.p, 0, "Remove-one");
  assert.equal(idAt(full.p, 0), obj("sack_potato_10"));
  assert.equal(full.p.getInventory().getAmount(obj("potato")), 0);
});

test("a basket fills with up to five of one fruit, silently; Remove-one names the fruit", (t) => {
  const strawberry = obj("strawberry");
  const f = player(t, [[obj("basket_empty")], ...Array(7).fill([strawberry])]);
  click(f.p, 0, "Fill");
  assert.equal(idAt(f.p, 0), obj("basket_strawberry_5"));
  assert.equal(f.p.getInventory().getAmount(strawberry), 2);
  assert.deepEqual(f.messages, []);
  click(f.p, 0, "Remove-one");
  assert.equal(idAt(f.p, 0), obj("basket_strawberry_4"));
  assert.equal(f.p.getInventory().getAmount(strawberry), 3);
  assert.deepEqual(f.messages, ["You take a strawberry out of the strawberry basket."]);
  const bananas = player(t, [[obj("basket_empty")], ...Array(4).fill([obj("banana")])]);
  click(bananas.p, 0, "Fill");
  assert.equal(idAt(bananas.p, 0), obj("basket_banana_4"), "four bananas make Bananas(4)");
});

test("an empty sack with nothing to take says live's line; noted onions don't count", (t) => {
  const f = player(t, [[obj("sack_empty")], [obj("cert_onion"), 5]]);
  assert.equal(click(f.p, 0, "Fill").handled, true);
  assert.equal(idAt(f.p, 0), obj("sack_empty"));
  assert.deepEqual(f.messages, ["You don't have any potatoes, onions or cabbages."]);
});

test("a filled sack with none of its vegetable held does nothing, silently", (t) => {
  const f = player(t, [[obj("sack_cabbage_1")], [obj("onion")]]);
  assert.equal(click(f.p, 0, "Fill").handled, true);
  assert.equal(idAt(f.p, 0), obj("sack_cabbage_1"));
  assert.equal(f.p.getInventory().getAmount(obj("onion")), 1);
  assert.deepEqual(f.messages, []);
});

test("Pot of cornflour asks first; No keeps it, Yes leaves an empty pot in the first free slot", (t) => {
  const { MultiChatboxPrompt } = core;
  const choose = (p, option) => MultiChatboxPrompt.handleInterfaceActionClick({ player: p, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: option });
  const cornflour = obj("chickenquest_pot_cornflour");
  const f = player(t, [[obj("coins"), 5], [obj("logs")], [cornflour]]);
  f.p.getInventory().deleteNumber(obj("logs"), 1);
  click(f.p, 2, "Empty");
  assert.deepEqual(MultiChatboxPrompt.getPending(f.p), { title: "Are you sure you want to empty that pot?", options: ["Yes", "No"] });
  choose(f.p, 2);
  assert.equal(idAt(f.p, 2), cornflour, "No keeps the cornflour");
  assert.deepEqual(f.messages, []);
  click(f.p, 2, "Empty");
  choose(f.p, 1);
  assert.equal(f.p.getInventory().getAmount(cornflour), 0);
  assert.equal(idAt(f.p, 1), obj("pot_empty"), "the empty pot takes the first free slot");
  assert.deepEqual(f.messages, ["You empty the contents of the pot on the floor."]);
  assert.deepEqual(f.sounds, []);
});

test("outside The Final Dawn, Empty on Potatoes(3) empties it", (t) => {
  const f = player(t, [[obj("sack_potato_3")]]);
  click(f.p, 0, "Empty");
  assert.equal(f.p.getInventory().getAmount(obj("sack_empty")), 1);
  assert.equal(f.p.getInventory().getAmount(obj("potato")), 3);
});
