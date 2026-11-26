// Run after `yarn build`: node --test tests/guardian-boots.test.cjs
//
// Guardian boots follow rsprox capture 2225 (rev 228, ticks 221-229): core used on Bandos boots,
// a two-item confirmation box, a "Yes." / "No." menu, and one tick after Yes the guardian boots in
// the core's slot with the absorption box. No experience is given. Everything goes through the
// real PluginManager dispatch, dialogue manager, MultiChatboxPrompt and TaskManager.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");

const GuardianBoots = require("../plugins/items/GuardianBoots.plugin");

const CONFIRM = "Do you really want to combine these items together into Guardian boots? You cannot undo this process.";
const MENU_TITLE = "Really combine these into guardian boots?";
const SUCCESS = "The second you hold your tourmaline core by the Bandos boots, the core is absorbed rapidly. Perhaps there is some link between the metal in Bandos and tourmaline...";

let core;
let BOOTS;
let CORE;
let RESULT;
let next = 3700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  BOOTS = core.ItemIdentifiers.BANDOS_BOOTS;
  CORE = core.ItemIdentifiers.BLACK_TOURMALINE_CORE;
  RESULT = core.ItemIdentifiers.GUARDIAN_BOOTS;
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("guardianboots" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3234, 3222, 0));
  player.needsPlacement = false;
  const messages = [];
  const animations = [];
  const xp = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  t.mock.method(player, "performAnimation", (animation) => animations.push(animation));
  t.mock.method(player.getSkillManager(), "addExperiences", (skill, amount) => xp.push([skill, amount]));
  return { player, messages, animations, xp };
}

const slots = (player) => player.getInventory().getItems().map((item) => (item && item.getId() > 0 ? item.getId() : -1));
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

function give(player, ...ids) {
  for (const id of ids) player.getInventory().add(new core.Item(id, 1), false);
}

function itemOnItem(player, usedId, targetId) {
  const items = player.getInventory().getItems();
  const usedSlot = items.findIndex((item) => item && item.getId() === usedId);
  const targetSlot = items.findIndex((item) => item && item.getId() === targetId);
  return PluginManager.emitItemOnItem({
    player, usedItem: items[usedSlot], usedItemId: usedId, usedItemSlot: usedSlot,
    usedWithItem: items[targetSlot], usedWithItemId: targetId, usedWithItemSlot: targetSlot, handled: false,
  });
}

function openMenu(player) {
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof DoubleItemStatementDialogue, "the two-item confirmation box is up");
  player.getDialogueManager().advance();
  assert.ok(pending(player), "the Yes / No menu is up");
  return box;
}

function answer(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

function tick() {
  core.TaskManager.process();
}

test("the plugin is members content", () => {
  assert.equal(GuardianBoots.members, true);
});

for (const [order, used, target] of [["core on boots", () => CORE, () => BOOTS], ["boots on core", () => BOOTS, () => CORE]]) {
  test(`${order}: asks first with the captured box and menu, consuming nothing`, (t) => {
    const { player } = actor(t);
    give(player, CORE, BOOTS);
    const before = slots(player);
    itemOnItem(player, used(), target());
    const box = openMenu(player);
    assert.deepEqual(box.getItemIds(), [BOOTS, CORE], "boots on the left, core on the right");
    assert.equal(box.getText(), CONFIRM);
    assert.equal(pending(player).title, MENU_TITLE);
    assert.deepEqual(pending(player).options, ["Yes.", "No."]);
    assert.deepEqual(slots(player), before);
  });
}

test("Yes makes the boots one tick later in the core's slot, with the captured box and no xp", (t) => {
  const { player, animations, xp } = actor(t);
  give(player, CORE, BOOTS);
  itemOnItem(player, CORE, BOOTS);
  openMenu(player);
  answer(player, 1);
  assert.equal(slots(player)[0], CORE, "nothing changes on the click tick");
  assert.equal(slots(player)[1], BOOTS);
  tick();
  const after = slots(player);
  assert.equal(after[0], RESULT, "the guardian boots take the core's slot (capture 2225, tick 227)");
  assert.equal(after[1], -1, "the boots' slot is empty");
  assert.equal(after.filter((id) => id !== -1).length, 1);
  const success = player.getDialogueManager().getCurrent();
  assert.ok(success instanceof ItemStatementDialogue);
  assert.equal(success.getItemId(), RESULT);
  assert.equal(success.getText(), SUCCESS);
  assert.deepEqual(xp, [], "no experience");
  assert.deepEqual(animations, [], "no animation");
});

test("No consumes nothing", (t) => {
  const { player } = actor(t);
  give(player, CORE, BOOTS);
  const before = slots(player);
  itemOnItem(player, CORE, BOOTS);
  openMenu(player);
  answer(player, 2);
  tick();
  tick();
  assert.deepEqual(slots(player), before);
  assert.equal(pending(player), null);
});

for (const [label, dropped] of [["core", () => CORE], ["boots", () => BOOTS]]) {
  test(`the ${label} dropped after the prompt is re-checked: nothing is consumed`, (t) => {
    const { player } = actor(t);
    give(player, CORE, BOOTS);
    itemOnItem(player, CORE, BOOTS);
    openMenu(player);
    answer(player, 1);
    const slot = slots(player).indexOf(dropped());
    player.getInventory().deleteAtSlot(slot, 1, false);
    const left = slots(player);
    tick();
    assert.deepEqual(slots(player), left, "nothing created or consumed");
    assert.ok(!slots(player).includes(RESULT));
  });
}

test("only one pair converts even with spare boots and cores", (t) => {
  const { player } = actor(t);
  give(player, CORE, BOOTS, CORE, BOOTS);
  itemOnItem(player, CORE, BOOTS);
  openMenu(player);
  answer(player, 1);
  tick();
  const held = slots(player).filter((id) => id !== -1).sort((a, b) => a - b);
  assert.deepEqual(held, [BOOTS, CORE, RESULT].sort((a, b) => a - b));
});

test("noted ingredients are not combined", (t) => {
  const { player } = actor(t);
  const notedBoots = core.ItemIdentifiers.BANDOS_BOOTS_2;
  give(player, CORE, notedBoots);
  itemOnItem(player, CORE, notedBoots);
  assert.equal(player.getDialogueManager().isActive(), false);
  assert.equal(pending(player), null);
});

test("a second Yes on the same menu makes one pair only", (t) => {
  const { player } = actor(t);
  give(player, CORE, BOOTS, CORE, BOOTS);
  itemOnItem(player, CORE, BOOTS);
  openMenu(player);
  answer(player, 1);
  answer(player, 1);
  tick();
  tick();
  assert.equal(slots(player).filter((id) => id === RESULT).length, 1);
});
