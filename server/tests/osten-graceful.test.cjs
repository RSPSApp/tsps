// Run after `yarn build`: node --test tests/osten-graceful.test.cjs
//
// Osten recolours a graceful piece to a Kourend house's colours for 15 marks of grace, once that house's
// quest is done (Kourend's own colours need all five), and reverts a coloured piece for free with no
// refund (Wiki: Graceful outfit#Recolouring, Transcript:Osten). Real engine: every plugin, a real Player,
// the real transcript runner and prompts, the real quest stages.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Graceful = require("../plugins/items/GracefulOutfit.plugin");

const QUESTS = {
  Arceuus: "The Ascent of Arceuus",
  Hosidius: "The Depths of Despair",
  Lovakengj: "The Forsaken Tower",
  Piscarilius: "The Queen of Thieves",
  Shayzien: "Tale of the Righteous",
};
const HOOD = 11850;
const ARCEUUS_HOOD = 13579;
const KOUREND_HOOD = 13667;
const PISCARILIUS_HOOD = 13591;
let core;
let next = 5300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
});

function actor(t, marks = 0) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("ostenqa" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(1503, 3589, 0));
  player.needsPlacement = false;
  t.mock.method(player.getPacketSender(), "sendMessage", () => player.getPacketSender());
  if (marks > 0) player.getInventory().add(new core.Item(core.ItemIdentifiers.MARK_OF_GRACE, marks), false);
  return player;
}

function complete(player, ...houses) {
  for (const house of houses) {
    const quest = QuestRuntime.questNamed(QUESTS[house]);
    assert.ok(quest, `${QUESTS[house]} is registered`);
    quest.setStage(player, quest.completionValue ?? 2);
  }
}

const marks = (player) => player.getInventory().getAmount(core.ItemIdentifiers.MARK_OF_GRACE);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);
const ids = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0).map((item) => item.getId());

/** Continues through the lines up to the next menu; returns what was said. */
function lines(player) {
  const said = [];
  const manager = player.getDialogueManager();
  for (let i = 0; i < 40 && manager.isActive() && !pending(player); i++) {
    const current = manager.getCurrent();
    if (current instanceof NpcDialogue || current instanceof PlayerDialogue) said.push(current.getText().replace(/\s+/g, " ").trim());
    manager.advance();
  }
  return said;
}

/** The labels of the open menu. */
function options(player) {
  return pending(player)?.options?.map((option) => option.label ?? option.text ?? option) ?? [];
}

function pick(player, label) {
  const menu = options(player);
  const index = menu.indexOf(label);
  assert.ok(index >= 0, `"${label}" is offered (menu: ${menu.join(" | ")})`);
  core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: index + 1, action: index + 1,
  });
  return lines(player);
}

function use(player, itemId) {
  const npc = core.NPC.create(core.NpcIdentifiers.OSTEN, new core.Location(1503, 3590, 0));
  const slot = player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const item = player.getInventory().getItems()[slot];
  const handled = PluginManager.emitItemOnNpc({
    player, target: npc, definition: npc.getDefinition(), npcId: npc.getId(), item, itemId, slot, handled: false,
  });
  return { handled, said: lines(player) };
}

function give(player, id) {
  player.getInventory().add(new core.Item(id, 1), false);
}

test("a plain hood and 15 marks become an Arceuus hood after The Ascent of Arceuus", (t) => {
  const player = actor(t, 20);
  complete(player, "Arceuus");
  give(player, HOOD);
  const { handled, said } = use(player, HOOD);
  assert.equal(handled, true);
  assert.deepEqual(said, ["Are you sure you want to recolour that piece of graful clothing? It will cost 15 marks of grace."]);
  assert.match(pick(player, "That seems reasonable.").join("\n"), /Which city would you like to represent\?/);
  assert.deepEqual(options(player), ["Arceuus.", "Actually, forget it."], "only the unlocked house is offered");
  pick(player, "Arceuus.");
  assert.deepEqual(ids(player).sort(), [core.ItemIdentifiers.MARK_OF_GRACE, ARCEUUS_HOOD].sort());
  assert.equal(marks(player), 5);
  assert.equal(player.getDialogueManager().isActive(), false, "the conversation ends");
});

test("without the house's quest its colour is not offered", (t) => {
  const player = actor(t, 20);
  give(player, HOOD);
  use(player, HOOD);
  pick(player, "That seems reasonable.");
  assert.deepEqual(options(player), ["Actually, forget it.", "Goodbye."]);
  pick(player, "Actually, forget it.");
  assert.deepEqual(ids(player).sort(), [core.ItemIdentifiers.MARK_OF_GRACE, HOOD].sort());
  assert.equal(marks(player), 20);
});

test("Kourend (Osten's colours) needs all five house quests", (t) => {
  const four = actor(t, 20);
  complete(four, "Arceuus", "Hosidius", "Lovakengj", "Piscarilius");
  give(four, HOOD);
  use(four, HOOD);
  pick(four, "That seems reasonable.");
  assert.equal(options(four).includes("I want the colours you're wearing."), false, "refused with four of five");

  const five = actor(t, 20);
  complete(five, "Arceuus", "Hosidius", "Lovakengj", "Piscarilius", "Shayzien");
  give(five, HOOD);
  use(five, HOOD);
  pick(five, "That seems reasonable.");
  pick(five, "More...");
  pick(five, "I want the colours you're wearing.");
  assert.equal(ids(five).includes(KOUREND_HOOD), true);
  assert.equal(marks(five), 5);
});

test("with fewer than 15 marks Osten refuses and nothing changes", (t) => {
  const player = actor(t, 14);
  complete(player, "Arceuus");
  give(player, HOOD);
  use(player, HOOD);
  const said = pick(player, "That seems reasonable.");
  assert.match(said.join("\n"), /Sorry, you don't appear to have enough Marks of Grace\. I charge 15 for my services\./);
  assert.equal(pending(player), null);
  assert.equal(ids(player).includes(HOOD), true);
  assert.equal(marks(player), 14);
});

test("a coloured piece reverts to plain for free, and the marks stay spent", (t) => {
  const player = actor(t, 15);
  complete(player, "Arceuus");
  give(player, HOOD);
  use(player, HOOD);
  pick(player, "That seems reasonable.");
  pick(player, "Arceuus.");
  assert.equal(marks(player), 0);
  const { said } = use(player, ARCEUUS_HOOD);
  assert.deepEqual(said, ["I can remove that item's colours free of charge. Alternatively I can recolour it to represent a city of Kourend for a fee of 15 Marks of Grace."]);
  assert.match(pick(player, "I'd like to remove the colours.").join("\n"), /You'll have to pay again if you want it recoloured\./);
  pick(player, "Yes, I'm sure.");
  assert.deepEqual(ids(player), [HOOD]);
  assert.equal(marks(player), 0, "no refund");
});

test("a coloured piece can be recoloured to another house, not to its own", (t) => {
  const player = actor(t, 30);
  complete(player, "Arceuus", "Piscarilius");
  give(player, HOOD);
  use(player, HOOD);
  pick(player, "That seems reasonable.");
  pick(player, "Arceuus.");
  use(player, ARCEUUS_HOOD);
  pick(player, "I'd like to represent a different city.");
  assert.deepEqual(options(player), ["Piscarilius.", "Not right now."]);
  pick(player, "Piscarilius.");
  assert.equal(ids(player).includes(PISCARILIUS_HOOD), true);
  assert.equal(marks(player), 0);
});

test("a set of mixed colours still gets the full-set bonus", () => {
  const name = (id) => core.ItemDefinition.forId(id).getName();
  const bonus = Graceful._test.gracefulRestoreBonusFromSlots({
    0: name(ARCEUUS_HOOD), 4: name(13671), 7: name(13597), 9: name(11858), 10: name(13677), 1: name(13581),
  }, false);
  assert.equal(Math.round(bonus * 100), 30);
});
