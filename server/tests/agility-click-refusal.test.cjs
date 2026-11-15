// Run after `yarn build`: node --test tests/agility-click-refusal.test.cjs
//
// Shortcuts with `refusalTiming: "click"` refuse a player below their level from where they are once the loc is in
// reach (an approach op), as the captures show; the others still refuse on arrival. Real engine: every plugin loaded,
// the real map and locs, real Players, the real click entry (ObjectActionPacketListener.executeAction) and the
// owner-turn movement driver; only the network is stubbed.
//   Fremennik Slayer Dungeon strange floor: rsprox_transcripts/227/910250.txt tick 12768 (6 tiles off, idle)
//   Shilo Village stepping stone: rsprox_transcripts/227/910392.txt tick 14761 (5 tiles off, idle, item box)
//   Taverley Dungeon strange floor: rsprox_transcripts/227/910356.txt ticks 8697-8699 (refused mid-run)
//   Draynor underwall tunnel (arrival): rsprox_transcripts/241/911384.txt tick 173
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

let core;
let index = 13300;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  RegionManager.init();
  for (const [x, y] of [[2774, 10003], [2863, 2974], [2879, 9813], [3069, 3257]]) RegionManager.loadMapFiles(x, y);
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, x, y, agility) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(x, y, 0));
  p.setIndex(index++);
  p.setUsername("clickrefusal" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.AGILITY, agility, false).setCurrentLevels(core.Skill.AGILITY, agility, false);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  const boxes = [];
  const dialogues = p.getDialogueManager();
  t.mock.method(dialogues, "startDialogues", (chain) => { boxes.push(...chain.getDialogues().values()); });
  t.after(() => { p.setRegistered(false); TaskManager.cancelTasks(p.getIndex()); });
  return { p, messages, boxes };
}

const tile = (p) => [p.getLocation().getX(), p.getLocation().getY()];

/** Clicks the loc's first option through the real click entry, then plays owner turns until `done` (or the cap). */
function click(f, id, x, y, done, cap = 12) {
  new ObjectActionPacketListener().executeAction(f.p, id, x, y, 1);
  const trace = [tile(f.p)];
  for (let i = 0; i < cap && !done(); i++) {
    TaskManager.process();
    const mq = f.p.getMovementQueue();
    mq.beginCycle();
    mq.processEntityPursuit();
    if (mq.hasPendingWork()) mq.process();
    TaskManager.processWalkTo(f.p.getIndex());
    trace.push(tile(f.p));
  }
  return trace;
}

test("Fremennik Slayer Dungeon strange floor: refused at the click from 6 tiles, the player not moved (227/910250)", (t) => {
  const f = actor(t, 2780, 10000, 42);
  click(f, 16544, 2774, 10003, () => f.messages.length > 0);
  assert.deepEqual(f.messages, ["You need an agility level of 43 to tackle this obstacle."]);
  assert.deepEqual(tile(f.p), [2780, 10000], "answered where the player stood");
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.AGILITY) > 0 && f.p.getAttribute("agility.obstacle") != null, false);
});

test("Shilo Village stepping stone: the item box at the click from 5 tiles, the player not moved (227/910392)", (t) => {
  const f = actor(t, 2859, 2969, 31);
  click(f, 16466, 2863, 2974, () => f.boxes.length > 0);
  assert.equal(f.boxes.length, 1);
  assert.equal(f.boxes[0].getItemId(), 6514);
  assert.match(f.boxes[0].getText(), /You'd better have an Agility level of 32\./);
  assert.deepEqual(tile(f.p), [2859, 2969]);
  assert.deepEqual(f.messages, []);
});

test("Taverley Dungeon strange floor: refused mid-run on the step that brings the loc in reach (227/910356)", (t) => {
  const f = actor(t, 2883, 9807, 79);
  const trace = click(f, 16510, 2879, 9813, () => f.messages.length > 0);
  assert.deepEqual(f.messages, ["You need 80 agility to tackle this obstacle."]);
  // Live: the click at 8697 from 2883,9807, runs to 2883,9809 and 2883,9811, and the refusal on the tick of the
  // step to 2881,9813.
  assert.deepEqual(trace, [[2883, 9807], [2883, 9809], [2883, 9811], [2881, 9813]]);
  assert.equal(f.p.getMovementQueue().hasPendingWork(), false, "the walk stops at the refusal");
});

test("a player with the level still walks up and crosses on arrival, not from tiles away", (t) => {
  const f = actor(t, 2780, 10000, 99);
  const trace = click(f, 16544, 2774, 10003, () => f.p.getAttribute("agility.obstacle") != null, 20);
  assert.equal(f.messages.includes("You need an agility level of 43 to tackle this obstacle."), false);
  assert.notDeepEqual(trace[1], [2780, 10000], "walked towards the floor first");
  assert.notEqual(f.p.getAttribute("agility.obstacle") ?? null, null, "and crossed once there");
  const [x, y] = tile(f.p);
  assert.ok(Math.max(Math.abs(x - 2774), Math.abs(y - 10003)) <= 3, `crossing began at the floor (${trace.join(" ")})`);
});

test("a player who reaches the level between the click and the op is not sent across from tiles away", (t) => {
  const f = actor(t, 2883, 9807, 79);
  new ObjectActionPacketListener().executeAction(f.p, 16510, 2879, 9813, 1);
  f.p.getSkillManager().setCurrentLevels(core.Skill.AGILITY, 80, false);
  for (let i = 0; i < 6; i++) {
    TaskManager.process();
    const mq = f.p.getMovementQueue();
    mq.beginCycle();
    if (mq.hasPendingWork()) mq.process();
    TaskManager.processWalkTo(f.p.getIndex());
  }
  assert.deepEqual(f.messages, [], "no refusal: the level is met now");
  assert.equal(f.p.getAttribute("agility.obstacle") ?? null, null, "no crossing started from where the op fired");
  assert.deepEqual(tile(f.p), [2881, 9813], "stopped where the op fired");
});

test("the Draynor underwall tunnel still refuses on arrival, as captured (241/911384)", (t) => {
  const f = actor(t, 3074, 3257, 41);
  const trace = click(f, 19036, 3069, 3257, () => f.messages.length > 0);
  assert.deepEqual(f.messages, ["You need an agility level of 42 to negotiate this tunnel."]);
  assert.ok(trace.length > 2, "walked first");
  assert.deepEqual(tile(f.p), [3070, 3257], "refused at the tunnel");
});
