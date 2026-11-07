const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");

const ALI_OPTION = "What do you know about Ali Morrisane?";
const ORDINARY_OPTION = "No thanks; I've got all the Crafting equipment I need.";
const COMPLETE = { blackjacks: 3, clothes: 3, runes: 2 };
let core, nextIndex = 1650, hunterStarted = false;
const oldBots = process.env.DISABLE_PLAYER_BOTS;
const oldError = console.error, errors = [];
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(" ")); oldError.apply(console, args); };
  process.env.DISABLE_PLAYER_BOTS = "1";
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(path.join(root, "plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  for (const hook of PM.serverStartupHooks) {
    if (!["Hunter", "WarpedSceptre"].includes(hook.pluginName)) continue;
    if (hook.pluginName === "Hunter") hunterStarted = true;
    hook.handler({});
  }
  assert.ok(QuestRuntime.questNamed("Prince Ali Rescue"));
});
after(() => {
  try {
    if (hunterStarted) for (const hook of PM.serverShutdownHooks) if (hook.pluginName === "Hunter") hook.handler({});
    assert.deepEqual(errors, [], "no caught plugin or engine errors");
  } finally {
    console.error = oldError;
    if (oldBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = oldBots;
  }
});

function actor(t, errands = COMPLETE, princeComplete = true) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  let npc, registered = false;
  t.after(() => {
    try {
      player.closeInterruptibleInterfaces();
      if (registered) { npc.setRegistered(false); core.World.getNpcs().remove(npc); }
      core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(player);
      core.TaskManager.cancelTasks(player);
      if (player.getIndex() >= 0) core.TaskManager.cancelTasks(player.getIndex());
      player.getMovementQueue().reset();
    } finally { player.setRegistered(false); }
  });
  player.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  player.setIndex(nextIndex++);
  player.setUsername("rogueshop" + player.getIndex());
  player.setRegistered(true);
  // The existing Rogue Trader producers require these quests for the captured errand states.
  for (const name of ["The Feud", "Rune Mysteries", "Icthlarin's Little Helper"]) {
    const prerequisite = QuestRuntime.questNamed(name);
    assert.ok(prerequisite, `${name} is registered`);
    prerequisite.setStage(player, prerequisite.completionValue);
    assert.equal(prerequisite.isComplete(player), true, `${name} is complete`);
  }
  player.setAttribute("rogue-trader:state", { ...errands });
  const quest = QuestRuntime.questNamed("Prince Ali Rescue");
  assert.equal(quest.isComplete(player), false, "fresh player has not completed Prince Ali Rescue");
  if (princeComplete) quest.setStage(player, quest.completionValue);
  assert.equal(quest.isComplete(player), princeComplete, "the real quest producer supplies the prerequisite");
  const spawn = require("../data/definitions/npc-spawns.json").find(row => row.id === core.NpcIdentifiers.DOMMIK);
  assert.ok(spawn, "Dommik has an authored spawn");
  const z = spawn.level ?? 0;
  core.RegionManager.loadMapFiles(spawn.x, spawn.y);
  const adjacent = [[0, 1], [1, 0], [0, -1], [-1, 0]].find(([dx, dy]) =>
    core.RegionManager.canMove(spawn.x, spawn.y, spawn.x + dx, spawn.y + dy, z, 1, 1, null)
    && core.RegionManager.canMove(spawn.x + dx, spawn.y + dy, spawn.x, spawn.y, z, 1, 1, null));
  assert.ok(adjacent, "Dommik's spawn has a collision-accessible adjacent tile");
  player.setLocation(new core.Location(spawn.x + adjacent[0], spawn.y + adjacent[1], z));
  player.needsPlacement = false;
  npc = core.NPC.create(core.NpcIdentifiers.DOMMIK, new core.Location(spawn.x, spawn.y, z));
  npc.setScriptedMovement(true);
  registered = core.World.getNpcs().add(npc);
  assert.equal(registered, true, "Dommik is in the world's NPC collection");
  npc.setRegistered(true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  return { player, npc, connection };
}
async function send(f, packet) {
  await f.connection.dispatch([packet]);
  // The relevant World/Player phases: tasks precede input, movement precedes reach checks.
  for (let i = 0; i < 4; i++) {
    f.player.resetUpdating();
    core.TaskManager.process();
    f.connection.processTurnPackets();
    const movement = f.player.getMovementQueue();
    movement.beginCycle();
    movement.processEntityPursuit();
    if (movement.hasPendingWork()) movement.process();
    core.TaskManager.processWalkTo(f.player.getIndex());
  }
}
async function talk(f) {
  const definition = f.npc.getCurrentDefinition(f.player);
  assert.equal(definition.getName(), "Dommik");
  const clickType = definition.getActions().indexOf("Talk-to") + 1;
  assert.ok(clickType > 0, "the active cache offers Talk-to");
  await send(f, { type: "npc_option", index: f.npc.getIndex(), clickType });
}
async function menu(f) {
  for (let i = 0; i < 30; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.player);
    if (pending) return pending;
    assert.ok(f.player.getDialogueManager().getCurrent(), "Dommik's dialogue reaches a real choice");
    const group = f.player.getPacketSender().getChatboxGroupId();
    await send(f, { type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
  }
  assert.fail("Dommik's dialogue did not reach its menu");
}
for (const [label, errands, prince] of [
  ["blackjacks incomplete", { ...COMPLETE, blackjacks: 2 }, true],
  ["clothes incomplete", { ...COMPLETE, clothes: 2 }, true],
  ["runes incomplete", { ...COMPLETE, runes: 1 }, true],
  ["Prince Ali Rescue incomplete", COMPLETE, false],
]) {
  test(`Dommik hides the post-errand option when ${label}`, async (t) => {
    const f = actor(t, errands, prince);
    await talk(f);
    const choice = await menu(f);
    assert.ok(choice.options.includes(ORDINARY_OPTION), "ordinary dialogue is a working control");
    assert.ok(!choice.options.includes(ALI_OPTION), "post-errand option is hidden");
  });
}
test("a fully qualified player can select Dommik's post-errand dialogue", async (t) => {
  const f = actor(t);
  await talk(f);
  const choice = await menu(f);
  assert.ok(choice.options.includes(ORDINARY_OPTION));
  const selected = choice.options.indexOf(ALI_OPTION);
  assert.ok(selected >= 0, "eligible option appears in the native menu");
  await send(f, { type: "dialogue_continue", widgetId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: selected + 1 });
  const lines = [];
  for (let i = 0; i < 12; i++) {
    const current = f.player.getDialogueManager().getCurrent();
    assert.ok(current, "selected branch owns an active dialogue");
    lines.push(String(current.getText?.() ?? ""));
    if (lines.join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes("one of his thugs has threatened")) break;
    const group = f.player.getPacketSender().getChatboxGroupId();
    await send(f, { type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 });
  }
  assert.ok(lines.join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes("one of his thugs has threatened"), "decoded choice reaches Dommik's generated response");
});
test("the other shopkeepers' exact conditions use the same prerequisites, with unrelated conditions untouched", (t) => {
  const f = actor(t, COMPLETE, false);
  const query = (npcId, text) => PM.emitNpcDialogueCondition({ player: f.player, npcId, text, pages: [] });
  const shopkeepers = [[2879, "After Rogue Trader:"], [3231, "With Rogue Trader completed?"],
    [2818, "After Rogue Trader:"], [2817, "After Rogue Trader:"],
    [2877, "After Rogue Trader"], [2875, "After Rogue Trader"]];
  for (const [id, text] of shopkeepers) assert.equal(query(id, text), false, `incomplete quest for NPC ${id}`);
  assert.equal(query(2547, "After Rogue Trader:"), null, "another NPC is not claimed");
  assert.equal(query(2879, "Unrelated condition:"), null, "other Dommik conditions are not claimed");
  assert.equal(query(3533, "If the player has asked Captain Dalbur what he thinks of Ali Morrisane:"), false);
  assert.equal(query(2547, "Captain Dalbur:"), null, "Gianne's delivery condition remains unclaimed");
  QuestRuntime.questNamed("Prince Ali Rescue").setStage(f.player, QuestRuntime.questNamed("Prince Ali Rescue").completionValue);
  for (const [id, text] of shopkeepers) assert.equal(query(id, text), true, `qualified NPC ${id}`);
});
