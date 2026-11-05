// Run after `yarn build`: node --test tests/multiloc-parent-handlers.test.cjs
//
// The map places a multiloc parent and a click names it, so a handler keyed on the child a player sees never
// fires. Each case is a real packet with the parent's id at the real tile, through the real route. The control
// is the same event with the child's id, which the handler has always answered. No client ran.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const { createTraversalAssist } = require("../plugins/bots/lib/TraversalAssist.PlayerBots");

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [0, 3], [-1, -1], [2, 2]];

let core;
let next = 7200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, quest, stage) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("multiloc" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(at);
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === quest).setStage(p, stage);
  return { p, c, messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

function spy(t, method) {
  const seen = [];
  const real = PM[method];
  t.mock.method(PM, method, (event, ...rest) => {
    seen.push(event);
    return real.call(PM, event, ...rest);
  });
  return seen;
}

/** Sends the packet from each open side of the tile until the event comes, or none is left. */
async function fromASide(t, seen, { tile, quest, stage, varbits = [], prepare = () => {}, packet }) {
  core.RegionManager.loadMapFiles(tile[0], tile[1]);
  const sides = SIDES.map(([dx, dy]) => new core.Location(tile[0] + dx, tile[1] + dy, tile[2]))
    .filter((location) => !core.RegionManager.blocked(location, null));
  for (const side of sides) {
    const f = actor(t, side, quest, stage);
    for (const [id, value] of varbits) f.p.getPacketSender().sendVarbit(id, value);
    prepare(f);
    const found = MapObjects.getPrivateArea(f.p, packet.objectId ?? packet.id, new core.Location(tile[0], tile[1], tile[2]));
    await send(f, packet);
    t.diagnostic(`from ${side.getX()},${side.getY()}: object ${found ? "found" : "missing"}, events ${seen.length}, said ${f.messages}`);
    if (seen.length) return f;
  }
  assert.fail(`the packet reached no handler from any side of ${tile}`);
}

async function itemOn(t, { quest, stage, stageAfter, item, parent, child, tile, varbits }) {
  const seen = spy(t, "emitItemOnObject");
  const f = await fromASide(t, seen, {
    tile, quest, stage, varbits,
    prepare: (a) => a.p.getInventory().setItem(0, new core.Item(item, 1)),
    packet: { type: "item_on_object", itemId: item, slot: 0, widgetId: 149 << 16, objectId: parent, x: tile[0], y: tile[1] },
  });
  const real = seen[0];
  assert.equal(real.objectId, parent, "the event names the parent");
  const handled = real.handled === true;
  const reached = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === quest).getStage(f.p);
  assert.equal(PM.emitItemOnObject({ ...real, objectId: child, handled: false }), true, "control: the child id is answered");
  assert.equal(handled, true, `the real use of ${parent} is handled`);
  if (stageAfter !== undefined) assert.equal(reached, stageAfter, "and moves the quest on");
}

test("Hand in the Sand: truth serum on Sandy's coffee mug", (t) => itemOn(t, {
  quest: "hand_in_the_sand", stage: 90, item: core.ItemIdentifiers.TRUTH_SERUM,
  parent: 10806, child: 10807, tile: [2789, 3176, 0],
}));

test("Hand in the Sand: the lens on Betty's counter, once she has placed the vial", (t) => itemOn(t, {
  quest: "hand_in_the_sand", stage: 70, item: core.ItemIdentifiers.ROSE_TINTED_LENS,
  parent: 10812, child: 10813, tile: [3013, 3258, 0], varbits: [[1537, 1]],
}));

test("Hand in the Sand: the lens on the counter before she has does nothing", async (t) => {
  const seen = spy(t, "emitItemOnObject");
  const item = core.ItemIdentifiers.ROSE_TINTED_LENS;
  const tile = [3013, 3258, 0];
  await fromASide(t, seen, {
    tile, quest: "hand_in_the_sand", stage: 70,
    prepare: (f) => f.p.getInventory().setItem(0, new core.Item(item, 1)),
    packet: { type: "item_on_object", itemId: item, slot: 0, widgetId: 149 << 16, objectId: 10812, x: tile[0], y: tile[1] },
  });
  assert.notEqual(seen[0].handled, true, "the empty counter isn't Betty's");
});

/** Plays on through message boxes, as a player clicking Continue does. */
async function continueDialogue(f) {
  for (let i = 0; i < 12 && f.p.getDialogueManager().isActive(); i++) {
    await send(f, { type: "dialogue_continue", widgetId: f.p.getPacketSender().chatboxGroupId << 16, childIndex: -1 });
  }
}

test("Hand in the Sand: with the serum made, a real pour takes it and moves the quest to 100", async (t) => {
  const seen = spy(t, "emitItemOnObject");
  const item = core.ItemIdentifiers.TRUTH_SERUM;
  const tile = [2789, 3176, 0];
  const f = await fromASide(t, seen, {
    tile, quest: "hand_in_the_sand", stage: 90,
    prepare: (a) => {
      a.p.setAttribute("quest.hand_in_the_sand.serum", 6);
      a.p.getInventory().setItem(0, new core.Item(item, 1));
    },
    packet: { type: "item_on_object", itemId: item, slot: 0, widgetId: 149 << 16, objectId: 10806, x: tile[0], y: tile[1] },
  });
  assert.equal(seen[0].objectId, 10806, "the event names the parent");
  await continueDialogue(f);
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "hand_in_the_sand");
  assert.equal(quest.getStage(f.p), 100, f.messages.join(" | "));
  assert.equal(f.p.getInventory().getAmount(item), 0, "the serum is gone");
});

test("Hand in the Sand: with the vial down, a real use of the lens makes the serum", async (t) => {
  const seen = spy(t, "emitItemOnObject");
  const I = core.ItemIdentifiers;
  const tile = [3013, 3258, 0];
  const f = await fromASide(t, seen, {
    tile, quest: "hand_in_the_sand", stage: 70, varbits: [[1537, 1]],
    prepare: (a) => {
      a.p.setAttribute("quest.hand_in_the_sand.serum", 4);
      a.p.setAttribute("quest.hand_in_the_sand.counter", true);
      a.p.getInventory().setItem(0, new core.Item(I.ROSE_TINTED_LENS, 1));
    },
    packet: { type: "item_on_object", itemId: I.ROSE_TINTED_LENS, slot: 0, widgetId: 149 << 16, objectId: 10812, x: tile[0], y: tile[1] },
  });
  assert.equal(seen[0].objectId, 10812, "the event names the parent");
  await continueDialogue(f);
  assert.equal(f.p.getAttribute("quest.hand_in_the_sand.serum"), 5, "the serum is made");
  assert.equal(f.p.getInventory().getAmount(I.ROSE_TINTED_LENS), 0, "the lens is gone");
  assert.equal(f.p.getInventory().getAmount(I.TRUTH_SERUM), 1, "and the vial is in hand");
});

test("Making Friends with My Arm: squeezing through the broken fence after the quest", async (t) => {
  const tile = [2866, 3938, 0];
  const seen = spy(t, "emitObjectInteraction");
  const f = await fromASide(t, seen, {
    tile, quest: "making_friends_with_my_arm", stage: 200, varbits: [[6528, 200]],
    packet: { type: "object_option", id: 46815, x: tile[0], y: tile[1], clickType: 1, action: "Squeeze-through" },
  });
  assert.equal(seen[0].objectId, 46815, "the event names the parent");
  assert.equal(seen[0].handled, true, "the real click is handled");
  assert.notDeepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], tile.slice(0, 2), "and moves the player");
});

test("Enakhra's Lament: the sandstone base on the flat ground", (t) => itemOn(t, {
  quest: "enakhras_lament", stage: 3, stageAfter: 4, item: core.ItemIdentifiers.SANDSTONE_BASE,
  parent: 10952, child: 10954, tile: [3189, 2925, 0], varbits: [[1593, 0]],
}));

test("Enakhra's Lament: the sandstone body on the statue once the base is down", (t) => itemOn(t, {
  quest: "enakhras_lament", stage: 6, stageAfter: 7, item: core.ItemIdentifiers.SANDSTONE_BODY,
  parent: 10952, child: 10955, tile: [3189, 2925, 0], varbits: [[1593, 1]],
}));

test("report: where the plain locs these quests also rely on stand", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "multiloc-parent-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cachePath = path.join(dir, "index.json");
  const ids = { 33219: "My Arm's fence, Cross", 10805: "Sandy's desk", 6847: "Wizards' Guild bell" };
  const api = { getRegionManager: () => core.RegionManager, core, log: (name, data) => { if (/failed/.test(name)) t.diagnostic(data?.message); } };
  createTraversalAssist(api, { objectIds: Object.keys(ids).map(Number), cachePath }).initializePersistentIndex({ forceRescan: true });
  const placed = {};
  for (const [region, byId] of Object.entries(JSON.parse(fs.readFileSync(cachePath, "utf8")).r)) {
    for (const [id, locations] of Object.entries(byId)) {
      for (const [lx, ly, z] of locations) (placed[id] ??= []).push([(region >> 8) * 64 + lx, (region & 0xff) * 64 + ly, z]);
    }
  }
  for (const [id, name] of Object.entries(ids)) t.diagnostic(`${name} ${id}: ${JSON.stringify(placed[id] ?? "not on the map")}`);
  assert.ok(Object.keys(placed).length > 0, "the scan found the map");
});
