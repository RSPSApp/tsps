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

/** Picks option `slot` (1 Yes, 3 Yes and don't ask again) as the client would, whatever is open. */
function click(f, slot = 1) {
  core.MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot, action: slot });
}
const nextTick = () => { core.World.processCycle++; };
const asks = (f, fare) => new RegExp(`for ${fare.toLocaleString("en-US")} coins`).test(core.MultiChatboxPrompt.getPending(f.p)?.title ?? "");
const RING = () => new core.Item(I.RING_OF_CHAROS_A_, 1);
const NONE = () => new core.Item(-1, 0);

/** A player at the route's first port, `coins` in the inventory, the ring worn or not. */
function setup(t, { ring, coins = 100000 }) {
  const f = actor(t);
  const r = route();
  f.p.setLocation(r.tile);
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, ring ? RING() : NONE());
  f.inv.setItem(0, new core.Item(I.COINS, coins));
  f.to = r.to;
  f.fare = () => Charter.fareFor(f.p, Charter.portAt(r.tile), r.to);
  f.ring = (on) => f.p.getEquipment().setItem(core.Equipment.RING_SLOT, on ? RING() : NONE());
  return f;
}

test("Yes and don't ask again after the ring came off is asked again at the full fare, nothing charged or skipped", (t) => {
  const f = setup(t, { ring: true });
  const half = f.fare();
  Charter.offerFare(f.p, f.to, half);
  f.ring(false);
  const full = f.fare();
  assert.ok(full > half);
  click(f, 3);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "nothing charged unseen");
  assert.ok(asks(f, full), "the full fare is asked");
  assert.notEqual(f.p.getAttribute(Charter.SKIP_CONFIRMATION_ATTRIBUTE), true, "not skipped for a fare never seen");
  nextTick();
  click(f, 3);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - full, "charged at the second answer");
  assert.equal(f.p.getAttribute(Charter.SKIP_CONFIRMATION_ATTRIBUTE), true, "skip set once the sail starts");
});

test("a second click on the same tick does not answer the re-asked question; a later tick does", (t) => {
  const f = setup(t, { ring: true });
  Charter.offerFare(f.p, f.to, f.fare());
  f.ring(false);
  const full = f.fare();
  click(f);
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "the double click charged nothing");
  assert.ok(asks(f, full), "the full-fare question is still open");
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "still the same tick");
  nextTick();
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - full);
});

test("putting the ring on after the full-fare question is asked again at half", (t) => {
  const f = setup(t, { ring: false });
  const full = f.fare();
  Charter.offerFare(f.p, f.to, full);
  f.ring(true);
  const half = f.fare();
  assert.ok(half < full);
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "nothing charged at the old fare");
  assert.ok(asks(f, half));
  nextTick();
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - half);
});

test("exactly the fare in coins sails and leaves none", (t) => {
  const f = setup(t, { ring: false, coins: 0 });
  const fare = f.fare();
  f.inv.setItem(0, new core.Item(I.COINS, fare));
  Charter.offerFare(f.p, f.to, fare);
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 0);
});

test("one coin short at Yes charges nothing and says what it costs", (t) => {
  const f = setup(t, { ring: false });
  const fare = f.fare();
  f.inv.setItem(0, new core.Item(I.COINS, fare));
  Charter.offerFare(f.p, f.to, fare);
  f.inv.setItem(0, new core.Item(I.COINS, fare - 1));
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), fare - 1);
  assert.match(core.MultiChatboxPrompt.getPending(f.p).title, /costs/);
});

test("a normal double Yes with the fare unchanged charges once", (t) => {
  const f = setup(t, { ring: false });
  const fare = f.fare();
  Charter.offerFare(f.p, f.to, fare);
  click(f);
  click(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000 - fare);
});

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
  nextTick();
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

test("a charter asked from beside the trader, off the port's zone, re-checks the fare at the trader's port", (t) => {
  const f = actor(t);
  const { from, to, tile } = route();
  // A tile next to the zone that is in no port (zones can touch, so step out until none claims it).
  let off = null;
  for (let d = 1; d < 64 && !off; d++) {
    for (const [x, y] of [[from.zone.low.x - d, from.zone.low.y], [from.zone.high.x + d, from.zone.low.y], [from.zone.low.x, from.zone.low.y - d], [from.zone.low.x, from.zone.high.y + d]]) {
      const tileOff = new core.Location(x, y, from.zone.low.z);
      if (!Charter.portAt(tileOff)) { off = tileOff; break; }
    }
  }
  assert.equal(Charter.portAt(off), null, "the player's own tile is outside every port");
  f.p.setLocation(off);
  Charter.charter({ player: f.p, npc: { getLocation: () => tile, getId: () => 0 }, definition: null });
  assert.equal(Charter.portOf(f.p), from);
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(I.RING_OF_CHAROS_A_, 1));
  const half = Charter.fareFor(f.p, from, to);
  f.inv.setItem(0, new core.Item(I.COINS, 100000));
  Charter.offerFare(f.p, to, half);
  f.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(-1, 0));
  yes(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000, "nothing charged at the old fare");
  const full = Charter.fareFor(f.p, from, to);
  assert.match(core.MultiChatboxPrompt.getPending(f.p).title, new RegExp(`for ${full.toLocaleString("en-US")} coins`));
});

test("Yes away from any port, with no trader, charges nothing", (t) => {
  const f = actor(t);
  const { to, tile } = route();
  f.p.setLocation(tile);
  const fare = Charter.fareFor(f.p, Charter.portAt(tile), to);
  f.inv.setItem(0, new core.Item(I.COINS, 100000));
  Charter.offerFare(f.p, to, fare);
  f.p.setLocation(new core.Location(3200, 3200, 0));
  assert.equal(Charter.portOf(f.p), null);
  yes(f);
  assert.equal(f.inv.getAmount(I.COINS), 100000);
});

// #1352 review: a charter to a place the passenger may not go (a league area still locked) took the fare, sailed,
// and Enforcement.LeagueAreaUnlocks sent them back on landing. The league's refusal is its onCanTeleport hook
// (TeleportHandler.checkReqs), which the sail now asks before taking the coins, as BarnabyFerry does. Stand-in: a
// hook refusing the route's deck with the league's line.
test("a destination the passenger may not go to is refused before the fare is taken", (t) => {
  const f = setup(t, { ring: false });
  const deck = f.to.deck;
  let refusing = true;
  PM.createApi("CharterLockedStandIn").onCanTeleport((event) => {
    const { player, destination } = event;
    if (!refusing || player !== f.p || destination?.getX?.() !== deck.x || destination?.getY?.() !== deck.y) return;
    player.sendMessage("You haven't unlocked that area yet.");
    event.allow = false;
  });
  t.after(() => { refusing = false; });
  const start = f.p.getLocation().clone();
  Charter.offerFare(f.p, f.to, f.fare());
  click(f);
  for (let i = 0; i < 6; i++) { nextTick(); core.TaskManager.process(); }
  assert.equal(f.inv.getAmount(I.COINS), 100000, "no fare taken");
  assert.ok(f.messages.includes("You haven't unlocked that area yet."), f.messages.join(" | "));
  assert.equal(f.p.getLocation().getX(), start.getX(), "not sailed");
  assert.equal(f.p.getLocation().getY(), start.getY());
});

test("a teleblocked passenger keeps the teleblock through a refused and a successful charter", (t) => {
  for (const refuse of [true, false]) {
    const f = setup(t, { ring: false });
    const deck = f.to.deck;
    let on = true;
    PM.createApi(`CharterTeleblock${refuse}`).onCanTeleport((event) => {
      if (!on || !refuse || event.player !== f.p || event.destination?.getX?.() !== deck.x || event.destination?.getY?.() !== deck.y) return;
      event.allow = false;
    });
    t.after(() => { on = false; });
    const timer = f.p.getCombat().getTeleblockTimer();
    timer.start(300);
    Charter.offerFare(f.p, f.to, f.fare());
    click(f);
    assert.equal(f.inv.getAmount(I.COINS), refuse ? 100000 : 100000 - f.fare(), refuse ? "no fare" : "the fare paid");
    assert.equal(timer.finished(), false, `the teleblock still runs (${refuse ? "refused" : "sailed"})`);
  }
});
