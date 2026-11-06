// Run after `yarn build`: node --test tests/tourist-trap-mine-door.test.cjs
//
// The mine door's landing, by real packets and real walks of the map's clipping. The landing tile north of the inner
// door is ours, inferred from clipping: no capture or source gives it. Bots off. No client ran.
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
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const NORTH_OF_DOOR = [3279, 9427];
const GUARD = [3279, 9416];
const LEG = 12;

let core;
let next = 7530;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  for (const [x, y] of [[3279, 9420], [3302, 3036], [3279, 3017]]) core.RegionManager.loadMapFiles(x, y);
});
after(() => PM.emitServerShutdown({}));

const quest = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_tourist_trap");

function actor(t, x, y, stage) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("mineqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const npcs = [];
  t.after(() => {
    npcs.forEach((npc) => core.World.getNpcs().remove(npc));
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  quest().setStage(p, stage);
  const { Equipment, Item, ItemIdentifiers: I } = core;
  p.getEquipment().setItem(Equipment.BODY_SLOT, new Item(I.SLAVE_SHIRT, 1));
  p.getEquipment().setItem(Equipment.LEG_SLOT, new Item(I.SLAVE_ROBE, 1));
  p.getEquipment().setItem(Equipment.FEET_SLOT, new Item(I.SLAVE_BOOTS, 1));
  return { p, c, messages, npcs };
}

const at = (f) => [f.p.getLocation().getX(), f.p.getLocation().getY()];

/** Sends a packet and runs world ticks, ending each as the world does, until done or out of ticks. */
async function send(f, packet, done, limit = 40) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < limit; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
    f.p.resetUpdating();
    if (done()) return true;
  }
  return false;
}

/** The shortest clipped path from the player to the tile, or null when the map doesn't connect them. */
function pathTo(f, x, y) {
  const R = core.RegionManager;
  const z = f.p.getLocation().getZ();
  const [sx, sy] = at(f);
  const from = new Map([[`${sx},${sy}`, null]]);
  const tiles = [[sx, sy]];
  for (let i = 0; i < tiles.length; i++) {
    const [cx, cy] = tiles[i];
    if (cx === x && cy === y) {
      const route = [];
      for (let key = `${x},${y}`; key; key = from.get(key)) route.unshift(key.split(",").map(Number));
      return route;
    }
    const here = new core.Location(cx, cy, z);
    for (const [nx, ny, blocked] of [
      [cx, cy + 1, R.blockedNorth], [cx + 1, cy, R.blockedEast], [cx, cy - 1, R.blockedSouth], [cx - 1, cy, R.blockedWest],
    ]) {
      if (Math.abs(nx - sx) > 96 || Math.abs(ny - sy) > 96 || from.has(`${nx},${ny}`)) continue;
      if (blocked.call(R, here, null)) continue;
      from.set(`${nx},${ny}`, `${cx},${cy}`);
      tiles.push([nx, ny]);
    }
  }
  return null;
}

/** Walks there with the move packets a client sends, a screen's worth at a time. */
async function walk(f, x, y) {
  const route = pathTo(f, x, y);
  assert.ok(route, `the map connects ${at(f)} to ${x},${y}`);
  for (let i = LEG; ; i += LEG) {
    const [lx, ly] = route[Math.min(i, route.length - 1)];
    const arrived = await send(f, { type: "move", worldX: lx, worldY: ly, modifierFlags: 0 }, () => at(f)[0] === lx && at(f)[1] === ly);
    assert.ok(arrived, `walked to ${lx},${ly}, stopped at ${at(f)}`);
    if (i >= route.length - 1) return route.length;
  }
}

const click = (id, x, y, clickType = 1) => ({ type: "object_option", id, x, y, clickType });

async function giveGuardThePineapple(t, f) {
  const I = core.ItemIdentifiers;
  f.p.getInventory().setItem(0, new core.Item(I.TENTI_PINEAPPLE, 1));
  const guard = core.NPC.create(4667, new core.Location(GUARD[0], GUARD[1], 0));
  core.World.getNpcs().add(guard);
  f.npcs.push(guard);
  const steps = await walk(f, GUARD[0], GUARD[1] + 1);
  t.diagnostic(`walked ${steps} tiles to beside the guard`);
  const stage = () => quest().getStage(f.p);
  const done = await send(f, {
    type: "item_on_npc", targetIndex: guard.getIndex(), itemId: I.TENTI_PINEAPPLE,
    slot: f.p.getInventory().getSlotForItemId(I.TENTI_PINEAPPLE), widgetId: 149 << 16,
  }, () => stage() >= 17);
  assert.ok(done, `the guard takes the pineapple: ${f.messages}`);
}

/** The cave's west side, by the guards. Needs stage 17. Lands in the deep mine. */
async function intoTheCave(f) {
  const done = await send(f, click(2698, 3281, 9414), () => quest().getStage(f.p) >= 18);
  assert.ok(done, `the cave lets the player through from ${at(f)}: ${f.messages}`);
  assert.deepEqual(at(f), [3284, 9414]);
}

// Control: north of the door, with no help from the landing. Passes with or without the fix.
test("control: north of the inner door the map walks to the guard and through the cave", async (t) => {
  const f = actor(t, NORTH_OF_DOOR[0], NORTH_OF_DOOR[1], 16);
  await giveGuardThePineapple(t, f);
  await intoTheCave(f);
});

test("control: north of the inner door, the door leads to the surface", async (t) => {
  const f = actor(t, NORTH_OF_DOOR[0], NORTH_OF_DOOR[1], 16);
  const done = await send(f, click(2691, 3279, 9426), () => f.p.getLocation().getY() < 9000);
  assert.ok(done, `the door works from the north side: ${at(f)} ${f.messages}`);
  assert.deepEqual(at(f), [3279, 3029]);
});

test("The Tourist Trap: the mine door lands where the player can walk to the guard and the cave", async (t) => {
  const f = actor(t, 3302, 3035, 16);
  const entered = await send(f, click(2676, 3302, 3036), () => f.p.getLocation().getY() > 9000);
  assert.ok(entered, `the surface door lets a slave in: ${at(f)} ${f.messages}`);
  assert.ok(f.messages.includes("The doors open with some effort!"), f.messages.join(" | "));
  await giveGuardThePineapple(t, f);
  await intoTheCave(f);
});

test("The Tourist Trap: and back out by the door it came through", async (t) => {
  const f = actor(t, 3302, 3035, 16);
  await send(f, click(2676, 3302, 3036), () => f.p.getLocation().getY() > 9000);
  const left = await send(f, click(2691, 3279, 9426), () => f.p.getLocation().getY() < 9000);
  assert.ok(left, `the inner door works from the landing: ${at(f)} ${f.messages}`);
  assert.deepEqual(at(f), [3279, 3029]);
});

test("The Tourist Trap: from stage 23 the cave returns to where the door and the winch can be reached", async (t) => {
  const f = actor(t, 3284, 9414, 23);
  const stage = () => quest().getStage(f.p);
  const back = await send(f, click(2699, 3283, 9414), () => f.p.getLocation().getX() < 3283);
  assert.ok(back, `the cave lets the player back: ${at(f)} ${f.messages}`);
  const up = await send(f, click(2691, 3279, 9426), () => f.p.getLocation().getY() < 9000);
  assert.ok(up, `the door works from where the cave leaves the player: ${at(f)} ${f.messages}`);
  const options = core.ObjectDefinition.forPlayer(18888, f.p).getInteractions();
  const done = await send(f, click(18888, 3279, 3017, options.indexOf("Operate") + 1), () => stage() >= 24);
  assert.ok(done, `the winch works on foot from the camp: ${at(f)} ${f.messages}`);
});
