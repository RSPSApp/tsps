// Run after `yarn build`: node --test tests/fremennik-trials-seer-house.test.cjs
//
// The Fremennik Trials: Peer the Seer's trial past the entrance lock: Peer's offer and bank spell,
// the walk-through doors, the ladders and trapdoors, the cupboard/chest that open for one player,
// the heads, mural, water puzzle, scales, vase and key, the exit with the key, and leaving the house
// any other way. As rsprox 1002236 (rev 242, t9725-10290) and 1001646 (rev 241, t2880-3460) show.
// Real Player, session and connection, the real plugins, cache and map: clicks are packets, each
// tick runs as World.process does.
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
const { AreaManager } = require("../dist/game/model/areas/AreaManager");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const SEER = 4;
const MERCHANT = 2;
const TRIALS = "quest.fremennik_trials.trials";
const FLAGS = "quest.fremennik_trials.flags";
const CHAIN = "quest.fremennik_trials.merchant_chain";
const FLAG_RIDDLE = 9;
const FLAG_OLD_DISK = 10;
const FLAG_RED_DISK = 11;
const PEER = 3895;
const LOC = {
  ENTRANCE: { id: 4165, x: 2631, y: 3667 },
  EXIT: { id: 4166, x: 2636, y: 3667 },
  WEST_LADDER: { id: 4163, x: 2631, y: 3663 },
  EAST_LADDER: { id: 4164, x: 2636, y: 3663 },
  CUPBOARD: { id: 4177, x: 2629, y: 3660 },
  CUPBOARD_OPEN: { id: 4178, x: 2629, y: 3660 },
  CHEST: { id: 4167, x: 2635, y: 3660 },
  CHEST_OPEN: { id: 4168, x: 2635, y: 3660 },
  TRAPDOOR: { id: 4174, x: 2636, y: 3663 },
  TRAPDOOR_OPEN: { id: 4173, x: 2636, y: 3663 },
  TAP: { id: 4176, x: 2629, y: 3661 },
  DRAIN: { id: 4175, x: 2629, y: 3662 },
  RANGE: { id: 4172, x: 2629, y: 3663 },
  UNICORN: { id: 4181, x: 2632, y: 3660 },
  BULL: { id: 4182, x: 2634, y: 3660 },
  BOOKCASE: { id: 4171, x: 2635, y: 3665 },
  SCALES: { id: 4170, x: 2632, y: 3665 },
  FROZEN_TABLE: { id: 4169, x: 2638, y: 3665 },
  MURAL: { id: 4179, x: 2634, y: 3663 },
  SW_BOXES: { id: 4183, x: 2633, y: 3660 },
  MAGNET_BOXES: { id: 4183, x: 2636, y: 3660 },
  SWENSEN_BOXES: { id: 3685, x: 2647, y: 3662 },
};
const INVISWALL = 38848;
const DOOR_INACTIVE = 4249;
const PASSED = "You have successfully completed the Seer's Trial.";

let core;
let I;
let next = 8300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(LOC.ENTRANCE.x, LOC.ENTRANCE.y);
  core.RegionManager.loadMapFiles(LOC.SWENSEN_BOXES.x, LOC.SWENSEN_BOXES.y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === "fremennik_trials");

function actor(t, { at = [2631, 3664, 0], seer = 1, stage = 1, items = [], flags = 0, riddle = 6 } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  player.setUsername("seerh" + next++);
  player.setLongUsername(core.Misc.stringToLongBigInt(player.getUsername()));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  const connection = new ClientConnection(channel);
  connection.player = player;
  connection.sendPlayerBootstrap();
  const f = { player, connection, tick: 0, calls: [], messages: [], anims: [] };
  record(f);
  t.after(() => {
    core.World.getPlayers().remove(player);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    core.TaskManager.cancelTasks(player.getIndex());
    core.TaskManager.cancelTasks(player);
  });
  quest().setStage(player, stage);
  // The Merchant's trial is done, so Sigmund's chain never answers for Peer here.
  player.setAttribute(TRIALS, (seer << (SEER * 3)) | (2 << (MERCHANT * 3)));
  player.setAttribute(CHAIN, -1);
  player.setAttribute(FLAGS, flags);
  player.setAttribute("quest.fremennik_trials.seer_riddle", riddle);
  for (const id of items) player.getInventory().add(new core.Item(id, 1), false);
  tick(f);
  f.messages.length = 0;
  f.calls.length = 0;
  f.anims.length = 0;
  return f;
}

const RECORDED = /^(sendObject|sendObjectRemoval|sendSound|sendInterface|sendConfig|sendItemOnInterfaces)$/;
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
  f.player.sendMessage = (text, ...rest) => { f.messages.push(text); return send(text, ...rest); };
  const animate = f.player.performAnimation.bind(f.player);
  f.player.performAnimation = (animation, ...rest) => { f.anims.push({ tick: f.tick, id: animation.getId() }); return animate(animation, ...rest); };
}

function tick(f) {
  f.tick++;
  core.World.processCycle++;
  core.TaskManager.process();
  f.connection.processTurnPackets();
  AreaManager.process(f.player);
  core.TaskManager.processWalkTo(f.player.getIndex());
  f.player.getMovementQueue().process();
  PM.emitPlayerProcess({ player: f.player });
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

async function continueLine(f) {
  const group = f.player.getPacketSender().getChatboxGroupId();
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }]);
  tick(f);
}

async function choose(f, text) {
  const options = MultiChatboxPrompt.getPending(f.player).options;
  const index = options.indexOf(text);
  assert.ok(index >= 0, `"${text}" in ${JSON.stringify(options)}`);
  await f.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: index + 1 }]);
  tick(f);
}

/** Clicks a loc's option and runs ticks until something answers (or `wait` ticks pass). */
async function click(f, loc, clickType = 1, wait = 1) {
  await f.connection.dispatch([{ type: "object_option", id: loc.id, x: loc.x, y: loc.y, clickType }]);
  ticks(f, wait);
}

const slotOf = (f, id) => f.player.getInventory().getSlotForItemId(id);
/** Uses an item on a loc and runs ticks (walking there included) until it answers. */
async function use(f, itemId, loc) {
  const said = f.messages.length;
  const before = JSON.stringify(inv(f));
  await f.connection.dispatch([{ type: "item_on_object", objectId: loc.id, x: loc.x, y: loc.y, itemId, slot: slotOf(f, itemId), widgetId: core.Inventory.INTERFACE_ID }]);
  for (let i = 0; i < 8 && f.messages.length === said && JSON.stringify(inv(f)) === before && !shown(f); i++) tick(f);
}
async function combine(f, a, b) {
  await f.connection.dispatch([{ type: "inventory_use_on", itemId: a, slot: slotOf(f, a), target: { kind: "inventory", slot: slotOf(f, b) } }]);
  tick(f);
}
async function itemOption(f, itemId, option) {
  await f.connection.dispatch([{ type: "inventory_action", slot: slotOf(f, itemId), itemId, widgetId: 3214, option }]);
  tick(f);
}

const tileIs = (f, x, y, z) => {
  const at = f.player.getLocation();
  return at.getX() === x && at.getY() === y && at.getZ() === z;
};
const where = (f) => f.player.getLocation().toString();
const has = (f, id) => f.player.getInventory().getAmount(id) > 0;
const inv = (f) => f.player.getInventory().getValidItems().map((item) => item.getId());
const trial = (f) => (Number(f.player.getAttribute(TRIALS)) >>> (SEER * 3)) & 7;
const flagSet = (f, bit) => ((Number(f.player.getAttribute(FLAGS)) >>> bit) & 1) === 1;
const objectsSent = (f, name) => f.calls.filter((call) => call.name === name)
  .map((call) => ({ tick: call.tick, id: call.args[0].getId(), x: call.args[0].getLocation().getX(), y: call.args[0].getLocation().getY(), z: call.args[0].getLocation().getZ(), type: call.args[0].getType(), face: call.args[0].getFace() }));
const sounds = (f) => f.calls.filter((call) => call.name === "sendSound").map((call) => call.args[0]);
/** The loc a player would now click at `loc`'s tile (their own swapped one first). */
const locFor = (f, id, loc, z = 2) => core.MapObjects.getPrivateArea(f.player, id, new core.Location(loc.x, loc.y, z));

// ---- Peer ----------------------------------------------------------------------------------------

test("Peer's offer: Yes starts the trial and his spell banks everything carried", async (t) => {
  const f = actor(t, { at: [2634, 3669, 0], seer: 0, items: [I.BRONZE_DAGGER, I.LOBSTER] });
  core.World.processCycle++;
  // The Merchant's trial passed: Talk-to opens straight on his offer (rsprox 1002313 t6907).
  PM.emitCustomEvent("npc-dialogue:start", { player: f.player, npcId: PEER });
  tick(f);
  const lines = [];
  for (let i = 0; i < 60; i++) {
    const now = shown(f);
    if (!now) break;
    if (now.who === "menu") {
      lines.push(now.options.join("|"));
      await choose(f, "Yes");
      continue;
    }
    lines.push(now.text);
    await continueLine(f);
  }
  assert.equal(lines[0], "Hello outerlander. What do you want?");
  assert.equal(lines.filter((line) => line === "Yes|No").length, 2);
  assert.match(lines.at(-1), /^The task is done\. I wish you luck with your test,/);
  assert.equal(trial(f), 1);
  assert.deepEqual(inv(f), [], "the spell banked the inventory");
  const banked = (id) => f.player.getBanks().some((bank) => bank?.getAmount(id) > 0);
  assert.ok(banked(I.BRONZE_DAGGER) && banked(I.LOBSTER));
});

test("Peer's again and done variants follow the trial", async (t) => {
  const again = actor(t, { at: [2634, 3669, 0], seer: 1 });
  core.World.processCycle++;
  PM.emitCustomEvent("npc-dialogue:start", { player: again.player, npcId: PEER });
  tick(again);
  assert.match(shown(again).text, /^So I just have to enter by one door/);
  const done = actor(t, { at: [2634, 3669, 0], seer: 2, stage: 2 });
  core.World.processCycle++;
  PM.emitCustomEvent("npc-dialogue:start", { player: done.player, npcId: PEER });
  tick(done);
  assert.equal(shown(done).text, "So you will vote for me at the council?");
});

// ---- doors -----------------------------------------------------------------------------------------

test("the solved entrance walks the player in: inviswall, open leaf, door_open, door back two ticks later", async (t) => {
  const f = actor(t, { at: [2631, 3668, 0], flags: 1 << FLAG_RIDDLE });
  await click(f, LOC.ENTRANCE, 1, 1);
  for (let i = 0; i < 6 && !tileIs(f, 2631, 3666, 0); i++) tick(f);
  assert.ok(tileIs(f, 2631, 3666, 0), where(f));
  const shownAt = objectsSent(f, "sendObject");
  const wall = shownAt.find((object) => object.id === INVISWALL);
  const leaf = shownAt.find((object) => object.id === DOOR_INACTIVE);
  assert.deepEqual({ x: wall.x, y: wall.y, type: wall.type, face: wall.face }, { x: 2631, y: 3667, type: 0, face: 3 });
  assert.deepEqual({ x: leaf.x, y: leaf.y, type: leaf.type, face: leaf.face }, { x: 2631, y: 3666, type: 0, face: 0 });
  assert.ok(sounds(f).includes(62));
  ticks(f, 2);
  const door = objectsSent(f, "sendObject").find((object) => object.id === LOC.ENTRANCE.id);
  assert.ok(door && door.tick === wall.tick + 2, "the door is back two ticks later");
  assert.ok(objectsSent(f, "sendObjectRemoval").some((object) => object.id === DOOR_INACTIVE && object.tick === wall.tick + 2));
});

test("the exit door is locked without the key, and the key does nothing from outside", async (t) => {
  const inside = actor(t, { at: [2636, 3665, 0] });
  await click(inside, LOC.EXIT, 1, 3);
  assert.deepEqual(inside.messages, ["This door is locked tightly shut."]);
  const outside = actor(t, { at: [2636, 3668, 0], items: [I.SEERS_KEY] });
  await use(outside, I.SEERS_KEY, LOC.EXIT);
  ticks(outside, 2);
  assert.equal(trial(outside), 1, "the key from outside passes nothing");
  assert.ok(!outside.messages.includes(PASSED));
});

test("the key opens the exit: the key and the house items go, the trial passes, Peer speaks", async (t) => {
  const f = actor(t, { at: [2636, 3665, 0], items: [I.SEERS_KEY, I.HERRING, I.FULL_JUG] });
  await click(f, LOC.EXIT, 1, 1);
  for (let i = 0; i < 4 && !f.messages.length; i++) tick(f);
  const unlockTick = f.tick;
  assert.deepEqual(f.messages, ["You unlock the door with your key."]);
  assert.deepEqual(inv(f), [I.HERRING], "a plain herring is kept");
  const wall = objectsSent(f, "sendObject").find((object) => object.id === INVISWALL);
  assert.deepEqual([wall.x, wall.y, wall.face], [2636, 3667, 3]);
  assert.ok(objectsSent(f, "sendObject").some((object) => object.id === DOOR_INACTIVE && object.x === 2636 && object.y === 3666));
  tick(f);
  assert.ok(tileIs(f, 2636, 3667, 0), where(f));
  assert.deepEqual(f.messages, ["You unlock the door with your key.", PASSED]);
  assert.equal(trial(f), 2);
  assert.equal(quest().getStage(f.player), 2);
  assert.equal(shown(f).who, "NpcDialogue");
  assert.match(shown(f).text.replace(/<br>/g, " "), /^Incredible! To have solved my puzzle so quickly! I have no choice but to vote in your favour!$/);
  tick(f);
  assert.ok(objectsSent(f, "sendObject").some((object) => object.id === LOC.EXIT.id && object.tick === unlockTick + 2));
  assert.ok(!f.messages.some((text) => /Congratulations/.test(text)));
});

test("leaving by the entrance from inside: the Wiki's warning, then the house items are gone", async (t) => {
  const f = actor(t, { at: [2631, 3665, 0], items: [I.EMPTY_BUCKET, I.OLD_RED_DISK, I.HERRING], flags: (1 << FLAG_RIDDLE) | (1 << FLAG_RED_DISK) });
  await click(f, LOC.ENTRANCE, 1, 3);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "If you leave by this door you will fail this trial.<br>Press continue to go through the door anyway." });
  await continueLine(f);
  tick(f);
  assert.ok(tileIs(f, 2631, 3667, 0), where(f));
  assert.deepEqual(inv(f), [I.HERRING]);
  // The riddle stays solved: 1002313 walked back in at once (t7182 -> t7195).
  assert.ok(flagSet(f, FLAG_RIDDLE) && !flagSet(f, FLAG_RED_DISK));
  assert.ok(objectsSent(f, "sendObject").some((object) => object.id === INVISWALL && object.x === 2631));
});

test("teleporting out or logging in outside with house items loses them", async (t) => {
  const f = actor(t, { at: [2632, 3662, 2], items: [I.VASE_LID, I.WOODEN_DISK], flags: 1 << FLAG_OLD_DISK });
  f.player.moveTo(new core.Location(2644, 3672, 0));
  ticks(f, 2);
  assert.deepEqual(inv(f), []);
  assert.ok(!flagSet(f, FLAG_OLD_DISK));
  const relog = actor(t, { at: [2644, 3672, 0], items: [I.SEERS_KEY] });
  PM.emitPlayerLogin({ player: relog.player, username: relog.player.getUsername() });
  assert.deepEqual(inv(relog), []);
});

// ---- ladders, trapdoors, private locs -----------------------------------------------------------------

test("the ladders climb with the reach animation, then a tick later to the puzzle floor", async (t) => {
  const f = actor(t, { at: [2631, 3664, 0] });
  await click(f, LOC.WEST_LADDER, 1, 1);
  for (let i = 0; i < 3 && !f.anims.length; i++) tick(f);
  assert.equal(f.anims[0].id, 828);
  assert.equal(f.player.getLocation().getZ(), 0);
  tick(f);
  assert.ok(tileIs(f, 2631, 3664, 2), where(f));
});

test("the east trapdoor opens for this player only, with its message and sound, and leads down", async (t) => {
  const f = actor(t, { at: [2636, 3664, 2] });
  const other = actor(t, { at: [2637, 3664, 2] });
  await click(f, LOC.TRAPDOOR, 1, 2);
  assert.deepEqual(f.messages, ["The trapdoor opens..."]);
  assert.ok(sounds(f).includes(62));
  assert.ok(locFor(f, LOC.TRAPDOOR_OPEN.id, LOC.TRAPDOOR_OPEN), "open for its opener");
  assert.equal(locFor(other, LOC.TRAPDOOR_OPEN.id, LOC.TRAPDOOR_OPEN), null, "still shut for everyone else");
  assert.ok(locFor(other, LOC.TRAPDOOR.id, LOC.TRAPDOOR));
  await click(other, LOC.TRAPDOOR, 1, 4);
  assert.deepEqual(other.messages, ["The trapdoor opens..."]);
  await click(f, LOC.TRAPDOOR_OPEN, 1, 3);
  assert.equal(f.player.getLocation().getZ(), 0, where(f));
});

test("the cupboard opens, is searched (four ticks to the bucket), searched again and shut, for one player", async (t) => {
  const f = actor(t, { at: [2630, 3660, 2] });
  await click(f, LOC.CUPBOARD, 1, 1);
  assert.equal(f.anims.at(-1)?.id, 542);
  assert.ok(sounds(f).includes(58));
  tick(f);
  assert.ok(locFor(f, LOC.CUPBOARD_OPEN.id, LOC.CUPBOARD_OPEN));
  await click(f, LOC.CUPBOARD_OPEN, 2, 1);
  assert.deepEqual(f.messages, ["You search the cupboard..."]);
  ticks(f, 3);
  assert.ok(!has(f, I.EMPTY_BUCKET));
  tick(f);
  assert.deepEqual(f.messages, ["You search the cupboard...", "You find a bucket with a number five painted on it."]);
  assert.ok(has(f, I.EMPTY_BUCKET));
  await click(f, LOC.CUPBOARD_OPEN, 2, 5);
  assert.equal(f.messages.at(-1), "You find nothing of interest.");
  await click(f, LOC.CUPBOARD_OPEN, 1, 1);
  assert.equal(f.anims.at(-1).id, 541);
  assert.ok(sounds(f).includes(57));
  tick(f);
  assert.equal(locFor(f, LOC.CUPBOARD_OPEN.id, LOC.CUPBOARD_OPEN), null);
  assert.ok(locFor(f, LOC.CUPBOARD.id, LOC.CUPBOARD));
});

test("the chest opens with its anim and sound and holds the jug", async (t) => {
  const f = actor(t, { at: [2635, 3661, 2] });
  await click(f, LOC.CHEST, 1, 2);
  assert.equal(f.anims.at(-1).id, 536);
  assert.ok(sounds(f).includes(52));
  await click(f, LOC.CHEST_OPEN, 2, 5);
  assert.deepEqual(f.messages, ["You search the chest...", "You find a jug with a number three painted on it."]);
  assert.ok(has(f, I.EMPTY_JUG));
});

test("the bookcase hides the red herring", async (t) => {
  const f = actor(t, { at: [2635, 3664, 2] });
  await click(f, LOC.BOOKCASE, 1, 5);
  assert.deepEqual(f.messages, ["You search the bookcase...", "Hidden behind some old books, you find a red herring."]);
  assert.ok(has(f, I.RED_HERRING));
});

test("Swensen's boxes next door give no puzzle items; the house's own do", async (t) => {
  const swensen = actor(t, { at: [2647, 3663, 0] });
  await click(swensen, LOC.SWENSEN_BOXES, 1, 6);
  assert.ok(![I.MAGNET_2, I.BLUE_THREAD, I.TOY_SHIP, I.SMALL_PICK].some((id) => has(swensen, id)), JSON.stringify(inv(swensen)));
  // The magnet is in the pile at 2636,3660 (rsprox 1002313 t7450); the one at 2633 has nothing.
  const f = actor(t, { at: [2636, 3661, 2] });
  await click(f, LOC.MAGNET_BOXES, 1, 6);
  assert.deepEqual(f.messages, ["You search the boxes...", "You find a magnet hidden inside."]);
  const west = actor(t, { at: [2633, 3661, 2] });
  await click(west, LOC.SW_BOXES, 1, 6);
  assert.deepEqual(west.messages, ["You search the boxes...", "You find nothing of interest."]);
});

// ---- heads, mural, puzzle chain --------------------------------------------------------------------

test("the unicorn head: two boxes, the disk with the second; again: the first box, then a game message", async (t) => {
  const f = actor(t, { at: [2632, 3661, 2] });
  await click(f, LOC.UNICORN, 1, 3);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "You notice there is something unusual about the left eye of this<br>unicorn head..." });
  assert.ok(!has(f, I.OLD_RED_DISK));
  await continueLine(f);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "It is not an eye at all, but some kind of red coloured disk. You take<br>it from the head." });
  assert.ok(has(f, I.OLD_RED_DISK));
  await continueLine(f);
  await click(f, LOC.UNICORN, 1, 3);
  await continueLine(f);
  assert.equal(shown(f), null);
  assert.deepEqual(f.messages, ["It's unusual because you removed it already!"]);
});

test("the bull head gives the wooden disk; once it is in the mural there is a hole", async (t) => {
  const f = actor(t, { at: [2634, 3661, 2] });
  await click(f, LOC.BULL, 1, 3);
  await continueLine(f);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "It is not an eye at all, but some kind of disk made of wood. You<br>take it from the head." });
  assert.ok(has(f, I.WOODEN_DISK));
  const placed = actor(t, { at: [2634, 3661, 2], flags: 1 << FLAG_RED_DISK });
  await click(placed, LOC.BULL, 1, 3);
  assert.deepEqual(shown(placed), { who: "StatementDialogue", text: "There is a hole in this bull head where a right eye should be." });
});

test("herring, goop, disks and the mural: the captured lines, items in place, the lid from the centre", async (t) => {
  const f = actor(t, { at: [2630, 3663, 2], items: [I.WOODEN_DISK, I.RED_HERRING, I.OLD_RED_DISK] });
  await use(f, I.RED_HERRING, LOC.RANGE);
  ticks(f, 2);
  assert.deepEqual(shown(f), { who: "StatementDialogue", text: "As you cook the herring on the stove, the colouring on it peels off<br>separately as a red sticky goop..." });
  assert.deepEqual(inv(f), [I.WOODEN_DISK, I.HERRING, I.OLD_RED_DISK, I.STICKY_RED_GOOP]);
  await continueLine(f);
  await combine(f, I.STICKY_RED_GOOP, I.WOODEN_DISK);
  assert.deepEqual(f.messages, ["You coat the wooden coin with the sticky red goop."]);
  assert.deepEqual(inv(f), [I.RED_DISK_3, I.HERRING, I.OLD_RED_DISK]);
  // Down the east trapdoor to the mural (live allows it at any point).
  f.player.moveTo(new core.Location(2635, 3663, 0));
  tick(f);
  f.messages.length = 0;
  await click(f, LOC.MURAL, 1, 4);
  assert.deepEqual(f.messages, ["You study the mural... it appears to be missing something..."]);
  assert.ok(f.calls.some((call) => call.name === "sendInterface" && call.args[0] === 376));
  f.player.getPacketSender().sendInterfaceRemoval();
  f.messages.length = 0;
  await use(f, I.OLD_RED_DISK, LOC.MURAL);
  assert.deepEqual(f.messages, ["You put the red disk into the empty hole on the mural.", "It is a perfect fit!"]);
  const slot = slotOf(f, I.RED_DISK_3);
  await use(f, I.RED_DISK_3, LOC.MURAL);
  assert.deepEqual(f.messages.slice(2), ["You put the red disk into the empty hole on the mural.", "It is a perfect fit!", "The center of the mural falls out!"]);
  assert.equal(f.player.getInventory().forSlot(slot).getId(), I.VASE_LID);
  assert.deepEqual(inv(f).sort(), [I.HERRING, I.VASE_LID].sort());
});

test("the water puzzle, scales, vase and key, with the captured lines", async (t) => {
  const f = actor(t, { at: [2630, 3661, 2], items: [I.EMPTY_BUCKET, I.EMPTY_JUG, I.VASE_LID] });
  await use(f, I.EMPTY_BUCKET, LOC.TAP);
  await combine(f, I.FULL_BUCKET, I.EMPTY_JUG);
  assert.deepEqual(inv(f), [I._2_5THS_FULL_BUCKET, I.FULL_JUG, I.VASE_LID], "both swap in place");
  await use(f, I.FULL_JUG, LOC.DRAIN);
  assert.ok(f.anims.some((anim) => anim.id === 1077));
  assert.ok(sounds(f).includes(1733));
  await combine(f, I._2_5THS_FULL_BUCKET, I.EMPTY_JUG);
  await use(f, I.EMPTY_BUCKET, LOC.TAP);
  await combine(f, I.FULL_BUCKET, I._2_3RDS_FULL_JUG);
  assert.deepEqual(f.messages, [
    "You fill the bucket from the tap.",
    "You fill the jug to the brim.",
    "You empty the jug down the drain.",
    "You empty the bucket into the jug.",
    "You fill the bucket from the tap.",
    "You fill the jug to the brim.",
  ]);
  assert.deepEqual(inv(f), [I._4_5THS_FULL_BUCKET, I.FULL_JUG, I.VASE_LID]);
  f.messages.length = 0;
  f.player.moveTo(new core.Location(2632, 3664, 2));
  tick(f);
  await use(f, I.FULL_JUG, LOC.SCALES);
  assert.deepEqual(f.messages, ["You place the jug on the scale.", "It is too light to balance it properly."]);
  f.messages.length = 0;
  await use(f, I._4_5THS_FULL_BUCKET, LOC.SCALES);
  assert.deepEqual(f.messages, ["You place the bucket on the scale.", "It is a perfect counterweight and balances precisely.", "You take a strange looking vase out of the chest."]);
  assert.equal(f.anims.at(-1).id, 536);
  assert.deepEqual(inv(f), [I.VASE_2, I.FULL_JUG, I.VASE_LID], "the bucket became the vase");
  await itemOption(f, I.VASE_2, "Shake");
  assert.match(shown(f).text, /^You shake the strangely shaped Vase\. From the sound of it there is/);
  await continueLine(f);
  f.messages.length = 0;
  f.player.moveTo(new core.Location(2630, 3661, 2));
  tick(f);
  await use(f, I.VASE_2, LOC.TAP);
  await combine(f, I.VASE_LID, I.VASE_OF_WATER);
  assert.deepEqual(inv(f), [I.SEALED_VASE_3, I.FULL_JUG]);
  f.player.moveTo(new core.Location(2637, 3665, 2));
  tick(f);
  await use(f, I.SEALED_VASE_3, LOC.FROZEN_TABLE);
  f.player.moveTo(new core.Location(2630, 3663, 2));
  tick(f);
  await use(f, I.FROZEN_KEY, LOC.RANGE);
  assert.deepEqual(f.messages, [
    "You fill the strange looking vase with water.",
    "You screw the lid on tightly.",
    "The water expands as it freezes, and shatters the vase.",
    "You are left with a key encased in ice.",
    "The heat of the range melts the ice around the key.",
  ]);
  assert.deepEqual(inv(f), [I.SEERS_KEY, I.FULL_JUG]);
});

test("before the quest, Peer shouts at a player trying his front door (Peer's page)", async (t) => {
  const f = actor(t, { at: [2631, 3668, 0], seer: 0, stage: 0 });
  await click(f, LOC.ENTRANCE, 1, 3);
  assert.equal(shown(f)?.who, "NpcDialogue");
  assert.match(shown(f).text.replace(/<br>/g, " "), /^Hey! Outerlander! That is my house!/);
  assert.ok(f.player.getLocation().getY() >= 3667, "the door stays shut");
});

// ---- rsprox 1002313 (rev 243), t7261-t7483 -----------------------------------------------------------

test("the second disk's lid goes to the first free slot, not the disk's (rsprox 1002313 t7261)", async (t) => {
  // Live: slot 1 free (the first disk had left it), the second disk in slot 2: the lid lands in slot 1.
  const f = actor(t, { at: [2635, 3663, 0], items: [I.HERRING, I.OLD_RED_DISK, I.RED_DISK_3] });
  await use(f, I.OLD_RED_DISK, LOC.MURAL);
  await use(f, I.RED_DISK_3, LOC.MURAL);
  assert.equal(f.player.getInventory().forSlot(1)?.getId(), I.VASE_LID);
  assert.ok(!(f.player.getInventory().forSlot(2)?.getId() > 0), "the disk's slot is empty");
});

test("the lid seals the vase of water in the lower of the two slots (rsprox 1002313 t7380)", async (t) => {
  // Live: lid in slot 1 on the vase of water in slot 2 -> the sealed vase in slot 1, slot 2 empty.
  const f = actor(t, { at: [2630, 3661, 2], items: [I.HERRING, I.VASE_LID, I.VASE_OF_WATER] });
  await combine(f, I.VASE_LID, I.VASE_OF_WATER);
  assert.equal(f.player.getInventory().forSlot(1)?.getId(), I.SEALED_VASE_3);
  assert.ok(!(f.player.getInventory().forSlot(2)?.getId() > 0));
});

test("the drain: the anim and sound on arrival, the jug empties with the line a tick later (rsprox 1002313 t7321-7322)", async (t) => {
  const f = actor(t, { at: [2630, 3662, 2], items: [I.FULL_JUG] });
  await f.connection.dispatch([{ type: "item_on_object", objectId: LOC.DRAIN.id, x: LOC.DRAIN.x, y: LOC.DRAIN.y, itemId: I.FULL_JUG, slot: 0, widgetId: core.Inventory.INTERFACE_ID }]);
  for (let i = 0; i < 6 && !f.anims.some((anim) => anim.id === 1077); i++) tick(f);
  const poured = f.anims.find((anim) => anim.id === 1077).tick;
  assert.ok(has(f, I.FULL_JUG), "still full on the pour tick");
  assert.deepEqual(f.messages, []);
  tick(f);
  assert.equal(f.tick, poured + 1);
  assert.deepEqual(f.messages, ["You empty the jug down the drain."]);
  assert.ok(has(f, I.EMPTY_JUG));
});

test("the east chest holds a jug too, even with a jug of water held (rsprox 1002313 t7474-7483)", async (t) => {
  const EAST_CHEST = { id: 4167, x: 2638, y: 3662 };
  const EAST_CHEST_OPEN = { id: 4168, x: 2638, y: 3662 };
  const f = actor(t, { at: [2637, 3662, 2], items: [I.FULL_JUG] });
  await click(f, EAST_CHEST, 1, 2);
  await click(f, EAST_CHEST_OPEN, 2, 5);
  assert.deepEqual(f.messages, ["You search the chest...", "You find a jug with a number three painted on it."]);
  assert.ok(has(f, I.EMPTY_JUG));
  // With an empty jug held: nothing (1001646 t3280).
  f.messages.length = 0;
  await click(f, EAST_CHEST_OPEN, 2, 5);
  assert.deepEqual(f.messages, ["You search the chest...", "You find nothing of interest."]);
});

test("a second bookcase search finds nothing while the cooked herring is held (rsprox 1002313 t7443-7449)", async (t) => {
  const f = actor(t, { at: [2635, 3664, 2], items: [I.HERRING] });
  await click(f, LOC.BOOKCASE, 1, 5);
  assert.deepEqual(f.messages, ["You search the bookcase...", "You find nothing of interest."]);
  assert.ok(!has(f, I.RED_HERRING));
});

test("the mural shows its coins, empty circles and, once both disks are in, the lid (rsprox 1002313 t7252, t7264)", async (t) => {
  const pieces = (f) => f.calls.filter((call) => call.name === "sendItemOnInterfaces" && call.args[0] >>> 16 === 376)
    .map((call) => [call.args[0] & 0xffff, call.args[1], call.args[2]]);
  const before = actor(t, { at: [2635, 3663, 0] });
  await click(before, LOC.MURAL, 1, 4);
  assert.deepEqual(pieces(before), [8, 9, 10, 11, 12, 13].map((child) => [child, 3715, 116]).concat([[14, 3716, 116], [15, 3716, 116]]));
  const done = actor(t, { at: [2635, 3663, 0], flags: (1 << FLAG_OLD_DISK) | (1 << FLAG_RED_DISK) });
  await click(done, LOC.MURAL, 1, 4);
  assert.deepEqual(pieces(done), [[1, 3717, 10], ...[8, 9, 10, 11, 12, 13, 14, 15].map((child) => [child, 3715, 116])]);
});
