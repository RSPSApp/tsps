// Run after `yarn build`: node --test tests/spade-dig-nothing-found.test.cjs
// A spade dug where no content claims the click plays human_dig and says "Nothing interesting
// happens." on the same tick (rsprox.net captures, obj spade op2, e.g. 1698 tick 6941); a dig spot
// that answers (Barrows) sends only its own line. Every plugin is loaded and the click goes
// through the real inventory packet dispatch.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const SPADE = 952;
let core;
let next = 5200;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, [x, y, z]) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("spadedig" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const messages = [];
  p.sendMessage = (text) => messages.push(text);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  p.getInventory().setItem(0, new core.Item(SPADE, 1));
  return { p, c, messages };
}

async function dig(f) {
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId: SPADE, widgetId: 3214, option: "Dig" }]);
  f.c.processTurnPackets();
}

test("a dig in Varrock square plays human_dig and says nothing interesting happens", async (t) => {
  const f = actor(t, [3213, 3424, 0]);
  await dig(f);
  assert.deepEqual(f.messages, ["Nothing interesting happens."]);
  assert.equal(f.p.getAnimation()?.getId(), CacheDefinitions.getSeqId("human_dig") ?? 830);
  assert.equal(f.p.getInventory().getAmount(SPADE), 1);
});

test("a dig that content claims (Barrows, off the mounds) sends only that content's line", async (t) => {
  const f = actor(t, [3560, 3305, 0]);
  await dig(f);
  assert.deepEqual(f.messages, ["You dig into the ground, but find nothing."]);
});
