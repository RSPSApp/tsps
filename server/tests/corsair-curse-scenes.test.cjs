// Run after `yarn build`: node --test tests/corsair-curse-scenes.test.cjs
//
// What the Corsair Curse's scenes put on screen, where a source settles it:
// - Gnocci's doll: the cache's own client script corscurs_doll (2085) draws it over the screen. Nothing in
//   the cache calls that script, so the server has to.
// - The telescope view: interface wom_telescope (386) on overlay_atmosphere, as rsprox 4259 opens it for the
//   Wise Old Man's telescope with the same sequence, human_use_wom_telecope (2171).
// - Ithoi's run out of his hut: he walks it, on NPC 7963, whose walk sequence is human_running.
// - Ithoi's return: the Wiki transcript has him cast Water Strike "and return to his hut", so he walks back to
//   the foot of his stairs, where he came out. The tick he leaves is not recorded anywhere: ours is the next one.
// Native fixture: real plugins and packet sender; scene steps as the transcript's npc-dialogue:action events,
// the fire from a real item-on-object event. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HUT = [2529, 2838];
const DOLL_SCRIPT = 2085;
const TELESCOPE_INTERFACE = 386;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const TINDERBOX = 590;
const DRIFTWOOD = 31724;
const ITHOI_RUNNING = 7963;
const STAGE_CONFESSED = 6;
const RUN_END = [2532, 2836];
const HUT_STAIRS_FOOT = [2532, 2833];

let core;
let next = 6800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HUT);
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("corsairqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HUT[0], HUT[1], 0));
  p.needsPlacement = false;
  const sender = p.getPacketSender();
  const f = { p, scripts: [], opened: [], closed: [], loggedOut: false };
  const sendClientScript = sender.sendClientScript;
  t.mock.method(sender, "sendClientScript", function (id, ...args) {
    f.scripts.push(id);
    return sendClientScript.call(this, id, ...args);
  });
  const sendSubInterface = sender.sendSubInterface;
  t.mock.method(sender, "sendSubInterface", function (uid, id, ...args) {
    f.opened.push([uid, id]);
    return sendSubInterface.call(this, uid, id, ...args);
  });
  const closeSubInterface = sender.closeSubInterface;
  t.mock.method(sender, "closeSubInterface", function (uid, ...args) {
    f.closed.push(uid);
    return closeSubInterface.call(this, uid, ...args);
  });
  t.after(() => {
    if (!f.loggedOut) logout(f);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return f;
}

function logout(f) {
  f.loggedOut = true;
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
}

const ticks = (count) => {
  for (let i = 0; i < count; i++) core.TaskManager.process();
};
const action = (f, stepId) => PM.emitCustomEvent("npc-dialogue:action", { player: f.p, stepId });
const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_corsair_curse");

test("Gnocci's flashback draws the possessed doll with the cache's script, once, at the burial", (t) => {
  const f = actor(t);
  action(f, "Cs_rhQ");
  ticks(1);
  assert.ok(!f.scripts.includes(DOLL_SCRIPT), "control: not while he's fishing");

  action(f, "OV-LNe");
  assert.equal(f.scripts.filter((id) => id === DOLL_SCRIPT).length, 1, "the doll fills the screen");
  ticks(18);
  assert.equal(f.scripts.filter((id) => id === DOLL_SCRIPT).length, 1, "and only once");
});

test("the telescope view opens the lens overlay after its first shot, and the scene's end closes it", (t) => {
  const f = actor(t);
  action(f, "36K07h");
  const lens = () => f.opened.filter(([uid, id]) => uid === OVERLAY_ATMOSPHERE_UID && id === TELESCOPE_INTERFACE);
  assert.equal(lens().length, 0, "the camera comes first");
  ticks(1);
  assert.equal(lens().length, 1, "the lens opens the next tick, as rsprox 4259's does");
  assert.ok(!f.closed.includes(OVERLAY_ATMOSPHERE_UID), "and stays");
  ticks(18);
  assert.ok(f.closed.includes(OVERLAY_ATMOSPHERE_UID), "the scene's end takes it off");

  const left = actor(t);
  action(left, "36K07h");
  ticks(1);
  logout(left);
  assert.ok(left.closed.includes(OVERLAY_ATMOSPHERE_UID), "so does leaving early");
});

test("Colin's flashback doesn't open the lens or close the overlay slot", (t) => {
  const f = actor(t);
  action(f, "Gsd1jQ");
  ticks(1);
  action(f, "p6ox6g");
  ticks(2);
  assert.deepEqual(f.opened.filter(([, id]) => id === TELESCOPE_INTERFACE), []);
  assert.ok(!f.closed.includes(OVERLAY_ATMOSPHERE_UID));
});

test("Ithoi walks out of his hut to the same tile, and doesn't teleport there", (t) => {
  const teleports = [];
  let ithoi = null;
  const spawn = PM.spawnNpc;
  // A spawn waits in World's add queue for a tick this fixture doesn't run, so take it here.
  t.mock.method(PM, "spawnNpc", (...args) => {
    const npc = spawn.apply(PM, args);
    if (npc?.getId() === ITHOI_RUNNING) ithoi = npc;
    return npc;
  });
  const moveTo = NPC.prototype.moveTo;
  t.mock.method(NPC.prototype, "moveTo", function (tile) {
    if (this.getId() === ITHOI_RUNNING) teleports.push([tile.getX(), tile.getY()]);
    return moveTo.call(this, tile);
  });
  const f = actor(t);
  quest().setStage(f.p, STAGE_CONFESSED);
  f.p.setAttribute("corsair-curse:proof-plan", true);
  f.p.getInventory().add(new core.Item(TINDERBOX, 1), false);
  const object = new core.GameObject(DRIFTWOOD, new core.Location(2530, 2837, 0), 10, 0, null);
  PM.emitItemOnObject({ player: f.p, object, itemId: TINDERBOX, objectId: DRIFTWOOD });

  const seen = [];
  for (let i = 0; i < 24 && seen.length < 8; i++) {
    core.TaskManager.process();
    if (!ithoi) continue;
    ithoi.getMovementQueue().process();
    seen.push([ithoi.getLocation().getX(), ithoi.getLocation().getY()]);
  }
  t.diagnostic(`Ithoi ${JSON.stringify(seen)}; teleports ${JSON.stringify(teleports)}`);
  assert.ok(ithoi, "Ithoi comes out");
  assert.deepEqual(teleports, [], "he doesn't teleport along the route");
  assert.deepEqual(seen.at(-1), RUN_END, "and ends where the route did");
});

test("Ithoi walks back to the foot of his stairs after Water Strike, and doesn't teleport there", (t) => {
  const teleports = [];
  let ithoi = null;
  const spawn = PM.spawnNpc;
  t.mock.method(PM, "spawnNpc", (...args) => {
    const npc = spawn.apply(PM, args);
    if (npc?.getId() === ITHOI_RUNNING) ithoi = npc;
    return npc;
  });
  const moveTo = NPC.prototype.moveTo;
  t.mock.method(NPC.prototype, "moveTo", function (tile) {
    if (this.getId() === ITHOI_RUNNING) teleports.push([tile.getX(), tile.getY()]);
    return moveTo.call(this, tile);
  });
  const f = actor(t);
  quest().setStage(f.p, STAGE_CONFESSED);
  f.p.setAttribute("corsair-curse:proof-plan", true);
  f.p.getInventory().add(new core.Item(TINDERBOX, 1), false);
  const object = new core.GameObject(DRIFTWOOD, new core.Location(2530, 2837, 0), 10, 0, null);
  PM.emitItemOnObject({ player: f.p, object, itemId: TINDERBOX, objectId: DRIFTWOOD });

  const seen = [];
  for (let i = 0; i < 30; i++) {
    core.TaskManager.process();
    if (!ithoi) continue;
    ithoi.getMovementQueue().process();
    seen.push([ithoi.getLocation().getX(), ithoi.getLocation().getY()]);
  }
  t.diagnostic(`Ithoi ${JSON.stringify(seen)}; teleports ${JSON.stringify(teleports)}`);
  const at = (tile) => seen.findIndex(([x, y]) => x === tile[0] && y === tile[1]);
  assert.ok(at(RUN_END) >= 0, "he comes out to the end of his run first");
  assert.deepEqual(seen.at(-1), HUT_STAIRS_FOOT, "then goes back to the foot of his stairs");
  assert.ok(seen.slice(at(RUN_END)).some(([, y]) => y === 2835 || y === 2834), "walking, not jumping");
  assert.deepEqual(teleports, [], "he doesn't teleport back");
});

test("Gnocci's dug-up doll walks its whole route, across the clipped edge at 2509,2839-2838 (#2558)", (t) => {
  const DOLL = 7975;
  const GNOCCI = 7970;
  const STAGE_HEARD = 3;
  let doll = null;
  const spawn = PM.spawnNpc;
  // A spawn waits in World's add queue for a tick this fixture doesn't run, so take it here.
  t.mock.method(PM, "spawnNpc", (...args) => {
    const npc = spawn.apply(PM, args);
    if (npc?.getId() === DOLL) doll = npc;
    return npc;
  });
  const f = actor(t);
  quest().setStage(f.p, STAGE_HEARD);
  f.p.setAttribute("quest.the_corsair_curse.cook", 1);
  PM.emitCustomEvent("npc-dialogue:choice", { player: f.p, npcId: GNOCCI, option: "Search for the possessed doll and face the consequences." });

  const seen = [];
  for (let i = 0; i < 10; i++) {
    core.TaskManager.process();
    if (!doll || !doll.isRegistered?.()) continue;
    doll.getMovementQueue().process();
    seen.push([doll.getLocation().getX(), doll.getLocation().getY()]);
  }
  t.diagnostic(`doll ${JSON.stringify(seen)}`);
  assert.ok(doll, "the doll comes up");
  assert.ok(seen.some(([x, y]) => x === 2509 && y === 2838), "it reaches 2509,2838, past the clipped edge");
  assert.deepEqual(seen.at(-1), [2509, 2839], "and ends back on 2509,2839, as the route does");
});
