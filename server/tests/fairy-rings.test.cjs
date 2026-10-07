// Run after `yarn build`: node --test tests/fairy-rings.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Location } = require("../dist/game/model/Location");
const { Direction } = require("../dist/game/model/Direction");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const FairyRings = require("../plugins/world/FairyRings.plugin");

const T = FairyRings._test;
const DRAMEN_STAFF = 772;
const LIT_CANDLE = 33;
let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // As the real check: an open interface means busy.
  TeleportHandler.checkReqs = (player) => !(player.getInterfaceId() > 0);
  FairyRings.register({
    core, persistAttribute() {}, onObjectInteraction() {}, onInterfaceActionClick() {},
    onCustomEvent() {}, onPlayerLogin() {}, log() {},
  });
});

/** A player recording, per tick, what the server sends. */
function player({ weapon = DRAMEN_STAFF, inventory = [], at = new Location(3129, 3496, 0) } = {}) {
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const varbits = new Map();
  const attributes = new Map();
  let location = at;
  let open = -1;
  const item = (id) => ({ getId: () => id });
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit: (id, value) => (varbits.set(id, value), log(`varbit ${id}=${value}`), sender),
    sendConfig: (id, value) => (log(`varp ${id}=${value}`), sender),
    sendString: (text, uid) => (log(`text ${uid & 0xffff}=${text}`), sender),
    sendInterface: (id) => ((open = id), log(`open ${id}`), sender),
    sendSubInterface: (_target, id) => (log(`open side ${id}`), sender),
    closeSubInterface: () => sender,
    sendInterfaceRemoval: () => ((open = -1), log("close"), sender),
    sendClientScript: (id, ...args) => (log(`script ${id} [${args}]`), sender),
    sendSoundEffect: (id) => (log(`sound ${id}`), sender),
  };
  const p = {
    getEquipment: () => ({ get: () => item(weapon), getItems: () => [item(weapon)] }),
    getInventory: () => ({ getItems: () => inventory.map(item) }),
    getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (message) => log(message),
    performGraphic: (graphic) => log(`gfx ${graphic.getId()}`),
    performAnimation: (animation) => log(`anim ${animation.getId()}${animation.getDelay() ? ` delay ${animation.getDelay()}` : ""}`),
    getLocation: () => location,
    getInterfaceId: () => open,
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setLocation: (to) => { location = to; log(`step ${to.getX()},${to.getY()}`); },
    setWalkingDirection: (direction) => log(`walk ${direction === Direction.SOUTH ? "SOUTH" : "other"}`),
    moveTo: (to) => { location = to; log(`teleport ${to.getX()},${to.getY()}`); },
    isRegistered: () => true,
  };
  return { p, ticks, varbits, nextTick: () => ticks.push([]) };
}

function runTicks({ ticks, nextTick }, count) {
  for (let i = 0; i < count; i++) {
    TaskManager.process();
    nextTick();
  }
  return ticks;
}

/** The ring in the capture (ring-walk.txt), configured from the tile north of it. */
const RING = { x: 3129, y: 3496, z: 0 };
const click = (p, groupId, childId, option) => T.interfaceAction({ player: p, groupId, childId, option, handled: false });

test("the cache's fairy ring table: 64 combinations, as captured for AJR and AJQ", () => {
  const rings = T.rings();
  assert.equal(rings.size, 64);
  const ajr = rings.get("AJR");
  assert.deepEqual([ajr.destination.getX(), ajr.destination.getY(), ajr.index, ajr.destinationId], [2780, 3613, 14, 32]);
  const ajq = rings.get("AJQ");
  assert.deepEqual([ajq.index, ajq.destinationId, ajq.logText], [15, 33, "<br>Dungeons: Dorgesh-Kaan cave"]);
  assert.equal(rings.get("AIP").destination, null, "a combination with no destination");
});

test("the dials count anticlockwise: AJR is 0 3 2, AJQ 0 3 3", () => {
  const { p, varbits } = player();
  T.setDials(p, "AJR");
  assert.deepEqual(T.DIAL_VARBITS.map((v) => varbits.get(v)), [0, 3, 2]);
  assert.equal(T.codeFromDials(p), "AJR");
  T.setDials(p, "AJQ");
  assert.deepEqual(T.DIAL_VARBITS.map((v) => varbits.get(v)), [0, 3, 3]);
});

test("a fairy ring needs fairy magic wielded, not carried", () => {
  const carried = player({ weapon: -1, inventory: [DRAMEN_STAFF] });
  T.openDial({ player: carried.p });
  assert.deepEqual(carried.ticks.flat(), ["The fairy ring only works for those who wield fairy magic."]);
});

test("Configure: the travel log with the codes used, the backdrop, both interfaces, busy a tick later", () => {
  const rec = player();
  rec.p.setAttribute(T.USED_CODES_ATTRIBUTE, "AIQ");
  T.openDial({ player: rec.p, location: RING });
  const sent = rec.ticks.flat();
  assert.ok(sent.includes("text 14=<br>Asgarnia: Mudskipper Point "), "a used code");
  assert.ok(sent.includes("text 24="), "an unused one is blank");
  assert.ok(sent.includes("text 140=<col=ffffff>AIR</col> DLR DJQ AJS<br><col=ff981f>Fairy Queen's Hideout</col>"));
  assert.deepEqual(sent.slice(-3), ["script 917 [4212288,50]", "open 398", "open side 381"]);
  assert.ok(!sent.includes("varbit 12393=1"));
  rec.nextTick();
  assert.deepEqual(runTicks(rec, 1)[1], ["varbit 12393=1"]);
});

test("the rotate buttons turn a dial", () => {
  const { p, varbits } = player();
  click(p, 398, 20);
  assert.equal(varbits.get(3985), 3, "counter-clockwise from 0");
  click(p, 398, 19);
  assert.equal(varbits.get(3985), 0, "clockwise back");
});

test("closing the dials closes the travel log's search and clears busy", () => {
  const { p, ticks } = player();
  T.interfaceClosed({ player: p, interfaceId: 398 });
  assert.deepEqual(ticks.flat(), ["script 101 [28]", "varbit 12393=0"]);
});

test("Confirm: the last destination, a step onto the ring, then the fairy teleport (as captured)", () => {
  const rec = player({ at: new Location(RING.x, RING.y + 1, 0) });
  T.openDial({ player: rec.p, location: RING });
  T.setDials(rec.p, "AJR");
  rec.ticks.length = 0;
  rec.ticks.push([]);
  click(rec.p, 398, 26);
  const ticks = runTicks(rec, 6);
  assert.deepEqual(ticks[0], ["close", "varp 817=32", "varbit 5374=14", "varbit 20251=78", `step ${RING.x},${RING.y}`, "walk SOUTH"]);
  assert.deepEqual(ticks[1], ["varbit 12393=1", "gfx 569", "anim 3265 delay 30", "sound 1098"]);
  assert.deepEqual(ticks[4], ["teleport 2780,3613", "anim 3266"]);
  assert.deepEqual(ticks[5], ["varbit 12393=0", "anim 65535"]);
  assert.equal(rec.p.getAttribute(T.USED_CODES_ATTRIBUTE), "AJR", "now in the travel log");
});

test("AJQ warns a player without a light source; No cancels, a lit candle skips it", () => {
  const dark = player();
  T.setDials(dark.p, "AJQ");
  click(dark.p, 398, 26);
  assert.deepEqual(dark.ticks.flat().slice(-2), ["script 2524 [-1,-1]", "open 578"]);
  assert.equal(dark.varbits.get(3865), 1);
  click(dark.p, 578, 18);
  assert.equal(dark.varbits.get(12393), 0);
  assert.ok(!runTicks(dark, 6).flat().some((e) => e.startsWith("teleport")));

  const forId = ItemDefinition.forId;
  ItemDefinition.forId = (id) => (id === LIT_CANDLE ? { getName: () => "Lit candle" } : forId(id));
  try {
    const lit = player({ inventory: [LIT_CANDLE] });
    T.setDials(lit.p, "AJQ");
    click(lit.p, 398, 26);
    assert.ok(!lit.ticks.flat().includes("open 578"));
    assert.ok(runTicks(lit, 6).flat().includes("teleport 2735,5221"));
  } finally {
    ItemDefinition.forId = forId;
  }
});

test("Last-destination goes at once; to the ring you stand on, it only plays the animation", () => {
  const away = player();
  away.p.setAttribute(T.LAST_CODE_ATTRIBUTE, "AJR");
  // A ring's option runs on the player's turn, after the tick's tasks: the next run is tick 1.
  T.lastDestination({ player: away.p });
  away.nextTick();
  assert.deepEqual(away.ticks[0], ["varbit 12393=1", "gfx 569", "anim 3265 delay 30", "sound 1098"]);
  const ticks = runTicks(away, 5);
  assert.deepEqual(ticks[3], ["teleport 2780,3613", "anim 3266"]);
  assert.deepEqual(ticks[4], ["varbit 12393=0", "anim 65535"]);

  const beside = player({ at: new Location(RING.x, RING.y + 1, 0) });
  beside.p.setAttribute(T.LAST_CODE_ATTRIBUTE, "AJR");
  T.lastDestination({ player: beside.p, location: RING });
  beside.nextTick();
  assert.deepEqual(beside.ticks[0], [`step ${RING.x},${RING.y}`, "walk SOUTH"], "a step onto the ring first");
  assert.deepEqual(runTicks(beside, 1)[1], ["varbit 12393=1", "gfx 569", "anim 3265 delay 30", "sound 1098"]);

  const here = player({ at: new Location(2780, 3613, 0) });
  here.p.setAttribute(T.LAST_CODE_ATTRIBUTE, "AJR");
  T.lastDestination({ player: here.p });
  here.nextTick();
  const sent = runTicks(here, 5).flat();
  assert.ok(!sent.some((e) => e.startsWith("teleport")) && sent.includes("anim 3266"));
});

test("travel log favourites: add from a code's star, use and remove them", () => {
  const { p, varbits } = player();
  const aiq = T.rings().get("AIQ");
  click(p, 381, aiq.starComponent);
  assert.equal(p.getAttribute(T.FAVOURITES_ATTRIBUTE), "AIQ");
  click(p, 381, 141, "Use code");
  assert.equal(T.codeFromDials(p), "AIQ");
  click(p, 381, 161);
  assert.equal(p.getAttribute(T.FAVOURITES_ATTRIBUTE), "");
  void varbits;
});
