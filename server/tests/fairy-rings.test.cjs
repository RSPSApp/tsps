// Run after `yarn build`: node --test tests/fairy-rings.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Location } = require("../dist/game/model/Location");
const { Direction } = require("../dist/game/model/Direction");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { TeleportHandler } = require("../dist/game/model/teleportation/TeleportHandler");
const realTeleportCheck = TeleportHandler.checkReqs;
const FairyRings = require("../plugins/world/FairyRings.plugin");

const T = FairyRings._test;
const DRAMEN_STAFF = 772;
const LIT_CANDLE = 33;
let core;
let canAttackHook;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  // As the real check: an open interface means busy.
  TeleportHandler.checkReqs = (player) => !(player.getInterfaceId() > 0);
  FairyRings.register({
    core, persistAttribute() {}, onObjectInteraction() {}, onInterfaceActionClick() {},
    onCustomEvent() {}, emitCustomEvent() {}, onPlayerLogin() {}, onCanAttack: handler => { canAttackHook = handler; }, log() {},
  });
});

test('Gorak-plane fairy ring centre protects its occupant from NPC attacks', () => {
  const gorakRing = T.rings().get('DIR');
  assert.ok(gorakRing?.destination, 'DIR resolves to the Gorak-plane fairy ring');
  const target = { isPlayer: () => true, getLocation: () => gorakRing.destination };
  const attacker = { isNpc: () => true };
  const centre = { attacker, target, allow: null };
  canAttackHook(centre);
  assert.equal(centre.allow, false);

  const adjacent = new Location(gorakRing.destination.getX() + 1, gorakRing.destination.getY(), gorakRing.destination.getZ());
  const outside = { attacker, target: { ...target, getLocation: () => adjacent }, allow: null };
  canAttackHook(outside);
  assert.equal(outside.allow, null, 'the protection applies only on the ring tile');
});

/** A player recording, per tick, what the server sends. */
function player({ weapon = DRAMEN_STAFF, inventory = [], at = new Location(3129, 3496, 0), privateArea: initialPrivateArea = null } = {}) {
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const varbits = new Map();
  const attributes = new Map();
  let location = at;
  let teleportSerial = 0;
  let privateArea = initialPrivateArea;
  let hitpoints = 10;
  let dyingReturn = false;
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
    getTeleportSerial: () => teleportSerial,
    getPrivateArea: () => privateArea,
    getHitpoints: () => hitpoints,
    isDyingReturn: () => dyingReturn,
    getInterfaceId: () => open,
    getMovementQueue: () => ({ reset() {}, handleRegionChange() {} }),
    setLocation: (to) => { location = to; log(`step ${to.getX()},${to.getY()}`); },
    setWalkingDirection: (direction) => log(`walk ${direction === Direction.SOUTH ? "SOUTH" : "other"}`),
    moveTo: (to) => { teleportSerial++; location = to; log(`teleport ${to.getX()},${to.getY()}`); },
    isRegistered: () => true,
  };
  return {
    p, ticks, varbits,
    setPrivateArea: (value) => { privateArea = value; },
    setHitpoints: (value) => { hitpoints = value; },
    setDyingReturn: (value) => { dyingReturn = value; },
    nextTick: () => ticks.push([]),
  };
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
const click = (p, groupId, childId, option, action) => T.interfaceAction({ player: p, groupId, childId, option, action, handled: false });

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

test("pending AIR and BIS fairy travel stops after teleport, movement, private-area change, or death", () => {
  const originalEmit = core.PluginManager.emitCustomEvent;
  const arrivals = [];
  core.PluginManager.emitCustomEvent = function (name, payload) {
    if (name === "teleport:landed" && payload?.source === "fairy-ring") arrivals.push(payload);
    return originalEmit.call(this, name, payload);
  };
  try {
    for (const code of ["AIR", "BIS"]) {
      for (const interruption of ["teleport", "movement", "private area", "death", "stale destination"]) {
        const rec = player({
          at: new Location(2600, 3200, 0),
          privateArea: interruption === "private area" ? {} : null,
        });
        const destination = T.rings().get(code).destination;
        T.setDials(rec.p, code);
        T.confirmDial(rec.p);
        runTicks(rec, 1);

        if (interruption === "teleport") rec.p.moveTo(new Location(3000, 3000, 0));
        else if (interruption === "movement") rec.p.setLocation(new Location(2601, 3200, 0));
        else if (interruption === "private area") rec.setPrivateArea(null);
        else if (interruption === "stale destination") rec.p.setLocation(destination);
        else {
          rec.setHitpoints(0);
          rec.setDyingReturn(true);
          T.playerDied({ player: rec.p });
        }
        const before = arrivals.length;
        runTicks(rec, 6);
        assert.equal(arrivals.length, before, `${code} travel stopped after ${interruption}`);
        if (interruption !== "stale destination") {
          assert.notDeepEqual(
            [rec.p.getLocation().getX(), rec.p.getLocation().getY(), rec.p.getLocation().getZ()],
            [destination.getX(), destination.getY(), destination.getZ()],
            `${code} travel did not move after ${interruption}`,
          );
        }
        assert.equal(rec.p.getAttribute(T.USED_CODES_ATTRIBUTE), undefined, `${code} was not recorded after ${interruption}`);
        assert.equal(rec.varbits.get(12393), 0, "the cancelled travel releases the busy state");
      }
    }
  } finally {
    core.PluginManager.emitCustomEvent = originalEmit;
  }
});

test("AIR travel reports its original public location and instance status only after arrival", () => {
  const ring = T.rings().get("AIR");
  const rec = player({ at: new Location(2600, 3200, 0) });
  const arrivals = [];
  const originalEmit = core.PluginManager.emitCustomEvent;
  core.PluginManager.emitCustomEvent = function (name, payload) {
    if (name === "teleport:landed" && payload?.source === "fairy-ring") arrivals.push(payload);
    return originalEmit.call(this, name, payload);
  };
  try {
    T.setDials(rec.p, "AIR");
    T.confirmDial(rec.p);
    runTicks(rec, 6);
  } finally {
    core.PluginManager.emitCustomEvent = originalEmit;
  }
  assert.equal(arrivals.length, 1);
  assert.equal(arrivals[0].code, "AIR");
  assert.equal(arrivals[0].fromInstance, false);
  assert.deepEqual([arrivals[0].from.getX(), arrivals[0].from.getY(), arrivals[0].from.getZ()], [2600, 3200, 0]);
  assert.deepEqual([rec.p.getLocation().getX(), rec.p.getLocation().getY(), rec.p.getLocation().getZ()],
    [ring.destination.getX(), ring.destination.getY(), ring.destination.getZ()]);
});

test("an old AIR task cannot clear a replacement BIS token or revive a cancelled trip", () => {
  const arrivals = [];
  const originalEmit = core.PluginManager.emitCustomEvent;
  core.PluginManager.emitCustomEvent = function (name, payload) {
    if (name === "teleport:landed" && payload?.source === "fairy-ring") arrivals.push(payload);
    return originalEmit.call(this, name, payload);
  };
  try {
    const replaced = player({ at: new Location(2600, 3200, 0) });
    T.setDials(replaced.p, "AIR");
    T.confirmDial(replaced.p);
    T.setDials(replaced.p, "BIS");
    T.confirmDial(replaced.p);
    runTicks(replaced, 1);

    replaced.setHitpoints(0);
    replaced.setDyingReturn(true);
    T.playerDied({ player: replaced.p });
    replaced.setHitpoints(10);
    replaced.setDyingReturn(false);
    runTicks(replaced, 6);
    assert.equal(arrivals.length, 0, "the cancelled BIS trip stays cancelled after revival");
    assert.equal(replaced.p.getAttribute(T.USED_CODES_ATTRIBUTE), undefined);

    const fresh = player({ at: new Location(2600, 3200, 0) });
    T.setDials(fresh.p, "BIS");
    T.confirmDial(fresh.p);
    runTicks(fresh, 6);
    assert.equal(arrivals.length, 1, "a new valid BIS trip still lands");
    assert.equal(arrivals[0].code, "BIS");
    assert.equal(fresh.p.getAttribute(T.USED_CODES_ATTRIBUTE), "BIS");
  } finally {
    core.PluginManager.emitCustomEvent = originalEmit;
  }
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

test("the rings' Zanaris, Configure and Last-destination options, as the cache names them, have handlers", () => {
  const options = T.ringOptions();
  // 29495: the common ring; 29560: Zanaris' ring (no Zanaris option).
  for (const id of [29495, 29560]) {
    const actions = CacheDefinitions.getObject(id).actions;
    for (const action of actions.slice(0, 3).filter(Boolean)) {
      assert.equal(typeof options[action], "function", `${id}: ${action}`);
    }
  }
  assert.equal(options["Last-destination"], T.lastDestination);
});

test("Zanaris' exit rings: Use teleports out without a staff (as captured for the shed ring)", () => {
  const options = T.ringOptions();
  for (const id of [core.ObjectIdentifiers.FAIRY_RING_3, core.ObjectIdentifiers.FAIRY_RING_2]) {
    assert.equal(CacheDefinitions.getObject(id).actions[0], "Use");
    assert.equal(options.Use, T.useExitRing);
  }
  const shed = { x: 2452, y: 4473, z: 0 };
  const rec = player({ weapon: -1, at: new Location(shed.x, shed.y, shed.z) });
  T.useExitRing({ player: rec.p, objectId: core.ObjectIdentifiers.FAIRY_RING_3, location: shed });
  rec.nextTick();
  const sent = runTicks(rec, 5).flat();
  assert.deepEqual(sent.slice(0, 4), ["varbit 12393=1", "gfx 569", "anim 3265 delay 30", "sound 1098"]);
  assert.ok(sent.includes("teleport 3201,3169"), sent.join(" | "));
  assert.equal(rec.p.getAttribute(T.USED_CODES_ATTRIBUTE), undefined, "not a travel log code");

  const market = { x: 2486, y: 4471, z: 0 };
  const out = player({ weapon: -1, at: new Location(market.x, market.y, market.z) });
  T.useExitRing({ player: out.p, objectId: core.ObjectIdentifiers.FAIRY_RING_2, location: market });
  assert.ok(runTicks(out, 6).flat().includes("teleport 3260,3171"));
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

test("travel log right-click ops: op2 adds or removes a favourite without moving the dials, op1 uses the code", () => {
  const { p } = player();
  const rings = T.rings();
  const aiq = rings.get("AIQ"), djr = rings.get("DJR");
  click(p, 381, djr.logComponent, undefined, 1);
  assert.equal(T.codeFromDials(p), "DJR", "op1 Use code");
  // IF_BUTTON2 carries no menu text: "Add Favourite" is op2 alone.
  click(p, 381, aiq.logComponent, undefined, 2);
  assert.equal(p.getAttribute(T.FAVOURITES_ATTRIBUTE), "AIQ");
  assert.equal(T.codeFromDials(p), "DJR", "adding doesn't set the dials");
  click(p, 381, 141, undefined, 1);
  assert.equal(T.codeFromDials(p), "AIQ", "op1 on a favourite uses it");
  click(p, 381, 141, undefined, 2);
  assert.equal(p.getAttribute(T.FAVOURITES_ATTRIBUTE), "", "op2 Remove Favourite");
  assert.equal(T.codeFromDials(p), "AIQ");
});

test('database table indexing skips mixed tuple values without changing decoded rows', () => {
  const { DbRowType } = require('../dist/game/cache/codec/rs/config/dbrow/DbRowType');
  // Column 0: (string type 36, int, string type 42), two tuples, then table 300.
  const data = Int8Array.from([3, 1, 0, 3, 36, 0, 42, 2,
    65, 0, 0, 0, 0, 7, 66, 0,
    0, 255, 255, 255, 255, 67, 0,
    255, 4, 172, 2, 0]);
  assert.equal(DbRowType.readTableId(data), 300);
  const row = DbRowType.decode(123, data);
  assert.equal(row.tableId, 300);
  assert.deepEqual(row.column(0), ['A', 7, 'B', '', -1, 'C']);
  assert.equal(DbRowType.readTableId(Int8Array.of(0)), -1);
});

test('cache table queries decode only requested rows and reuse individual row objects', () => {
  const { CacheDefinitions } = core;
  const { DbRowType } = require('../dist/game/cache/codec/rs/config/dbrow/DbRowType');
  const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
  const { IndexType } = require('../dist/game/cache/codec/rs/cache/IndexType');
  const { ConfigType } = require('../dist/game/cache/codec/rs/cache/ConfigType');
  const archive = CacheIndexDat2.fromStore(IndexType.DAT2.configs, CachePipeline.getStore()).getArchive(ConfigType.OSRS.dbRow);
  const expectedByTable = new Map();
  for (const id of archive.fileIds) {
    const row = DbRowType.decode(id, archive.getFile(id).data);
    assert.equal(DbRowType.readTableId(archive.getFile(id).data), row.tableId, `row ${id}`);
    if (!expectedByTable.has(row.tableId)) expectedByTable.set(row.tableId, []);
    expectedByTable.get(row.tableId).push(id);
  }
  const table = [...expectedByTable.keys()].find(id => !CacheDefinitions.dbTables.has(id));
  const expectedIds = expectedByTable.get(table);
  const before = new Set(CacheDefinitions.dbRows.keys());
  const individual = CacheDefinitions.getDbRow(expectedIds[0]);
  assert.equal(CacheDefinitions.dbRows.size, before.size + (before.has(individual.id) ? 0 : 1));
  const rows = CacheDefinitions.getDbTableRows(table);
  assert.deepEqual(rows.map(row => row.id), expectedIds);
  assert.equal(rows[0], individual);
  assert.equal(CacheDefinitions.getDbTableRows(table), rows);
  assert.equal(CacheDefinitions.dbRows.size, new Set([...before, ...expectedIds]).size);
  const count = CacheDefinitions.dbRows.size;
  assert.equal(CacheDefinitions.getDbRow(-1), undefined);
  assert.deepEqual(CacheDefinitions.getDbTableRows(-999), []);
  assert.equal(CacheDefinitions.dbRows.size, count);
});

// The route below uses the real quest, named object/native button dispatch, Player,
// teleport checks/tasks and zone-enter consumer. It never fixture-teleports into the hideout.
test('Fairytale II: permission and the four-code hideout route through real ring travel', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const runtime = require('../plugins/quests/QuestRuntime');
  core.ObjectDefinition.init();
  core.RegionManager.init();
  TeleportHandler.checkReqs = realTeleportCheck;
  require('../plugins/quests/quests/FairytaleIICureAQueen.Quest')(PluginManager.createApi('FairytaleIIRouteTest'));
  FairyRings.register(PluginManager.createApi('FairyRingsRouteTest'));
  const quest = runtime.getRegisteredQuests().findLast(q => q.key === 'fairytale_ii_cure_a_queen');
  const I = core.ItemIdentifiers;
  const COMMON_RING = 29495;
  assert.equal(core.ObjectDefinition.forId(COMMON_RING).getName(), 'Fairy ring');
  assert.equal(core.ObjectDefinition.forId(COMMON_RING).getSizeX(), 1);
  assert.equal(core.ObjectDefinition.forId(COMMON_RING).getSizeY(), 1);
  let index = 2700;
  function actor(t, { certificate = true, study = true, sign = true, permission = true } = {}) {
    const packets = [], messages = [];
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: packet => { packets.push(packet); return true; }, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel)).setUsername(`ringroute${index}`).setIndex(index++);
    p.setRegistered(true);
    p.setLocation(new Location(RING.x, RING.y));
    p.setNeedsPlacement(false);
    p.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(I.DRAMEN_STAFF));
    p.sendMessage = text => messages.push(text);
    quest.setStage(p, 30);
    if (certificate || study) p.getInventory().adds(I.NUFFS_CERTIFICATE, 1);
    if (study) assert.equal(PluginManager.emitItemAction({ player: p, item: p.getInventory().get(0), slot: 0,
      itemId: I.NUFFS_CERTIFICATE, clickType: 2, option: 'Study', handled: false }), true);
    p.closeInterruptibleInterfaces();
    if (sign) {
      const id = core.ObjectIdentifiers.RUNE_TEMPLE_SIGN;
      objectAction(p, id, new Location(2409, 4369), 'Read');
      assert.equal(p.getPacketSender().getVarbit(2338), 4);
      p.closeInterruptibleInterfaces();
    }
    if (permission) PluginManager.emitCustomEvent('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.FAIRY_GODFATHER, option: 'Yes, okay.' });
    if (!certificate) p.getInventory().deleteNumber(I.NUFFS_CERTIFICATE, 1);
    t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() }); });
    return { p, packets, messages };
  }
  function objectAction(p, id, location, option) {
    const definition = core.ObjectDefinition.forId(id);
    return PluginManager.emitObjectInteraction({ player: p, objectId: id, object: new core.GameObject(id, location, 10, 0),
      definition, location: { x: location.getX(), y: location.getY(), z: location.getZ() },
      clickType: definition.getActions().indexOf(option) + 1, handled: false });
  }
  function button(p, child) {
    assert.equal(PluginManager.emitInterfaceActionClick({ player: p, groupId: 398, childId: child,
      buttonId: (398 << 16) | child, action: 1, handled: false }), true);
  }
  function dial(p, code, confirm = true) {
    assert.equal(objectAction(p, COMMON_RING, p.getLocation(), 'Configure'), true);
    assert.equal(p.getInterfaceId(), 398, 'Godfather permission unlocks the native dials before completion');
    // Click the actual anticlockwise dial buttons instead of setting their varbits.
    for (let i = 0; i < 3; i++) for (let n = 0; n < T.DIAL_LETTERS[i].indexOf(code[i]); n++) button(p, 19 + i * 2);
    assert.equal(T.codeFromDials(p), code);
    button(p, confirm ? 26 : 27);
  }
  function ticks(p, count = 6) {
    for (let n = 0; n < count; n++) {
      core.TaskManager.process();
      PluginManager.emitPlayerProcess({ player: p });
      p.setNeedsPlacement(false); // ordinary post-update placement acknowledgment
    }
  }
  function travel(p, code) { dial(p, code); ticks(p); }
  function at(p) { const l = p.getLocation(); return [l.getX(), l.getY(), l.getZ()]; }
  function route(p) { for (const code of ['AIR', 'DLR', 'DJQ', 'AJS']) travel(p, code); }

  await t.test('permission, AIR → DLR → no-trip DJQ → hideout AJS advances the real zone stage', async t => {
    const { p, packets } = actor(t);
    const connection = new ClientConnection(p.getSession().getChannel());
    connection.player = p;
    const nativeClick = async childId => {
      await connection.dispatch([{ type: 'widget_action', widgetId: (398 << 16) | childId, groupId: 398, childId, buttonNum: 1 }]);
      connection.processTurnPackets();
    };
    const nativeTravel = async code => {
      objectAction(p, COMMON_RING, p.getLocation(), 'Configure');
      assert.equal(p.getInterfaceId(), 398);
      for (let i = 0; i < 3; i++) for (let n = 0; n < T.DIAL_LETTERS[i].indexOf(code[i]); n++) await nativeClick(19 + i * 2);
      assert.equal(T.codeFromDials(p), code);
      await nativeClick(26); ticks(p);
    };
    assert.equal(quest.getStage(p), 40);
    assert.equal(p.getPacketSender().getVarbit(2329), 2);
    await nativeTravel('AIR'); assert.deepEqual(at(p), [2700, 3247, 0]);
    await nativeTravel('DLR'); assert.deepEqual(at(p), [2213, 3099, 0]);
    await nativeTravel('DJQ'); assert.deepEqual(at(p), [2213, 3099, 0], 'DJQ has no invented destination');
    assert.equal(quest.getStage(p), 40);
    await nativeTravel('AJS'); assert.deepEqual(at(p), [2328, 4426, 0]);
    assert.equal(quest.getStage(p), 45, 'real teleport landing enters the existing hideout zone');
    p.getSession().flushPackets();
    assert.ok(packets.length > 0, 'actual PacketSender encoded native dial and animation updates');
    travel(p, 'AJS'); assert.deepEqual(at(p), [2500, 3896, 0], 'a second AJS requires the sequence again');
    route(p); assert.deepEqual(at(p), [2328, 4426, 0], 'the full sequence works again for a later visit');
  });
  await t.test('ordinary AJS, wrong code and a fresh AIR restart preserve ordinary destinations', t => {
    const { p } = actor(t);
    travel(p, 'AJS'); assert.deepEqual(at(p), [2500, 3896, 0]);
    travel(p, 'AIR'); travel(p, 'DLR'); travel(p, 'AJR'); travel(p, 'DJQ'); travel(p, 'AJS');
    assert.deepEqual(at(p), [2500, 3896, 0]);
    travel(p, 'AIR'); travel(p, 'DLR'); travel(p, 'AIP'); travel(p, 'DJQ'); travel(p, 'AJS');
    assert.deepEqual(at(p), [2500, 3896, 0], 'an unused combination also breaks the sequence');
    travel(p, 'AIR'); route(p); assert.deepEqual(at(p), [2328, 4426, 0]);
  });
  for (const [name, options] of [['certificate', { certificate: false }], ['study', { study: false, sign: false }], ['sign', { sign: false }]]) {
    await t.test(`missing ${name} keeps AJS at its ordinary island`, t => {
      const { p } = actor(t, options); route(p);
      assert.deepEqual(at(p), [2500, 3896, 0]); assert.equal(quest.getStage(p), 40);
    });
  }
  await t.test('completion removes the certificate/study/sign requirement, but keeps all four codes', t => {
    const { p } = actor(t, { certificate: false, study: false, sign: false });
    quest.setStage(p, quest.completionValue);
    travel(p, 'AJS'); assert.deepEqual(at(p), [2500, 3896, 0]);
    route(p); assert.deepEqual(at(p), [2328, 4426, 0]);
  });
  await t.test('no permission and no staff still deny the network', t => {
    const { p } = actor(t, { permission: false });
    objectAction(p, COMMON_RING, p.getLocation(), 'Configure'); assert.notEqual(p.getInterfaceId(), 398);
    PluginManager.emitCustomEvent('npc-dialogue:choice', { player: p, npcId: core.NpcIdentifiers.FAIRY_GODFATHER, option: 'Yes, okay.' });
    p.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(-1));
    objectAction(p, COMMON_RING, p.getLocation(), 'Configure'); assert.notEqual(p.getInterfaceId(), 398);
  });
  await t.test('the equipped staff is checked again on Confirm', t => {
    const { p } = actor(t);
    objectAction(p, COMMON_RING, p.getLocation(), 'Configure');
    assert.equal(p.getInterfaceId(), 398);
    p.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(-1));
    button(p, 26); ticks(p); assert.deepEqual(at(p), [RING.x, RING.y, 0]);
  });
  await t.test('sequence state belongs to each player and logout clears an incomplete route', t => {
    const a = actor(t).p, b = actor(t).p;
    travel(a, 'AIR'); travel(a, 'DLR'); travel(a, 'DJQ');
    travel(b, 'AJS'); assert.deepEqual(at(b), [2500, 3896, 0], 'another player cannot borrow a prefix');
    travel(a, 'AJS'); assert.deepEqual(at(a), [2328, 4426, 0]);
    travel(a, 'AIR'); travel(a, 'DLR'); travel(a, 'DJQ');
    PluginManager.emitPlayerLogout({ player: a, username: a.getUsername() });
    travel(a, 'AJS'); assert.deepEqual(at(a), [2500, 3896, 0]);
  });
  await t.test('cancelled dials and blocked teleports do not advance the sequence', t => {
    const { p } = actor(t);
    travel(p, 'AIR'); dial(p, 'DLR', false); ticks(p);
    travel(p, 'DJQ'); travel(p, 'AJS'); assert.deepEqual(at(p), [2500, 3896, 0]);
    travel(p, 'AIR'); p.getMovementQueue().setBlockMovement(true); dial(p, 'DLR'); ticks(p);
    assert.deepEqual(at(p), [2700, 3247, 0]);
    p.getMovementQueue().setBlockMovement(false);
    travel(p, 'DJQ'); travel(p, 'AJS'); assert.deepEqual(at(p), [2500, 3896, 0]);
    route(p); assert.deepEqual(at(p), [2328, 4426, 0]);
  });
});
