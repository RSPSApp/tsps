// Native cache-backed inventory and dialogue paths for #2918 and #2920.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
let core, quest, nextIndex = 6900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2635, 2966);
  PM.emitServerStartup({});
  quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests()
    .find(q => q.key === "big_chompy_bird_hunting");
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage = 25, amount = 1) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername("baitqa" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2635, 2966, 0));
  player.needsPlacement = false;
  for (let i = 0; i < amount; i++) player.getInventory().add(new core.Item(core.ItemIdentifiers.BLOATED_TOAD), false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  const hints = [];
  const sender = player.getPacketSender();
  for (const name of ["sendPositionalHint", "clearHintArrow"]) {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => { hints.push([name, ...args]); return original(...args); });
  }
  quest.setStage(player, stage);
  hints.length = 0;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === player) core.World.getNpcs().remove(npc);
  });
  return { player, connection, hints };
}

async function send(f, packet) {
  await f.connection.dispatch([packet]);
  f.connection.processTurnPackets();
}

async function inventory(f, option, slot = 0) {
  const itemId = core.ItemIdentifiers.BLOATED_TOAD;
  const buttonNum = [1, 2, 3, 4, 6, 7].find(op =>
    ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op)?.option === option);
  assert.ok(buttonNum, "active cache has " + option);
  await send(f, { type: "widget_action", widgetId: 149 << 16, groupId: 149,
    childId: 0, buttonNum, slot, itemId });
}

const birds = f => [...core.World.getNpcs()].filter(npc =>
  npc?.getOwner?.() === f.player && npc.getId() === core.NpcIdentifiers.CHOMPY_BIRD);

test("native Drop places quest bait instead of opening Destroy", async t => {
  const f = actor(t);
  await inventory(f, "Drop");
  assert.equal(quest.getStage(f.player), 30);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 0);
  assert.equal(f.player.getAttribute("destroy-item:pending"), undefined);
  assert.equal(birds(f).length, 0, "placing bait must not guarantee an instant bird");
  assert.equal([...core.World.getNpcs()].filter(npc => npc?.getOwner?.() === f.player
    && npc.getId() === core.NpcIdentifiers.BLOATED_TOAD).length, 1, "bait is a real placed toad");
});

test("Rantz's real dialogue sends the bait hint and Drop clears it", async t => {
  const f = actor(t, 20);
  const runtime = require("../plugins/quests/QuestRuntime");
  assert.equal(runtime.startTranscript({ core, emitCustomEvent: PM.emitCustomEvent.bind(PM) },
    f.player, core.NpcIdentifiers.RANTZ, "Big Chompy Bird Hunting", "returning-to-rantz-with-the-bloated-toad"), true);
  for (let i = 0; f.player.getDialogueManager().getCurrent() && i < 20; i++) {
    const sender = f.player.getPacketSender();
    const widgetId = [231, 217, 229, 193].map(group => group << 16)
      .find(uid => sender.isChatboxInterface(uid >>> 16));
    assert.notEqual(widgetId, undefined, "a real chatbox must be mounted for Continue");
    await send(f, { type: "dialogue_continue", widgetId, childIndex: -1 });
  }
  assert.equal(quest.getStage(f.player), 25);
  assert.match(quest.buildJournal(f.player, quest).join(" "), /^Drop a /);
  const hint = f.hints.find(([name]) => name === "sendPositionalHint");
  assert.ok(hint, "the actual transcript must produce a native hint packet");
  assert.deepEqual([hint[1].getX(), hint[1].getY()], [2635, 2966]);
  await inventory(f, "Drop");
  assert.ok(f.hints.some(([name]) => name === "clearHintArrow"));
});

test("Release and Release All free toads without starting a hunt", async t => {
  const f = actor(t, 25, 3);
  await inventory(f, "Release");
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 2);
  assert.equal(quest.getStage(f.player), 25);
  assert.equal(birds(f).length, 0);
  await inventory(f, "Release All", 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 0);
  assert.equal(quest.getStage(f.player), 25);
  assert.equal(birds(f).length, 0);
});

test("Drop refusals keep the item and post-bow Drop still attracts a huntable chompy", async t => {
  for (const stage of [20, 40]) {
    const f = actor(t, stage);
    await inventory(f, "Drop");
    assert.equal(quest.getStage(f.player), stage);
    assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 1);
    assert.equal(f.player.getAttribute("destroy-item:pending"), undefined);
    assert.equal(birds(f).length, 0);
  }
  const f = actor(t, 45);
  await inventory(f, "Drop");
  assert.equal(quest.getStage(f.player), 45);
  assert.equal(birds(f).length, 0);
  t.mock.method(Math, "random", () => 0);
  for (let i = 0; i < 25; i++) core.TaskManager.process();
  assert.equal(birds(f).length, 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 0);
  await inventory(f, "Drop");
  assert.equal(birds(f).length, 1, "a repeated click on the now-empty slot has no effect");
});

test("Release works before the placement instructions and preserves other slots", async t => {
  const f = actor(t, 20, 2);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.OGRE_BELLOWS), false);
  await inventory(f, "Release All");
  assert.equal(quest.getStage(f.player), 20);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 0);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.OGRE_BELLOWS), 1);
  assert.equal(birds(f).length, 0);
});

test("saved placement progress restores the hint on login and repeats the placement dialogue", t => {
  const f = actor(t);
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const saved = PlayerSave.fromPlayer(f.player);
  const restored = actor(t, 0, 0);
  saved.applyToPlayer(restored.player);
  PM.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername() });
  PM.emitCustomEvent("player:bootstrap-complete", { player: restored.player });
  assert.equal(quest.getStage(restored.player), 25);
  assert.equal(restored.hints.at(-1)?.[0], "sendPositionalHint",
    "the hint must survive later login hooks, including Temple of the Eye's arrow reset");
  const variant = PM.emitNpcDialogueVariant({ player: restored.player, npcId: core.NpcIdentifiers.RANTZ });
  assert.equal(variant.variant, "returning-to-rantz-with-the-bloated-toad-talking-to-rantz-again");
  restored.hints.length = 0;
  quest.setStage(restored.player, 40);
  assert.deepEqual(restored.hints, [["clearHintArrow"]]);
  quest.setStage(restored.player, 45);
  assert.equal(restored.hints.length, 1, "later stages do not clear another system's arrow again");
});

test("native repeated Drop preserves the second toad and failed bait restores the quest hint", async t => {
  const f = actor(t, 25, 2);
  await inventory(f, "Drop");
  await inventory(f, "Drop", 1);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BLOATED_TOAD), 1);
  t.mock.method(Math, "random", () => 0.2);
  for (let i = 0; i < 100; i++) core.TaskManager.process();
  assert.equal(birds(f).length, 0);
  assert.equal(quest.getStage(f.player), 25);
  assert.equal(f.hints.at(-1)?.[0], "sendPositionalHint");
});

test("login recovers interrupted waiting and demonstration stages to placement", t => {
  for (const stage of [30, 35]) {
    const f = actor(t, stage, 0);
    PM.emitPlayerLogin({ player: f.player, username: f.player.getUsername() });
    PM.emitCustomEvent("player:bootstrap-complete", { player: f.player });
    assert.equal(quest.getStage(f.player), 25);
    assert.equal(f.hints.at(-1)?.[0], "sendPositionalHint");
  }
});
