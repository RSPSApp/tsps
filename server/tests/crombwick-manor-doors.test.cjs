// Run after `yarn build`: node --test tests/crombwick-manor-doors.test.cjs
//
// Crombwick Manor's front doors in Slepe (slp_mansion_door_l / _r, "Doors", Open) had no handler.
// Live (rsprox 227/1000270, 231/391) answers Open on either leaf with the message box
// "The door is locked." and never opens them; the Wiki: the manor is only reached from Kroy's lab.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");

const plugin = require("../plugins/areas/CrombwickManor.plugin");
const T = plugin._test;

let core, objects;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  objects = new Map();
  plugin.register(new Proxy({
    core,
    onObjectInteraction(name, handlers) { objects.set(name, handlers); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function makePlayer() {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel), new Location(3725, 3349, 0));
  player.setIndex(9950 + Math.floor(Math.random() * 40));
  player.setUsername("crombwickqa");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  return player;
}

/** The text components the player is sent, in order. */
function texts(player) {
  const sent = [];
  const sender = player.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  sender.sendString = (text, uid) => {
    sent.push({ text, uid });
    return sendString(text, uid);
  };
  return sent;
}

const MESSAGEBOX_TEXT = (229 << 16) | 3;

for (const loc of T.DOOR_LOCS) {
  test(`Open on ${loc} shows the locked message box and leaves the door shut`, () => {
    const objectId = core.CacheDefinitions.getLocId(loc);
    assert.ok(objectId > 0, `${loc} is in the cache`);
    assert.equal(core.CacheDefinitions.getObject(objectId).name, "Doors");
    const player = makePlayer();
    const sent = texts(player);
    const open = objects.get("Doors")?.Open;
    assert.equal(typeof open, "function", "Open is registered on Doors");
    assert.equal(open({ player, objectId, object: { getId: () => objectId } }), true, "the click is taken");
    assert.deepEqual(sent.filter((s) => s.uid === MESSAGEBOX_TEXT).map((s) => s.text), [T.LOCKED]);
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [3725, 3349],
      "the player doesn't cross into the manor");
  });
}

test("other Doors fall through to the door plugin", () => {
  const objectId = core.ObjectIdentifiers.DOOR_607; // the Door beside them in the cache
  const player = makePlayer();
  const sent = texts(player);
  assert.equal(objects.get("Doors").Open({ player, objectId, object: { getId: () => objectId } }), false);
  assert.equal(sent.length, 0, "nothing is sent");
});
