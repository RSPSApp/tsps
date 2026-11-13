// Run after `yarn build`: node --test tests/grand-exchange-sounds.test.cjs
//
// The Grand Exchange was silent. rsprox captures (ge_offers 465) send a synth 3924 when coins come out of the
// collection and 3928 when items do (both when one collect hands over both). Placing an offer (3925) is not covered here.
// Real clicks through ClientConnection.dispatch on the real plugin, as grand-exchange-single-collect does.
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

const HOME = [3222, 3218];
const GE = 465;
const OFFERS = "grand-exchange-offers";
const COLLECT_COINS = 3924;
const COLLECT_ITEMS = 3928;

let core;
let BONES;
let next = 1900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  BONES = core.ItemIdentifiers.DRAGON_BONES;
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gesnd" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const heard = [];
  const sender = p.getPacketSender();
  const send = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, ...rest) => { heard.push(id); return send(id, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, heard };
}

async function click(f, childId, buttonNum, slot = 0) {
  await f.c.dispatch([{ type: "widget_action", widgetId: (GE << 16) | childId, groupId: GE, childId, buttonNum, slot, itemId: -1 }]);
  f.c.processTurnPackets();
}

function openGe(f) {
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
}

const offer = (sell) => ({ 0: { itemId: BONES, sell, slot: 0, quantity: 1, price: 1_000, total: 1_000, finished: true, completesAt: null } });

test("collecting a bought item plays the items sound only", async (t) => {
  const f = actor(t);
  f.p.setAttribute(OFFERS, offer(false));
  openGe(f);
  await click(f, 6, 1);
  assert.deepEqual(f.heard, [COLLECT_ITEMS]);
});

test("collecting a sale's coins plays the coins sound only", async (t) => {
  const f = actor(t);
  f.p.setAttribute(OFFERS, offer(true));
  openGe(f);
  await click(f, 6, 1);
  assert.deepEqual(f.heard, [COLLECT_COINS]);
});

test("a collect that cannot fit plays nothing", async (t) => {
  const f = actor(t);
  f.p.setAttribute(OFFERS, offer(false));
  const filler = core.ItemIdentifiers.DRAGON_BONES;
  for (let i = 0; i < 28; i++) f.p.getInventory().add(new core.Item(filler, 1), false);
  f.p.getInventory().refreshItems();
  openGe(f);
  await click(f, 6, 1);
  assert.deepEqual(f.heard, []);
});
