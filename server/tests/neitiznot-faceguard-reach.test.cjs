// Run after `yarn build`: node --test tests/neitiznot-faceguard-reach.test.cjs
//
// Reachability through the real plugins and engine (PluginManager with every plugin loaded, a real
// Player, the real NpcDialogues transcript runner): a player must be able to learn Olaf's story,
// attach the jaw and dismantle the faceguard, with no step called directly.
// Captured route (rsprox 1862): the jaw used on Olaf plays "You show the Basilisk Jaw to Olaf." and
// his story. Music's Talk-to menu is left as it is.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const STORY_ATTRIBUTE = "neitiznot:faceguard-story";
const STORY_VARBIT = 9472;
let core;
let next = 3100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2673, 3685);
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("faceguard" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2673, 3684, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function login(player) {
  PluginManager.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: false });
}

/** The story needs The Fremennik Exiles (Wiki: Basilisk jaw); finish it the way the quest does. */
function completeExiles(player) {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_fremennik_exiles");
  quest.setStage(player, 130);
}

function give(player, id) {
  player.getInventory().add(new core.Item(id), false);
}

const amount = (player, id) => player.getInventory().getAmount(id);

function jawOnOlaf(player, itemId = core.ItemIdentifiers.BASILISK_JAW) {
  const olaf = core.NPC.create(core.NpcIdentifiers.OLAF_THE_BARD, new core.Location(2673, 3685, 0));
  const item = player.getInventory().getValidItems().find((entry) => entry.getId() === itemId);
  return PluginManager.emitItemOnNpc({
    player, target: olaf, definition: olaf.getDefinition(), npcId: olaf.getId(), item, itemId,
    slot: player.getInventory().getItems().indexOf(item), handled: false,
  });
}

function playOut(player) {
  const manager = player.getDialogueManager();
  for (let i = 0; i < 60 && manager.isActive(); i++) manager.advance();
}

function itemOnItem(player, usedId, withId) {
  const items = player.getInventory().getValidItems();
  const used = items.find((entry) => entry.getId() === usedId);
  const target = items.find((entry) => entry.getId() === withId);
  const slots = player.getInventory().getItems();
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: usedId, usedItemSlot: slots.indexOf(used),
    usedWithItem: target, usedWithItemId: withId, usedWithItemSlot: slots.indexOf(target), handled: false,
  });
}

function pick(player, number) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: number, action: number,
  });
}

test("the jaw used on Olaf plays his story and learns it, keeping the jaw", (t) => {
  const { player } = actor(t);
  completeExiles(player);
  give(player, core.ItemIdentifiers.BASILISK_JAW);
  assert.equal(jawOnOlaf(player), true, "the use is handled");
  assert.ok(player.getDialogueManager().isActive(), "a conversation starts");
  playOut(player);
  assert.equal(player.getAttribute(STORY_ATTRIBUTE), true);
  assert.equal(player.getPacketSender().getVarbit(STORY_VARBIT), 1);
  assert.equal(amount(player, core.ItemIdentifiers.BASILISK_JAW), 1);
});

test("another item used on Olaf is not taken by the faceguard plugin", (t) => {
  const { player } = actor(t);
  give(player, core.ItemIdentifiers.COINS);
  assert.equal(jawOnOlaf(player, core.ItemIdentifiers.COINS), false);
  assert.equal(player.getAttribute(STORY_ATTRIBUTE) === true, false);
});

test("the full route: story, then helm and jaw make the faceguard, Dismantle undoes it", (t) => {
  const { player } = actor(t);
  const I = core.ItemIdentifiers;
  completeExiles(player);
  give(player, I.BASILISK_JAW);
  give(player, I.HELM_OF_NEITIZNOT);
  jawOnOlaf(player);
  playOut(player);

  assert.equal(itemOnItem(player, I.BASILISK_JAW, I.HELM_OF_NEITIZNOT), true);
  assert.equal(core.MultiChatboxPrompt.getPending(player)?.title, "Attach the jaw to the helmet?");
  assert.equal(pick(player, 1), true);
  assert.equal(amount(player, I.NEITIZNOT_FACEGUARD), 1);
  assert.equal(amount(player, I.HELM_OF_NEITIZNOT), 0);
  assert.equal(amount(player, I.BASILISK_JAW), 0);

  const options = core.CacheDefinitions.getItem(I.NEITIZNOT_FACEGUARD).inventoryActions;
  const index = options.indexOf("Dismantle");
  assert.ok(index >= 0, `the cache gives the faceguard a Dismantle option: ${JSON.stringify(options)}`);
  const item = player.getInventory().getValidItems().find((entry) => entry.getId() === I.NEITIZNOT_FACEGUARD);
  assert.equal(PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(),
    slot: player.getInventory().getItems().indexOf(item), clickType: index + 1, option: "Dismantle", handled: false,
  }), true);
  assert.equal(core.MultiChatboxPrompt.getPending(player)?.title, "Remove the jaw from the helmet?");
  assert.equal(pick(player, 1), true);
  assert.equal(amount(player, I.NEITIZNOT_FACEGUARD), 0);
  assert.equal(amount(player, I.HELM_OF_NEITIZNOT), 1);
  assert.equal(amount(player, I.BASILISK_JAW), 1);
});

test("without the story the combine asks nothing and consumes nothing", (t) => {
  const { player } = actor(t);
  const I = core.ItemIdentifiers;
  give(player, I.BASILISK_JAW);
  give(player, I.HELM_OF_NEITIZNOT);
  itemOnItem(player, I.BASILISK_JAW, I.HELM_OF_NEITIZNOT);
  assert.equal(core.MultiChatboxPrompt.getPending(player), null);
  assert.equal(amount(player, I.BASILISK_JAW), 1);
  assert.equal(amount(player, I.HELM_OF_NEITIZNOT), 1);
});

test("a learned story keeps varbit 9472 on login, and an unlearned one stays at 0", (t) => {
  const learned = actor(t).player;
  learned.setAttribute(STORY_ATTRIBUTE, true);
  login(learned);
  assert.equal(learned.getPacketSender().getVarbit(STORY_VARBIT), 1);
  const fresh = actor(t).player;
  login(fresh);
  assert.equal(fresh.getPacketSender().getVarbit(STORY_VARBIT), 0);
});

test("Music keeps Olaf's Talk-to cape prompt for a player who has not started the Trials", (t) => {
  const { player } = actor(t);
  const olaf = core.NPC.create(core.NpcIdentifiers.OLAF_THE_BARD, new core.Location(2673, 3685, 0));
  PluginManager.emitNpcInteraction({
    player, npc: olaf, npcId: olaf.getId(), definition: olaf.getDefinition(), clickType: 1, handled: false,
  });
  assert.equal(core.MultiChatboxPrompt.getPending(player)?.title, "Music cape");
});
