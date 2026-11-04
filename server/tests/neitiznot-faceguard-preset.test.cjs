// Run after `yarn build`: node --test tests/neitiznot-faceguard-preset.test.cjs
//
// Free preset items must not become ordinary tradeable items through the faceguard. The items come
// from the real preset producer (Presets.PvpMode spawnPresetItem), the combine and Dismantle go
// through the real PluginManager hooks, and the Yes/No answer through the real MultiChatboxPrompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");

const STORY_ATTRIBUTE = "neitiznot:faceguard-story";
let core;
let I;
let next = 3300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
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
  player.setUsername("presetguard" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  player.setAttribute(STORY_ATTRIBUTE, true);
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
  assert.equal(item.isTradeable(), false);
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
  assert.notEqual(slotOf(player, replacement), -1);
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
  assert.ok(index >= 0, "the cache gives the faceguard a Dismantle option");
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot: slotOf(player, item),
    clickType: index + 1, option: "Dismantle", handled: false,
  });
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

test("the producer's metadata is what the plugin must respect", () => {
  const helm = preset(I.HELM_OF_NEITIZNOT);
  assert.equal(helm.getMetaValue(core.Item.UNTRADEABLE_META), true);
  assert.equal(helm.getMetaValue(core.Item.UNBANKABLE_META), true);
  assert.equal(helm.getMetaValue(core.Item.PRESET_META), true);
});

test("a preset helm with a real jaw is refused at the prompt", (t) => {
  const { player, messages } = actor(t);
  const helm = preset(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  player.getInventory().add(helm, false);
  player.getInventory().add(jaw, false);
  itemOnItem(player, jaw, helm);
  assert.equal(pending(player), null, "no confirmation is offered");
  assert.deepEqual(ids(player), [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW].sort((a, b) => a - b));
  assert.equal(held(player).find((item) => item.getId() === I.HELM_OF_NEITIZNOT).isPresetItem(), true);
  assert.ok(messages.length >= 1, "the player is told why");
});

test("a real helm with a preset jaw is refused at the prompt", (t) => {
  const { player } = actor(t);
  const helm = real(I.HELM_OF_NEITIZNOT);
  const jaw = preset(I.BASILISK_JAW);
  player.getInventory().add(helm, false);
  player.getInventory().add(jaw, false);
  itemOnItem(player, helm, jaw);
  assert.equal(pending(player), null);
  assert.deepEqual(ids(player), [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW].sort((a, b) => a - b));
});

test("with a preset and a real helm, using the preset helm is refused", (t) => {
  const { player } = actor(t);
  const presetHelm = preset(I.HELM_OF_NEITIZNOT);
  const realHelm = real(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  for (const item of [presetHelm, realHelm, jaw]) player.getInventory().add(item, false);
  itemOnItem(player, presetHelm, jaw);
  assert.equal(pending(player), null);
  assert.equal(ids(player).length, 3);
});

test("with a preset and a real helm, Yes consumes the real one and the preset helm stays restricted", (t) => {
  const { player } = actor(t);
  const presetHelm = preset(I.HELM_OF_NEITIZNOT);
  const realHelm = real(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  for (const item of [presetHelm, realHelm, jaw]) player.getInventory().add(item, false);
  itemOnItem(player, realHelm, jaw);
  assert.equal(pending(player)?.title, "Attach the jaw to the helmet?");
  answer(player, 1);
  const left = held(player);
  assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b),
    [I.HELM_OF_NEITIZNOT, I.NEITIZNOT_FACEGUARD].sort((a, b) => a - b));
  assert.equal(left.find((item) => item.getId() === I.HELM_OF_NEITIZNOT).isPresetItem(), true,
    "the remaining helm is the preset one");
  assert.equal(left.find((item) => item.getId() === I.NEITIZNOT_FACEGUARD).isPresetItem(), false);
});

test("a preset helm swapped in after the prompt is not consumed at Yes", (t) => {
  const { player } = actor(t);
  const realHelm = real(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  player.getInventory().add(realHelm, false);
  player.getInventory().add(jaw, false);
  itemOnItem(player, realHelm, jaw);
  assert.ok(pending(player));
  swapIn(player, realHelm, preset(I.HELM_OF_NEITIZNOT));
  answer(player, 1);
  const left = held(player);
  assert.deepEqual(left.map((item) => item.getId()).sort((a, b) => a - b),
    [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW].sort((a, b) => a - b));
  assert.equal(left.find((item) => item.getId() === I.HELM_OF_NEITIZNOT).isPresetItem(), true);
});

test("a preset jaw swapped in after the prompt is not consumed at Yes", (t) => {
  const { player } = actor(t);
  const realHelm = real(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  player.getInventory().add(realHelm, false);
  player.getInventory().add(jaw, false);
  itemOnItem(player, realHelm, jaw);
  swapIn(player, jaw, preset(I.BASILISK_JAW));
  answer(player, 1);
  assert.deepEqual(ids(player), [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW].sort((a, b) => a - b));
  assert.equal(held(player).find((item) => item.getId() === I.BASILISK_JAW).isPresetItem(), true);
});

test("Dismantle on a preset faceguard is refused and keeps it", (t) => {
  const { player, messages } = actor(t);
  const faceguard = preset(I.NEITIZNOT_FACEGUARD);
  player.getInventory().add(faceguard, false);
  dismantle(player, faceguard);
  assert.equal(pending(player), null, "no confirmation is offered");
  assert.deepEqual(ids(player), [I.NEITIZNOT_FACEGUARD]);
  assert.equal(held(player)[0].isPresetItem(), true);
  assert.ok(messages.length >= 1);
});

test("a preset faceguard swapped in after the Dismantle prompt is not taken apart at Yes", (t) => {
  const { player } = actor(t);
  const faceguard = real(I.NEITIZNOT_FACEGUARD);
  player.getInventory().add(faceguard, false);
  dismantle(player, faceguard);
  assert.ok(pending(player));
  swapIn(player, faceguard, preset(I.NEITIZNOT_FACEGUARD));
  answer(player, 1);
  assert.deepEqual(ids(player), [I.NEITIZNOT_FACEGUARD]);
  assert.equal(held(player)[0].isPresetItem(), true);
});

test("ordinary items still make and unmake a faceguard", (t) => {
  const { player } = actor(t);
  const helm = real(I.HELM_OF_NEITIZNOT);
  const jaw = real(I.BASILISK_JAW);
  player.getInventory().add(helm, false);
  player.getInventory().add(jaw, false);
  itemOnItem(player, jaw, helm);
  answer(player, 1);
  assert.deepEqual(ids(player), [I.NEITIZNOT_FACEGUARD]);
  const faceguard = held(player)[0];
  dismantle(player, faceguard);
  answer(player, 1);
  assert.deepEqual(ids(player), [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW].sort((a, b) => a - b));
});
