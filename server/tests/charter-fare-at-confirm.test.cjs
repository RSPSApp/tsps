// Run after `yarn build`: node --test tests/charter-fare-at-confirm.test.cjs
// A charter fare is worked out when the question is asked; Yes charges the fare as it is then, so taking off a
// ring of charos(a) (Wiki: halves the fare) between the question and Yes is asked again at the full fare rather
// than charged half. Real engine: every plugin loaded, a real Player at a real port's zone with a real worn ring,
// the charter plugin's own fare question (the real Yes/No prompt) and its sail.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9960;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("charter" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}
const Charter = require("../plugins/world/CharterShips.plugin")._test;

/** Two charter ports with a fare between them, and a tile inside the first one's zone. */
function route() {
  const rows = Charter.destinations().filter((row) => row.zone && !row.restricted);
  for (const from of rows) {
    for (const to of rows) {
      if (from === to || Charter.fareBetween(from.name, to.name) == null) continue;
      const tile = new core.Location(from.zone.low.x, from.zone.low.y, from.zone.low.z);
      if (Charter.portAt(tile) === from) return { from, to, tile };
    }
  }
  throw new Error("no charter route");
}

function yes(f) {
  const prompt = core.MultiChatboxPrompt.getPending(f.p);
  assert.ok(prompt, "a question is open");
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1 });
}

test("taking off a ring of charos(a) after the half-fare question is asked again at the full fare", (t) => {
  const f = actor(t);
  const { to, tile } = route();
  f.p.setLocation(tile);
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));
  const half = Charter.fareFor(f.p, Charter.portAt(tile), to);
  f.inv.setItem(0, new core.Item(I.COINS, 100000));
  Charter.offerFare(f.p, to, half);
  assert.match(core.MultiChatboxPrompt.getPending(f.p).title, new RegExp(`for ${half.toLocaleString("en-US")} coins`));
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(-1, 0));
  yes(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "nothing charged at the old fare");
  const full = Charter.fareFor(f.p, Charter.portAt(tile), to);
  assert.ok(full > half);
  assert.match(core.MultiChatboxPrompt.getPending(f.p).title, new RegExp(`for ${full.toLocaleString("en-US")} coins`), "asked again at the full fare");
  yes(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - full);
});

test("with nothing changed, Yes charges the fare asked", (t) => {
  const f = actor(t);
  const { to, tile } = route();
  f.p.setLocation(tile);
  const fare = Charter.fareFor(f.p, Charter.portAt(tile), to);
  f.inv.setItem(0, new core.Item(I.COINS, 100000));
  Charter.offerFare(f.p, to, fare);
  yes(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - fare);
});
