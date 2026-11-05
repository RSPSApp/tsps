// Run after `yarn build`: node --test tests/corsair-curse-ferry-native.test.cjs
// The Corsair Curse ferry through production dispatch (#2410): the real canonical ferry NPCs
// corsair_ferry_rimmington (1064, 2910,3226) and corsair_ferry_covedocks (7980, 2574,2835 on the ship)
// are clicked with real npc_option packets. The cache turns them into Captain Tock by quest progress
// (varbit 6071): nothing at 5, Talk-to only at 10, Talk-to and Travel from 15, so the quest plugin
// must add no captain of its own and the player must still be able to reach the cove and come back.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const Runtime = require("../plugins/quests/QuestRuntime");
const core = PluginManager.getCoreApi();

const FERRY_RIMMINGTON = 1064, FERRY_COVE = 7980, CROSSROADS = 7959;
const TOCK_1OP = 7956, TOCK_2OPS = 7958, INVISIBLE = 716;
const RIMMINGTON_LANDING = [2911, 3226, 0], COVE_LANDING = [2578, 2837, 1];
let quest, rimmington, cove, crossroads, nextIndex = 1900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2910, 3226);
  core.RegionManager.loadMapFiles(2574, 2835);
  core.RegionManager.loadMapFiles(3030, 3273);
  require("../plugins/quests/quests/CorsairCurse.Quest")(PluginManager.createApi("CorsairFerryNativeTest"));
  require("../plugins/npcs/NpcDialogues.plugin.js").register(PluginManager.createApi("NpcDialoguesFerryNativeTest"));
  quest = Runtime.getRegisteredQuests().findLast(entry => entry.key === "the_corsair_curse");
  assert.ok(quest, "the real quest registered");
  // The two canonical rows, spawned the way the loader would (data/definitions/npc-spawns.json).
  const rows = require("../data/definitions/npc-spawns.json");
  const spawn = id => {
    const row = rows.find(candidate => candidate.id === id);
    assert.ok(row, `spawn row ${id}`);
    return PluginManager.spawnNpc({ id, x: row.x, y: row.y, z: row.level, wanderRadius: row.wanderRadius ?? 5 });
  };
  rimmington = spawn(FERRY_RIMMINGTON);
  cove = spawn(FERRY_COVE);
  crossroads = spawn(CROSSROADS);
});

function harness(t, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++); player.setUsername(`ferry${nextIndex}`); player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  const connection = new ClientConnection(channel); connection.player = player;
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player); core.TaskManager.cancelTasks(player.getIndex()); });
  const manager = player.getDialogueManager();
  function tick() {
    core.World.processCycle++;
    core.TaskManager.process();
    connection.processTurnPackets();
    player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    for (const npc of core.World.getNpcs()) npc.process();
    core.World.updateLocalNpcs(player, [...core.World.getNpcs()]);
    player.getSession().flushClient(core.World.processCycle);
    player.resetUpdating(); for (const npc of core.World.getNpcs()) npc.resetUpdating();
  }
  async function send(packet) { await connection.dispatch([packet]); tick(); }
  /** Puts the quest at a wire value the way the plugin's own login hook publishes it. */
  function setWire(wire) {
    player.setAttribute("corsair-curse:captain-departed", wire === 10);
    quest.setStage(player, wire === 5 || wire === 10 ? 1 : 2);
    // Every login hook the quest registered, in order: QuestRuntime's own hooks (hold the list, restore the
    // saved varbits) come first and the plugin's progress publisher last, as on a real login.
    const hooks = PluginManager.loginHooks.filter(hook => hook.pluginName === "CorsairFerryNativeTest");
    assert.ok(hooks.length > 0, "the quest registered login hooks");
    for (const hook of hooks) hook.handler({ player, username: player.getUsername() });
    assert.equal(quest.varbitValue(quest.getStage(player), player), wire, `quest is at wire ${wire}`);
    assert.equal(player.getPacketSender().getVarbit(6071), wire, "the progress varbit the ferries read");
  }
  // A parent that transforms to nothing has no current definition at all: nothing to click.
  const actions = npc => [...(npc.getCurrentDefinition(player)?.getActions() ?? [])].filter(Boolean);
  async function option(npc, name) {
    const all = [...npc.getCurrentDefinition(player).getActions()];
    const index = all.indexOf(name);
    assert.ok(index >= 0, `${name} in ${JSON.stringify(all)}`);
    await send({ type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
    for (let i = 0; i < 8; i++) tick();
  }
  /** Every Captain Tock the player could see at either dock, canonical or not. */
  function visibleCaptains() {
    const within = (value, low, high) => value >= low && value <= high;
    return [...core.World.getNpcs()].filter(npc => {
      const id = npc.getContentId(player), x = npc.getLocation().getX(), y = npc.getLocation().getY();
      return (id === TOCK_1OP || id === TOCK_2OPS) && npc.isVisible()
        && ((within(x, 2560, 2600) && within(y, 2820, 2880)) || (within(x, 2900, 2925) && within(y, 3215, 3235)));
    });
  }
  const group = () => player.getPacketSender().getChatboxGroupId();
  const nextLine = () => send({ type: "dialogue_continue", widgetId: (group() << 16) | (group() === 229 ? 4 : 5), childIndex: -1 });
  async function chooseWhenOffered(text) {
    for (let i = 0; i < 60; i++) {
      const pending = MultiChatboxPrompt.getPending(player);
      if (pending) {
        const at = pending.options.indexOf(text);
        assert.ok(at >= 0, `${text} in ${JSON.stringify(pending.options)}`);
        await send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: at + 1 });
        return;
      }
      assert.ok(manager.isActive(), `a conversation is running while waiting for "${text}"`);
      await nextLine();
    }
    assert.fail(`never reached the menu "${text}"`);
  }
  const where = () => [player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()];
  return { player, tick, send, setWire, actions, option, visibleCaptains, chooseWhenOffered, nextLine, where, manager };
}

test("at wire 5 the Rimmington ferry shows nothing and the plugin adds no captain", async (t) => {
  const h = harness(t, [2912, 3226, 0]);
  h.setWire(5);
  assert.equal(rimmington.getContentId(h.player), INVISIBLE);
  assert.deepEqual(h.actions(rimmington), [], "the invisible ferry offers no option");
  assert.equal(h.visibleCaptains().length, 0, "no captain waits at Rimmington before Tock has left the crossroads");
});

test("at wire 10 Tock at Rimmington only talks, asks, and sails on Okay", async (t) => {
  const h = harness(t, [2912, 3226, 0]);
  h.setWire(10);
  assert.equal(rimmington.getContentId(h.player), TOCK_1OP);
  assert.deepEqual(h.actions(rimmington), ["Talk-to"], "no Travel until the ship has been boarded");
  assert.equal(cove.getContentId(h.player), INVISIBLE, "nobody stands on the cove ship yet");
  assert.deepEqual(h.visibleCaptains().map(npc => npc.getIndex()), [rimmington.getIndex()], "only the canonical captain is there");

  await h.option(rimmington, "Talk-to");
  await h.chooseWhenOffered("Okay, I'm ready go to Corsair Cove.");
  for (let i = 0; i < 20; i++) {
    if (h.manager.isActive()) await h.nextLine();
    else h.tick();
  }
  assert.equal(quest.varbitValue(quest.getStage(h.player), h.player), 15, "the ship has sailed");
  assert.deepEqual(h.where(), COVE_LANDING, "the player lands at the cove");
});

test("at wire 15 both docks offer Talk-to and Travel and ferry the player there and back", async (t) => {
  const h = harness(t, [2912, 3226, 0]);
  h.setWire(15);
  for (const [label, npc] of [["Rimmington", rimmington], ["the cove", cove]]) {
    assert.equal(npc.getContentId(h.player), TOCK_2OPS, `${label} shows Captain Tock`);
    assert.deepEqual(h.actions(npc), ["Talk-to", "Travel"], `${label} offers Talk-to and Travel`);
  }
  assert.deepEqual(h.visibleCaptains().map(npc => npc.getIndex()).sort(), [rimmington.getIndex(), cove.getIndex()].sort(), "exactly one captain at each dock");

  await h.option(rimmington, "Travel");
  assert.deepEqual(h.where(), COVE_LANDING, "Travel from Rimmington reaches the cove");
  await h.option(cove, "Talk-to");
  assert.ok(h.manager.isActive(), "Talk-to on the cove ferry is reachable from the landing and opens a conversation");
  h.manager.reset();
  await h.option(cove, "Travel");
  assert.deepEqual(h.where(), RIMMINGTON_LANDING, "Travel from the cove returns to Rimmington");
});

test("at wire 5 Tock at the crossroads still leads to wire 10, the only way on", async (t) => {
  const h = harness(t, [3029, 3273, 0]);
  h.setWire(5);
  assert.equal(crossroads.getContentId(h.player), TOCK_1OP, "the crossroads shows Captain Tock until he has left");
  assert.deepEqual(h.actions(crossroads), ["Talk-to"]);
  assert.equal(rimmington.getContentId(h.player), INVISIBLE, "Rimmington still shows nobody");

  await h.option(crossroads, "Talk-to");
  const wanted = ["What kind of help do you need?", "Yes."];
  for (let i = 0; i < 120 && quest.varbitValue(quest.getStage(h.player), h.player) !== 10; i++) {
    const pending = MultiChatboxPrompt.getPending(h.player);
    if (pending) {
      const text = wanted.find(option => pending.options.includes(option));
      assert.ok(text, `a known answer in ${JSON.stringify(pending.options)}`);
      await h.send({ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: pending.options.indexOf(text) + 1 });
    } else if (h.manager.isActive()) await h.nextLine();
    else h.tick();
  }
  assert.equal(quest.varbitValue(quest.getStage(h.player), h.player), 10, "Tock swaggers off towards Rimmington");
  // Parent 7959 transforms to -1 (no NPC) past wire 5, so it keeps its own id but offers nothing to click.
  assert.deepEqual(h.actions(crossroads), [], "and the crossroads is empty: nothing left to talk to");
  assert.equal(rimmington.getContentId(h.player), TOCK_1OP, "the captain now waits at Rimmington to be asked");
});
