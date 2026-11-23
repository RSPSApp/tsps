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
const { before, after, test, mock } = require("node:test");
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
  // Native interaction tests need the plugins, but never an HTTP listener.
  const config = require("../dist/game/definition/WorldDefinition");
  const readConfig = config.readWorldConfig;
  const noAdmin = mock.method(config, "readWorldConfig", (...args) => {
    const actual = readConfig(...args);
    return { ...actual, plugins: { ...actual.plugins, WorldAdmin: false } };
  });
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  noAdmin.mock.restore();
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
  t.after(() => {
    if (core.World.getPlayers().get(p.getIndex()) === p) core.World.getPlayers().remove(p);
    else p.setRegistered(false);
    TaskManager.cancelTasks(p.getIndex());
  });
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

test("Stalker Den's southern cave rebuilds on both crossings without an inter-map forced move (#6548)", async (t) => {
  const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q => q.key === "shadows_of_custodia");
  assert.ok(quest);
  for (const [id, object, from, to] of [
    [57279, [1324, 3364], [1324, 3363], [1323, 9766]],
    [57278, [1324, 9766], [1323, 9766], [1324, 3363]],
  ]) await t.test(`cave ${id}`, () => {
    const f = actor(t, ...from, 59), p = f.p, session = p.getSession();
    p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
    session.setPlayer(p);
    p.setRegistered(false);
    assert.equal(core.World.getPlayers().add(p), true);
    quest.setStage(p, 24); // Supplied completed-quest checkpoint, not a quest playthrough.
    for (let tick = 0; tick < 4 && p.isNeedsPlacement(); tick++) core.World.process();
    assert.equal(p.isNeedsPlacement(), false, "normal World updates finish login placement");
    assert.equal(p.busy(), false);
    for (const point of [from, to]) {
      RegionManager.loadMapFiles(...point);
      assert.equal(RegionManager.blocked(new Location(...point, 0), null), false, "cache-derived standing/landing tile");
    }
    const loc = MapObjects.get(id, new Location(...object, 0), null);
    assert.ok(loc, "the real cache cave exists");
    assert.equal(loc.getDefinition().getInteractions()[0], "Squeeze-through");
    const forces = [], frames = [];
    const setForce = p.setForceMovement.bind(p);
    t.mock.method(p, "setForceMovement", force => {
      if (force) forces.push([force.getEnd().getX(), force.getEnd().getY()]);
      return setForce(force);
    });
    const send = session.sendClientPacket.bind(session);
    t.mock.method(session, "sendClientPacket", frame => { frames.push(frame); return send(frame); });
    session.flushClient(0);
    frames.length = 0;
    click(f, id, ...object, () => p.getAttribute("agility.obstacle") != null);
    assert.ok(p.getAttribute("agility.obstacle"), "the ordinary click starts the crossing");
    for (let tick = 1; p.getAttribute("agility.obstacle") != null; tick++) {
      assert.ok(tick < 15, "the crossing finishes");
      TaskManager.process();
      session.flushClient(tick);
    }
    assert.deepEqual(forces, [], "the inter-map cave never sends a forced movement");
    assert.deepEqual(tile(p), to);
    const rebuild = frames.find(frame => frame[0] === 141); // REBUILD_NORMAL
    assert.ok(rebuild, "arrival sends the destination scene rebuild");
    assert.deepEqual([rebuild.readUInt16BE(3), rebuild.readUInt16BE(5)], [to[0] >> 3, to[1] >> 3]);
    assert.equal(p.getForceMovement(), null);
    assert.equal(p.getSkillAnimation(), -1);
    assert.equal(p.getAnimation().getId(), 65535, "hidden/emerge animation is reset");
    assert.equal(p.getMovementQueue().isMovementBlocked(), false);
    assert.equal(p.getCombat().isAnimationStalled(), false);
  });
});

test("Stalker Den's southern cave keeps its quest and Agility gates", (t) => {
  const quest = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q => q.key === "shadows_of_custodia");
  for (const [level, stage, refusal] of [
    [58, 24, /Agility level of at least 59/],
    [59, 0, /complete Shadows of Custodia/],
  ]) {
    const f = actor(t, 1324, 3363, level);
    quest.setStage(f.p, stage);
    click(f, 57279, 1324, 3364, () => f.messages.length > 0);
    assert.ok(f.messages.some(message => refusal.test(message)), f.messages.join("; "));
    assert.deepEqual(tile(f.p), [1324, 3363]);
    assert.equal(f.p.getAttribute("agility.obstacle") == null, true);
    assert.equal(f.p.getForceMovement() == null, true);
    assert.equal(f.p.getMovementQueue().isMovementBlocked(), false);
  }
});

test("Stalker Den cave logout while hidden leaves a safe tile and clears the animation and movement lock", (t) => {
  const f = actor(t, 1324, 3363, 59), p = f.p;
  require("../plugins/quests/QuestRuntime").getRegisteredQuests().find(q => q.key === "shadows_of_custodia").setStage(p, 24);
  click(f, 57279, 1324, 3364, () => p.getAttribute("agility.obstacle") != null);
  assert.ok(p.getAttribute("agility.obstacle"));
  TaskManager.process(); // The existing duck animation gives way to the hidden pose.
  assert.equal(p.getAnimation().getId(), 2590);
  TaskManager.process(); // Disconnect during the hidden wait, between animation starts.
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  assert.deepEqual(tile(p), [1324, 3363], "the normal logout task cancellation keeps the safe entry tile");
  assert.equal(p.getAttribute("agility.obstacle"), null);
  assert.equal(p.getForceMovement(), null);
  assert.equal(p.getAnimation().getId(), 65535);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  assert.equal(p.getCombat().isAnimationStalled(), false);
});
