// Run after `yarn build`: node --test tests/taxidermist.test.cjs
//
// The Canifis Taxidermist stuffs trophy heads and big fish; stuffed trophies Unstuff from the
// inventory. rsprox captures, rec 2617 (rev 229): a kurask head used on her (t7780) plays her
// transcript lines, the Yes please / No thanks menu, and at "There you go!" takes 6,000 coins and
// puts the stuffed head in the head's slot; Unstuff (t6388) opens "Re-stuffing it will cost 6,000
// coins." with "Remove the stuffing." / "Cancel", and removing it shows the head in an item box,
// "You carefully unstuff it.", the head back in its slot.
// Real engine: every plugin loaded, a real Player, the real transcript runner.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcDialogue } = require("../dist/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../dist/game/model/dialogues/entries/impl/PlayerDialogue");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");

let core;
let ids;
let next = 5300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const obj = (name) => core.CacheDefinitions.getObjId(name);
  ids = {
    taxidermist: core.CacheDefinitions.getNpcId("poh_taxidermist"),
    coins: obj("coins"),
    kurask: obj("poh_trophydrop_kurask"),
    kuraskStuffed: obj("poh_trophydrop_kurask_stuffed"),
    kbd: obj("poh_trophydrop_kbd"),
    kbdStuffed: obj("poh_trophydrop_kbd_stuffed"),
    shark: obj("poh_trophydrop_shark"),
    sharkStuffed: obj("poh_trophydrop_shark_stuffed"),
    vorkath: obj("vorkath_head"),
    vorkathStuffed: obj("vorkath_head_stuffed"),
    chicken: obj("raw_chicken"),
    bones: obj("bones"),
  };
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("taxidermy" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(3479, 3484, 0));
  player.needsPlacement = false;
  const scripts = [];
  t.mock.method(player.getPacketSender(), "sendClientScript", (...args) => {
    scripts.push(args);
    return player.getPacketSender();
  });
  return { player, scripts };
}

const put = (player, slot, id, amount = 1) => player.getInventory().setItem(slot, new core.Item(id, amount));
const at = (player, slot) => player.getInventory().getItems()[slot];
const coins = (player) => player.getInventory().getAmount(ids.coins);

function useOn(player, slot) {
  const npc = core.NPC.create(ids.taxidermist, new core.Location(3480, 3484, 0));
  const item = at(player, slot);
  return PluginManager.emitItemOnNpc({
    player, target: npc, definition: npc.getDefinition(), npcId: npc.getId(), item, itemId: item.getId(),
    slot, handled: false,
  });
}

function unstuff(player, slot) {
  const item = at(player, slot);
  return PluginManager.emitItemAction({
    player, interfaceId: 149, item, itemId: item.getId(), slot, clickType: 4, option: "Unstuff", handled: false,
  });
}

/** Lines spoken until a menu (or the end), continuing past each. */
function spoken(player) {
  const lines = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive(); i++) {
    const current = manager.getCurrent();
    if (current instanceof OptionDialogue) break;
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) lines.push(current.getText().replace(/\s+/g, " ").trim());
    manager.advance();
  }
  return lines;
}

/** The open menu, as { title, options }: a dialogue chain's options or a chatbox prompt's. */
function menu(player) {
  const current = player.getDialogueManager().getCurrent();
  if (current instanceof OptionDialogue) return { title: current.getTitle(), options: current.getOptions() };
  return core.MultiChatboxPrompt.getPending(player);
}

function choose(player, number) {
  const current = player.getDialogueManager().getCurrent();
  if (current instanceof OptionDialogue) return current.execute(number);
  assert.ok(core.MultiChatboxPrompt.getPending(player), "a menu is open");
  core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

test("a kurask head: her remark and price, then Yes please takes 6,000 coins and stuffs it in its slot (rec 2617 t7780)", (t) => {
  const { player } = actor(t);
  put(player, 0, ids.coins, 10000);
  put(player, 5, ids.kurask);
  const head = at(player, 5);
  assert.equal(useOn(player, 5), true);
  assert.deepEqual(spoken(player), ["A kurask? Splendid! Look at those horns!", "I can preserve that for you for 6,000 coins."]);
  assert.deepEqual(menu(player)?.options, ["Yes please", "No thanks"]);
  assert.equal(at(player, 5).getId(), ids.kurask, "nothing changes before the answer");
  choose(player, 1);
  assert.deepEqual(spoken(player), ["Yes please.", "There you go!"]);
  assert.equal(at(player, 5), head, "the same item, in the same slot");
  assert.equal(head.getId(), ids.kuraskStuffed);
  assert.equal(coins(player), 4000);
});

test("No thanks keeps the head and the coins", (t) => {
  const { player } = actor(t);
  put(player, 0, ids.coins, 10000);
  put(player, 5, ids.kurask);
  useOn(player, 5);
  spoken(player);
  choose(player, 2);
  assert.deepEqual(spoken(player), ["No thanks.", "All right, come back if you change your mind, eh?"]);
  assert.equal(at(player, 5).getId(), ids.kurask);
  assert.equal(coins(player), 10000);
});

test("too few coins: \"Maybe another time.\" and no menu", (t) => {
  const { player } = actor(t);
  put(player, 0, ids.coins, 5999);
  put(player, 5, ids.kurask);
  useOn(player, 5);
  assert.deepEqual(spoken(player), ["A kurask? Splendid! Look at those horns!", "I can preserve that for you for 6,000 coins.", "Maybe another time."]);
  assert.equal(menu(player), null);
  assert.equal(at(player, 5).getId(), ids.kurask);
  assert.equal(coins(player), 5999);
});

for (const [name, raw, stuffed, price, first] of [
  ["KBD heads", "kbd", "kbdStuffed", 50000, "Three?! This must be a King Black Dragon!"],
  ["a big shark", "shark", "sharkStuffed", 5000, "That's quite a fearsome shark! You've done everyone a service by removing it from the sea!"],
  ["Vorkath's head", "vorkath", "vorkathStuffed", 50000, "This blue dragon smells like it's been dead for a remarkably long time. Even by my standards, it smells awful."],
]) {
  test(`${name}: her own lines, the shared offer, its own price`, (t) => {
    const { player } = actor(t);
    put(player, 0, ids.coins, price);
    put(player, 3, ids[raw]);
    useOn(player, 3);
    const lines = spoken(player);
    assert.equal(lines[0], first);
    assert.equal(lines.at(-1), `I can preserve that for you for ${price.toLocaleString("en-US")} coins.`);
    choose(player, 1);
    spoken(player);
    assert.equal(at(player, 3).getId(), ids[stuffed]);
    assert.equal(coins(player), 0);
  });
}

test("the coins gone before Yes please: nothing is stuffed", (t) => {
  const { player } = actor(t);
  put(player, 0, ids.coins, 6000);
  put(player, 5, ids.kurask);
  useOn(player, 5);
  spoken(player);
  player.getInventory().setItem(0, new core.Item(ids.coins, 10));
  choose(player, 1);
  spoken(player);
  assert.equal(at(player, 5).getId(), ids.kurask);
  assert.equal(coins(player), 10);
});

test("other items get her remarks and nothing changes", (t) => {
  const { player } = actor(t);
  put(player, 0, ids.chicken);
  put(player, 1, ids.bones);
  useOn(player, 0);
  assert.deepEqual(spoken(player), ["Killing a chicken is hardly worth boasting about!"]);
  useOn(player, 1);
  assert.deepEqual(spoken(player), ["Don't be silly, I can't preserve that!"]);
  assert.equal(at(player, 0).getId(), ids.chicken);
});

test("Unstuff: the re-stuffing price as the menu title; Remove the stuffing puts the head back in its slot (rec 2617 t6388)", (t) => {
  const { player, scripts } = actor(t);
  put(player, 5, ids.kuraskStuffed);
  const trophy = at(player, 5);
  assert.equal(unstuff(player, 5), true);
  assert.equal(menu(player)?.title, "Re-stuffing it will cost 6,000 coins.");
  assert.deepEqual(menu(player)?.options, ["Remove the stuffing.", "Cancel"]);
  assert.ok(scripts.some(([id, title, options]) => id === 58 && title === "Re-stuffing it will cost 6,000 coins." && options === "Remove the stuffing.|Cancel"));
  choose(player, 1);
  assert.equal(at(player, 5), trophy, "the same item, in the same slot");
  assert.equal(trophy.getId(), ids.kurask);
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof ItemStatementDialogue, "an item box");
  assert.match(JSON.stringify(box), /You carefully unstuff it\./);
});

test("Unstuff: Cancel keeps it stuffed; each trophy names its own price", (t) => {
  const { player } = actor(t);
  put(player, 2, ids.kbdStuffed);
  unstuff(player, 2);
  assert.equal(menu(player)?.title, "Re-stuffing it will cost 50,000 coins.");
  choose(player, 2);
  assert.equal(at(player, 2).getId(), ids.kbdStuffed);
});

test("every trophy with an Unstuff option has a price from her transcript", () => {
  const { byStuffed, byUnstuffed } = require("../plugins/npcs/Taxidermist.plugin")._test;
  assert.equal(byStuffed.size, 20);
  assert.equal(byUnstuffed.size, 20);
  for (const trophy of byStuffed.values()) {
    assert.ok(trophy.price >= 1000, `${trophy.variant} has a price`);
  }
});
