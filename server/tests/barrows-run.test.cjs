// Run after `yarn build`: node --test tests/barrows-run.test.cjs
// The Barrows run (plugins/minigames/Barrows.plugin.js): a looted run stays looted until the next
// crypt is dug into, as live keeps it (237/04057: looted, teleported to the surface, reset only by
// the spade's dig), so a teleport out of the chest room and back into it (the league Evil eye's
// "Barrows (chest)") finds the chest empty.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");

let core;
let Barrows;
const CHEST_ROOM = new Location(3551, 9694, 0);
const SURFACE = new Location(3565, 3288, 0);
const AHRIM_MOUND = new Location(3565, 3289, 0);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3551, 9694);
  Barrows = require("../plugins/minigames/Barrows.plugin");
  Barrows.register(new Proxy({
    core,
    getWorld: () => core.World,
    getRegionManager: () => core.RegionManager,
    getTaskManager: () => core.TaskManager,
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function player() {
  const subject = new Player(null);
  subject.setUsername("barrows-run");
  subject.setRegistered(true);
  const sent = { messages: [], varbits: new Map() };
  const sender = new Proxy({}, {
    get: (target, key) => (key === "sendVarbit" ? (id, value) => (sent.varbits.set(id, value), sender)
      : key === "sendMessage" ? (text) => (sent.messages.push(text), sender) : () => sender),
  });
  subject.getPacketSender = () => sender;
  subject.sendMessage = (text) => sent.messages.push(text);
  return Object.assign(subject, { sent });
}

function arrive(subject, location) {
  subject.setLocation(location.clone());
  Barrows._test.processPlayer({ player: subject });
}

test("Barrows: a looted run stays looted through a teleport out and back to the chest; the next crypt's dig starts a new one", () => {
  const subject = player();
  arrive(subject, CHEST_ROOM);
  const run = subject.getAttribute("barrows");
  Object.assign(run, { killed: [0, 1, 2, 3, 4, 5], kills: 6, points: 600, chestOpen: true });
  Barrows._test.searchChest(subject, 1);
  assert.equal(subject.getAttribute("barrows").looted, true);
  arrive(subject, SURFACE);
  assert.equal(subject.getAttribute("barrows"), run, "still the looted run on the surface");
  arrive(subject, CHEST_ROOM);
  subject.sent.messages.length = 0;
  Barrows._test.searchChest(subject, 1);
  assert.deepEqual(subject.sent.messages, ["The chest is empty. Leave the tunnels to begin another run."]);
  arrive(subject, AHRIM_MOUND);
  Barrows._test.dig({ player: subject });
  const fresh = subject.getAttribute("barrows");
  assert.notEqual(fresh, run);
  assert.deepEqual([fresh.looted, fresh.kills, fresh.killed, fresh.chests], [false, 0, [], run.chests]);
  assert.equal(subject.sent.varbits.get(1394), 0, "the chest shut");
});
