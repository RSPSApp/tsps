// Run after `yarn build`: node --test tests/avernic-defender-preset.test.cjs
//
// Free preset items must not turn into ordinary bankable items through item conversions. The
// items come from the real preset producer (Presets.PvpMode spawnPresetItem); actions and the Yes
// answer go through the real PluginManager hooks and MultiChatboxPrompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

let core;
let I;
let next = 3700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("presetdef" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

/** An item made by the real preset producer. */
function preset(id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const item = Presets._test.spawnPresetItem(new core.Item(id, 1), Presets.getGlobalPresetPool()[0]);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  assert.equal(item.isUnbankable(), true);
  return item;
}

/** An item copied from the named global preset's real inventory entry. */
function presetItem(presetName, id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const source = Presets.getGlobalPresetByName(presetName);
  assert.ok(source, `the ${presetName} global preset exists`);
  const template = source.getInventory().find((item) => item.getId() === id);
  assert.ok(template, `the ${presetName} preset contains item ${id}`);
  const item = Presets._test.spawnPresetItem(template, source);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  assert.equal(item.isUnbankable(), true);
  return item;
}

const real = (id) => new core.Item(id, 1);

/** Slot of an item by value: add() stores a clone, so the original instance is never in the container. */
function slotOf(player, item) {
  return player.getInventory().getItems().findIndex((entry) => entry && entry.equals(item));
}

/** The instance the container actually holds, as the engine would hand it to a hook. */
function stored(player, item) {
  const slot = slotOf(player, item);
  assert.ok(slot >= 0, "the item is in the inventory");
  return player.getInventory().getItems()[slot];
}

/** Takes the real item out and puts the replacement in, proving both happened before any assertion. */
function swapIn(player, original, replacement) {
  const slot = slotOf(player, original);
  assert.ok(slot >= 0, "the item to swap out is in the inventory");
  player.getInventory().deleteAtSlot(slot, 1, false);
  assert.equal(slotOf(player, original), -1, "the original is gone");
  player.getInventory().add(replacement, false);
  assert.ok(slotOf(player, replacement) >= 0, "the replacement is in");
}

const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const sortedIds = (list) => [...list].sort((a, b) => a - b);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

function give(player, ...items) {
  for (const item of items) player.getInventory().add(item, false);
}

function itemOnItem(player, usedValue, targetValue) {
  const used = stored(player, usedValue);
  const target = stored(player, targetValue);
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, used),
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: slotOf(player, target), handled: false,
  });
}

function dismantle(player, itemValue) {
  const item = stored(player, itemValue);
  const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Dismantle");
  assert.ok(index >= 0, "the cache gives the item a Dismantle option");
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot: slotOf(player, item),
    clickType: index + 1, option: "Dismantle", handled: false,
  });
}

function yes(player) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1,
  });
}

test("a dragon defender is in a global preset, so the producer restricts it", () => {
  const defender = preset(I.DRAGON_DEFENDER);
  assert.equal(defender.getMetaValue(core.Item.PRESET_META), true);
  assert.equal(defender.getMetaValue(core.Item.UNBANKABLE_META), true);
});

test("a preset dragon defender with a real hilt is refused at the prompt", (t) => {
  const { player, messages } = actor(t);
  const defender = preset(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, defender, hilt);
  itemOnItem(player, hilt, defender);
  assert.equal(pending(player), null, "no confirmation is offered");
  assert.deepEqual(ids(player), sortedIds([I.DRAGON_DEFENDER, I.AVERNIC_DEFENDER_HILT]));
  assert.equal(held(player).find((item) => item.getId() === I.DRAGON_DEFENDER).isPresetItem(), true);
  assert.ok(messages.length >= 1, "the player is told why");
});

test("a preset hilt with a real dragon defender is refused at the prompt", (t) => {
  const { player } = actor(t);
  const defender = real(I.DRAGON_DEFENDER);
  const hilt = preset(I.AVERNIC_DEFENDER_HILT);
  give(player, defender, hilt);
  itemOnItem(player, defender, hilt);
  assert.equal(pending(player), null);
  assert.deepEqual(ids(player), sortedIds([I.DRAGON_DEFENDER, I.AVERNIC_DEFENDER_HILT]));
});

test("with a preset and a real dragon defender, using the preset one is refused", (t) => {
  const { player } = actor(t);
  const presetDefender = preset(I.DRAGON_DEFENDER);
  const realDefender = real(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, presetDefender, realDefender, hilt);
  itemOnItem(player, hilt, presetDefender);
  assert.equal(pending(player), null);
  assert.equal(ids(player).length, 3);
});

test("with a preset and a real dragon defender, Yes consumes the real one", (t) => {
  const { player } = actor(t);
  const presetDefender = preset(I.DRAGON_DEFENDER);
  const realDefender = real(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, presetDefender, realDefender, hilt);
  itemOnItem(player, hilt, realDefender);
  assert.ok(pending(player), "the confirmation is offered");
  yes(player);
  const left = held(player);
  assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b),
    sortedIds([I.DRAGON_DEFENDER, I.AVERNIC_DEFENDER]));
  assert.equal(left.find((item) => item.getId() === I.DRAGON_DEFENDER).isPresetItem(), true,
    "the defender that remains is the preset one");
  assert.equal(left.find((item) => item.getId() === I.AVERNIC_DEFENDER).isPresetItem(), false);
});

test("a preset defender swapped in after the prompt is not consumed at Yes", (t) => {
  const { player } = actor(t);
  const defender = real(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, defender, hilt);
  itemOnItem(player, hilt, defender);
  assert.ok(pending(player));
  swapIn(player, defender, preset(I.DRAGON_DEFENDER));
  yes(player);
  assert.deepEqual(ids(player), sortedIds([I.DRAGON_DEFENDER, I.AVERNIC_DEFENDER_HILT]));
  assert.equal(held(player).find((item) => item.getId() === I.DRAGON_DEFENDER).isPresetItem(), true);
});

test("a preset hilt swapped in after the prompt is not consumed at Yes", (t) => {
  const { player } = actor(t);
  const defender = real(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, defender, hilt);
  itemOnItem(player, defender, hilt);
  assert.ok(pending(player));
  swapIn(player, hilt, preset(I.AVERNIC_DEFENDER_HILT));
  yes(player);
  assert.deepEqual(ids(player), sortedIds([I.DRAGON_DEFENDER, I.AVERNIC_DEFENDER_HILT]));
  assert.equal(held(player).find((item) => item.getId() === I.AVERNIC_DEFENDER_HILT).isPresetItem(), true);
});

test("Dismantle on a restricted Avernic defender is refused and keeps it", (t) => {
  const { player, messages } = actor(t);
  const defender = preset(I.AVERNIC_DEFENDER);
  give(player, defender);
  dismantle(player, defender);
  assert.equal(pending(player), null, "no confirmation is offered");
  assert.deepEqual(ids(player), [I.AVERNIC_DEFENDER]);
  assert.equal(held(player)[0].isPresetItem(), true);
  assert.ok(messages.length >= 1);
});

test("a restricted Avernic defender swapped in after the Dismantle prompt is not taken apart", (t) => {
  const { player } = actor(t);
  const defender = real(I.AVERNIC_DEFENDER);
  give(player, defender);
  dismantle(player, defender);
  assert.ok(pending(player));
  swapIn(player, defender, preset(I.AVERNIC_DEFENDER));
  yes(player);
  assert.deepEqual(ids(player), [I.AVERNIC_DEFENDER]);
  assert.equal(held(player)[0].isPresetItem(), true);
});

test("Dismantle refuses the real Main AGS preset sword before prompting", (t) => {
  const { player, messages } = actor(t);
  const sword = presetItem("Main AGS", I.ARMADYL_GODSWORD);
  give(player, sword);
  dismantle(player, sword);
  assert.equal(pending(player), null, "no confirmation is offered");
  assert.deepEqual(ids(player), [I.ARMADYL_GODSWORD]);
  assert.equal(held(player)[0].isPresetItem(), true);
  assert.equal(held(player).some((item) => item.getId() === I.GODSWORD_BLADE || item.getId() === I.ARMADYL_HILT), false);
  assert.ok(messages.length >= 1, "the player is told why");
});

test("Dismantle rechecks godsword restrictions after Yes", (t) => {
  const { player, messages } = actor(t);
  const sword = real(I.ARMADYL_GODSWORD);
  give(player, sword);
  dismantle(player, sword);
  assert.ok(pending(player), "the confirmation is offered for an unrestricted sword");
  const heldSword = stored(player, sword);
  heldSword.setMetaValue(core.Item.PRESET_META, true);
  heldSword.setMetaValue(core.Item.UNTRADEABLE_META, true);
  heldSword.setMetaValue(core.Item.UNBANKABLE_META, true);
  yes(player);
  assert.deepEqual(ids(player), [I.ARMADYL_GODSWORD]);
  assert.equal(held(player)[0].isPresetItem(), true);
  assert.ok(messages.length >= 1, "the player is told why dismantling stopped");
});

test("ordinary items still combine and dismantle", (t) => {
  const { player } = actor(t);
  const defender = real(I.DRAGON_DEFENDER);
  const hilt = real(I.AVERNIC_DEFENDER_HILT);
  give(player, defender, hilt);
  itemOnItem(player, hilt, defender);
  yes(player);
  assert.deepEqual(ids(player), [I.AVERNIC_DEFENDER]);
  dismantle(player, held(player)[0]);
  yes(player);
  assert.deepEqual(ids(player), [I.DRAGON_DEFENDER]);
});
