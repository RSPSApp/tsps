// Run after `yarn build`: node --test tests/fremennik-trials-seer-lock.test.cjs
//
// The Fremennik Trials: Peer the Seer's entrance door (viking_seers_door1, 4165) opens a riddle
// plaque and the seer_combolock (298) letter wheels, as rsprox 1001646 (rev 241, ticks
// 2931-3101) and 1002236 (rev 242, ticks 9896-10024) show. Real Player, session and connection,
// the real plugins, cache and map: clicks are packets, each tick runs as World.process does.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Gamevals } = require("../dist/game/cache/Gamevals");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DOOR = { id: 4165, x: 2631, y: 3667 };
const OUTSIDE = [2631, 3668, 0];
const INSIDE = [2631, 3666, 0];
const LOCK = 298;
const SEER = 4;
const LOCK_TEXT = "There is a combination lock on this door. Above the lock you can see<br>that there is a metal plaque with a riddle on it.";
const RIDDLES = { LIFE: 1, TIME: 2, MIND: 3, TREE: 4, FIRE: 5, WIND: 6 };

let core;
let gamevals;
let next = 7300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOOR.x, DOOR.y);
  PM.emitServerStartup({});
  gamevals = new Gamevals();
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");
const component = (name) => {
  const uid = gamevals.componentId(`seer_combolock:${name}`);
  assert.ok(Number.isInteger(uid) && uid >>> 16 === LOCK, `seer_combolock:${name} is a 298 component`);
  return uid;
};

function actor(t, { riddle = "WIND", seer = 1, items = [] } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("seer" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...OUTSIDE));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, calls: [], messages: [] };
  record(f);
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, 1);
  player.setAttribute("quest.fremennik_trials.trials", seer << (SEER * 3));
  if (riddle) player.setAttribute("quest.fremennik_trials.seer_riddle", RIDDLES[riddle]);
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  // Arriving in Rellekka unlocks its music track; only the door's own messages are checked.
  tick(f);
  f.messages.length = 0;
  return f;
}

const RECORDED = /^(sendInterface|sendInterfaceRemoval|sendString|sendSound|sendClientScript|sendChatboxInterface)$/;
function record(f) {
  const sender = f.player.getPacketSender();
  const proto = Object.getPrototypeOf(sender);
  let depth = 0;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (!RECORDED.test(name) || typeof proto[name] !== "function") continue;
    const original = proto[name];
    sender[name] = function (...args) {
      if (depth === 0) f.calls.push({ tick: f.tick, name, args });
      depth++;
      try { return original.apply(this, args); } finally { depth--; }
    };
  }
  const send = f.player.sendMessage.bind(f.player);
  f.player.sendMessage = (text, ...rest) => {
    f.messages.push(text);
    return send(text, ...rest);
  };
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  f.player.getSession().flushClient(core.World.processCycle);
  f.player.resetUpdating();
}
const ticks = (f, count) => { for (let i = 0; i < count; i++) tick(f); };

function shown(f) {
  const menu = MultiChatboxPrompt.getPending(f.player);
  if (menu) return { who: "menu", title: menu.title, options: menu.options };
  const current = f.player.getDialogueManager().getCurrent?.();
  if (!current || typeof current.getText !== "function") return null;
  return { who: current.constructor.name, text: current.getText() };
}

async function openDoor(f) {
  await f.connection.dispatch([{ type: "object_option", id: DOOR.id, x: DOOR.x, y: DOOR.y, clickType: 1 }]);
  const said = f.messages.length;
  for (let i = 0; i < 10 && !shown(f) && f.messages.length === said && !atTile(f, INSIDE); i++) tick(f);
}

async function continueLine(f) {
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (229 << 16) | 4, childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

async function click(f, name, times = 1) {
  const uid = component(name);
  for (let i = 0; i < times; i++) {
    await f.connection.dispatch([{ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1, simple: true }]);
    tick(f);
  }
}

const atTile = (f, tile) => {
  const at = f.player.getLocation();
  return at.getX() === tile[0] && at.getY() === tile[1] && at.getZ() === tile[2];
};
/** North of the door, in Rellekka (the player stands where the walk to the door ended). */
const outside = (f) => f.player.getLocation().getY() >= DOOR.y && f.player.getLocation().getZ() === 0;
const wheelText = (f, name) => f.calls.filter((call) => call.name === "sendString" && call.args[1] === component(name)).map((call) => call.args[0]);

/** Door, plaque, menu: returns once the menu shows. */
async function toMenu(f) {
  await openDoor(f);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: LOCK_TEXT });
  await continueLine(f);
  assert.deepEqual(shown(f), { who: "menu", title: "What would you like to do?", options: ["Read the riddle", "Solve the riddle", "Forget it"] });
}

/** Turns each wheel from A to the answer's letter with right clicks. */
async function dial(f, word) {
  for (const [index, wheel] of ["seera", "seerb", "seerc", "seerd"].entries()) {
    await click(f, `${wheel}_right`, word.charCodeAt(index) - 65);
  }
}

test("the door shows the plaque and its menu; Forget it leaves the riddle for later", async (t) => {
  const f = actor(t);
  await toMenu(f);
  await choose(f, "Forget it");
  assert.equal(shown(f), null);
  assert.deepEqual(f.messages, ["You leave the riddle for later."]);
  assert.equal(f.player.getInterfaceId(), -1);
  assert.ok(outside(f));
});

test("Read the riddle shows the player's riddle in two boxes, then the lock with every wheel on A", async (t) => {
  const f = actor(t, { riddle: "MIND" });
  await toMenu(f);
  await choose(f, "Read the riddle");
  assert.deepEqual(shown(f), { who: "StatementDialogue",
    text: "My first is in mage, but not in wizard.<br>My second in goblin, and also in lizard.<br>My third is in night, but not in the day.<br>My last is in fields, but not in the hay." });
  await continueLine(f);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "My whole is the most powerful tool you will ever possess.<br>What am I?" });
  await continueLine(f);
  assert.equal(f.player.getInterfaceId(), LOCK);
  for (const wheel of ["seera", "seerb", "seerc", "seerd"]) assert.deepEqual(wheelText(f, wheel), ["A"]);
  assert.ok(f.calls.some((call) => call.name === "sendClientScript" && call.args[0] === 2524 && call.args[1] === -1 && call.args[2] === -1));
});

test("the wheels turn both ways and wrap; a wrong word fails and leaves the player outside", async (t) => {
  const f = actor(t);
  await toMenu(f);
  await choose(f, "Solve the riddle");
  assert.equal(f.player.getInterfaceId(), LOCK);
  // rsprox 1001646 t3063-3067: four lefts from A show Z, Y, X, W.
  await click(f, "seera_left", 4);
  assert.deepEqual(wheelText(f, "seera"), ["A", "Z", "Y", "X", "W"]);
  await click(f, "seerb_right", 2);
  await click(f, "seerb_left");
  assert.deepEqual(wheelText(f, "seerb").slice(1), ["B", "C", "B"]);
  await click(f, "seerenter");
  assert.equal(f.player.getInterfaceId(), -1);
  assert.deepEqual(f.messages, ["You have failed to solve the riddle."]);
  assert.ok(outside(f));
  // Failing keeps the door shut.
  await toMenu(f);
});

test("the right word solves the riddle; the door then lets the player in", async (t) => {
  const f = actor(t);
  await toMenu(f);
  await choose(f, "Solve the riddle");
  await dial(f, "WIND");
  await click(f, "seerenter");
  assert.equal(f.player.getInterfaceId(), -1);
  assert.deepEqual(f.messages, ["You have solved the riddle!"]);
  assert.ok(outside(f), "solving alone does not move the player");
  await openDoor(f);
  assert.ok(atTile(f, INSIDE));
  assert.ok(f.calls.some((call) => call.name === "sendSound" && call.args[0] === 62));
});

test("each riddle's answer is the word its lines spell", async (t) => {
  for (const word of Object.keys(RIDDLES)) {
    const f = actor(t, { riddle: word });
    await toMenu(f);
    await choose(f, "Solve the riddle");
    await dial(f, word);
    await click(f, "seerenter");
    assert.deepEqual(f.messages, ["You have solved the riddle!"], word);
  }
});

test("a player without a riddle gets one rolled and kept", async (t) => {
  const f = actor(t, { riddle: null });
  await toMenu(f);
  await choose(f, "Read the riddle");
  const first = shown(f).text;
  const kept = f.player.getAttribute("quest.fremennik_trials.seer_riddle");
  assert.ok(kept >= 1 && kept <= 6);
  await continueLine(f);
  await continueLine(f);
  await click(f, "seerenter");
  await toMenu(f);
  await choose(f, "Read the riddle");
  assert.equal(shown(f).text, first);
});

test("wheel clicks after the lock is closed do nothing", async (t) => {
  const f = actor(t);
  await toMenu(f);
  await choose(f, "Solve the riddle");
  f.player.getPacketSender().sendInterfaceRemoval();
  tick(f);
  const before = f.calls.length;
  await click(f, "seera_right");
  await click(f, "seerenter");
  assert.equal(f.calls.filter((call, index) => index >= before && call.name === "sendString").length, 0);
  assert.deepEqual(f.messages, []);
});

test("the door stays locked outside the Seer's trial and refuses a carrying player", async (t) => {
  const locked = actor(t, { seer: 0 });
  await openDoor(locked);
  assert.deepEqual(locked.messages, ["This door is locked tightly shut."]);
  const carrying = actor(t, { items: [core.ItemIdentifiers.BRONZE_DAGGER] });
  await openDoor(carrying);
  assert.deepEqual(carrying.messages, ["You must bank all your items and equipment before entering Peer's house."]);
  assert.equal(shown(carrying), null);
});
