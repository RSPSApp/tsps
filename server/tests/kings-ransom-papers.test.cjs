// Run after `yarn build`: node --test tests/kings-ransom-papers.test.cjs
// King's Ransom's Address form and Scrap paper Read open their cache interfaces (kr_address_form 586,
// kr_scrap_paper 587), whose text is all in the cache (Wiki, Transcript:King's Ransom: "Address form
// interface opens."). Every plugin is loaded and the click goes through the real inventory dispatch.
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

const ADDRESS_FORM = 11680;
const SCRAP_PAPER = 11681;
let core;
let next = 5300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("krpaper" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(2746, 3580, 0));
  p.needsPlacement = false;
  const opened = [];
  const sender = p.getPacketSender();
  const sendInterface = sender.sendInterface.bind(sender);
  sender.sendInterface = (id, ...rest) => { opened.push(id); return sendInterface(id, ...rest); };
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, opened };
}

async function read(f, itemId) {
  f.p.getInventory().setItem(0, new core.Item(itemId, 1));
  await f.c.dispatch([{ type: "inventory_action", slot: 0, itemId, widgetId: 3214, option: "Read" }]);
  f.c.processTurnPackets();
}

test("Read on the Address form opens kr_address_form", async (t) => {
  const f = actor(t);
  await read(f, ADDRESS_FORM);
  assert.deepEqual(f.opened, [CacheDefinitions.getInterfaceId("kr_address_form")]);
  assert.equal(f.opened[0], 586);
  assert.equal(f.p.getInventory().getAmount(ADDRESS_FORM), 1, "reading keeps the form");
});

test("Read on the Scrap paper opens kr_scrap_paper", async (t) => {
  const f = actor(t);
  await read(f, SCRAP_PAPER);
  assert.deepEqual(f.opened, [CacheDefinitions.getInterfaceId("kr_scrap_paper")]);
  assert.equal(f.opened[0], 587);
});
