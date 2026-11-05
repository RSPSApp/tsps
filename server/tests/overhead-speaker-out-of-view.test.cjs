// Run after `yarn build`: node --test tests/overhead-speaker-out-of-view.test.cjs
//
// A transcript's overhead line needs its speaker in the player's view, and NPCs show within 15 tiles. Each quest here
// plays one from where the player really stands, its speaker at the real spawn or nowhere, with later steps the quest
// can't go on without. Real walks, clicks and dialogue; the world's own view of local NPCs each tick. Bots off. No
// client ran.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const SPAWNS = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));

let core;
let next = 7560;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);

function actor(t, x, y, z = 0) {
  core.RegionManager.loadMapFiles(x, y);
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("overheadqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const npcs = [];
  t.after(() => {
    npcs.forEach((npc) => core.World.getNpcs().remove(npc));
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, messages, npcs };
}

function spawn(f, id, x, y, z = 0) {
  core.RegionManager.loadMapFiles(x, y);
  const npc = core.NPC.create(id, new core.Location(x, y, z));
  core.World.getNpcs().add(npc);
  f.npcs.push(npc);
  return npc;
}

/** Every NPC the spawn list gives this name, at its real tile. */
function spawnAll(f, name) {
  const rows = SPAWNS.filter((row) => row.name === name);
  assert.ok(rows.length > 0, `${name} has spawns`);
  return rows.map((row) => spawn(f, row.id, row.x, row.y, row.level ?? 0));
}

/** One world tick for this player: the world's own view of who is local, then the queues, then the tick's end. */
function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    core.World.updateLocalNpcs(f.p, f.npcs);
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
    f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

/** Takes the real packet, then plays what it opens to the end with real continues. */
async function play(f, packet, choices = []) {
  tick(f);
  await send(f, packet);
  const manager = f.p.getDialogueManager();
  let idle = 0;
  for (let i = 0; i < 250; i++) {
    const pending = core.MultiChatboxPrompt.getPending(f.p);
    const current = manager.getCurrent();
    const options = pending ? pending.options : current instanceof core.OptionDialogue ? current.getOptions() : null;
    if (options) {
      let index = -1;
      for (const wanted of choices) {
        index = options.findIndex((option) => wanted.test(option));
        if (index >= 0) break;
      }
      await send(f, { type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex: Math.max(index, 0) + 1 });
      tick(f);
      idle = 0;
    } else if (current && !current.constructor.name.includes("Action")) {
      const group = f.p.getPacketSender().getChatboxGroupId();
      await send(f, { type: "dialogue_continue", widgetId: (group << 16) | ([231, 217].includes(group) ? 5 : 0), childIndex: -1 });
      tick(f);
      idle = 0;
    } else {
      if (++idle > 60) return;
      tick(f);
    }
  }
}

const SANDY_PROBLEM = /sandy problem/;
const BELL = { type: "object_option", id: 6847, x: 2598, y: 3085, clickType: 1 };

function atTheBell(t) {
  const I = core.ItemIdentifiers;
  const f = actor(t, 2593, 3081);
  core.RegionManager.loadMapFiles(2598, 3085);
  quest("hand_in_the_sand").setStage(f.p, 130);
  f.p.getInventory().setItem(0, new core.Item(I.EARTH_RUNE, 5));
  f.p.getInventory().setItem(1, new core.Item(I.BUCKET_OF_SAND, 1));
  return { f, I, bert: spawnAll(f, "Bert").find((npc) => npc.getId() === 5382) };
}

function assertSandpitDone(f, I) {
  assert.equal(quest("hand_in_the_sand").getStage(f.p), 140, `the spell finishes: ${f.messages}`);
  assert.equal(f.p.getInventory().getAmount(I.EARTH_RUNE), 0, "the runes are spent");
  assert.equal(f.p.getInventory().getAmount(I.BUCKET_OF_SAND), 0, "the bucket is spent");
  assert.ok(f.messages.includes("Something very strange happens to the Sandpit, it looks like it has filled itself up!"), f.messages.join(" | "));
}

test("The Hand in the Sand: the bell's sandpit spell finishes though Bert is 48 tiles off", async (t) => {
  const { f, I, bert } = atTheBell(t);
  const chats = [];
  t.mock.method(bert, "forceChat", (text) => { chats.push(text); });
  await play(f, BELL, [SANDY_PROBLEM]);
  assert.equal(f.p.getLocalNpcs().includes(bert), false, "the world doesn't show Bert from the bell");
  assertSandpitDone(f, I);
  assert.deepEqual(chats, [], "nothing is said over a Bert nobody can see");
  assert.ok(f.messages.includes("Bert: My sand! My lovely sand!"), `his line reaches the chat, marked as his: ${f.messages}`);
});

test("control: with Bert local, the same bell has him say it overhead and not in the chat", async (t) => {
  const { f, I, bert } = atTheBell(t);
  const chats = [];
  t.mock.method(bert, "forceChat", (text) => { chats.push(text); });
  t.mock.method(core.World, "updateLocalNpcs", (player) => {
    if (!player.getLocalNpcs().includes(bert)) player.getLocalNpcs().push(bert);
  });
  await play(f, BELL, [SANDY_PROBLEM]);
  assertSandpitDone(f, I);
  assert.deepEqual(chats, ["My sand! My lovely sand!"]);
  assert.equal(f.messages.includes("Bert: My sand! My lovely sand!"), false);
});

test("Forgettable Tale: the pub's final cutscene completes the quest though Gunslik and Nolar are out of view", async (t) => {
  const I = core.ItemIdentifiers;
  const key = "forgettable_tale";
  const entry = quest(key);
  assert.ok(entry, "the quest is registered");
  // Inside the file's EAST_PUB bounds, on the first open tile.
  let at = null;
  for (let x = 2918; x <= 2932 && !at; x++) {
    for (let y = 10192; y <= 10200 && !at; y++) {
      core.RegionManager.loadMapFiles(x, y);
      if (!core.RegionManager.blocked(new core.Location(x, y, 0), null)) at = [x, y];
    }
  }
  assert.ok(at, "the pub has an open tile");
  const f = actor(t, at[0], at[1]);
  entry.setStage(f.p, 17);
  f.p.getInventory().setItem(0, new core.Item(I.BEER, 1));
  const gunslik = spawnAll(f, "Gunslik");
  spawnAll(f, "Nolar");
  spawnAll(f, "Factory Worker");
  t.diagnostic(`player ${at}, Gunslik ${gunslik[0].getLocation().getX()},${gunslik[0].getLocation().getY()}`);
  await play(f, { type: "inventory_action", slot: 0, itemId: I.BEER, widgetId: 149 << 16, option: "Drink" });
  assert.equal(f.p.getLocalNpcs().includes(gunslik[0]), false, "the world doesn't show Gunslik from the pub");
  assert.equal(entry.getStage(f.p) >= entry.completionValue, true, `the quest completes, at stage ${entry.getStage(f.p)}: ${f.messages}`);
});

test("A Tail of Two Cats: Bob's cutscene brings the player back though R4ng3rNo0b889 is nowhere", async (t) => {
  const key = "a_tail_of_two_cats";
  const entry = quest(key) ?? QuestRuntime.getRegisteredQuests().find((candidate) => /tail/i.test(candidate.key));
  assert.ok(entry, "the quest is registered");
  const f = actor(t, 2922, 3565);
  entry.setStage(f.p, 50);
  const bob = spawn(f, 4113, 2924, 3565);
  const actions = bob.getCurrentDefinition(f.p).getActions();
  t.diagnostic(`4113 shows ${bob.getCurrentDefinition(f.p).getId()}, offers ${JSON.stringify(actions)}`);
  await play(f, { type: "npc_option", index: bob.getIndex(), clickType: actions.indexOf("Talk-to") + 1 });
  assert.ok(entry.getStage(f.p) >= 60, `the cutscene ends and the quest moves on, at stage ${entry.getStage(f.p)}: ${f.messages}`);
});
