// Run after `yarn build`: node --test tests/waterbirth-pressure-doors.test.cjs
//
// Waterbirth Island Dungeon's pressure-pad doors (plugins/areas/WaterbirthPressureDoors.plugin.js; rsprox.net
// recordings 86, 91, 1851, 1856, 1863, rev 227): dropping the pet rock on a pad makes NPC 5983 "Pet rock" there
// (anim 827), Take gives it back (sound 2582), Open from the west with both pads held swaps the door for loc 8963
// for 49 ticks, and Open from the east lines the player up, opens the door with inviswalls and walks them out.
//
// Real packets: inventory_action Drop, object_option and npc_option go through the connection to every plugin.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");

const PET_ROCK = 3695;
const ROCK_NPC = 5983;
const DOOR = 8958; // the south door, rows 10162-10164
const OPEN = 8963;
const INVISWALL = 38848;
const SOUTH_PAD = [2490, 10162];
const NORTH_PAD = [2490, 10164];

let core;
let next = 1;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2491, 10162);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const idsAt = (x, y, z = 0) => (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []).map((o) => o.getId());

function actor(t, at) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("wbqa" + next++);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const animations = [], sounds = [], messages = [];
  const performAnimation = p.performAnimation.bind(p);
  t.mock.method(p, "performAnimation", (animation) => { animations.push(animation.getId()); return performAnimation(animation); });
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  const sender = p.getPacketSender();
  const sendSoundEffect = sender.sendSoundEffect.bind(sender);
  t.mock.method(sender, "sendSoundEffect", (id, ...rest) => { sounds.push(id); return sendSoundEffect(id, ...rest); });
  // The pads look at the world's player list, so the fixture player joins it (add registers it).
  assert.ok(core.World.getPlayers().add(p), "the player joins the world list");
  // Joining the list starts a new account's onboarding, which holds world input; the MCP login skips it.
  PM.emitCustomEvent("account:skip-onboarding", { player: p });
  p.getPacketSender().sendInterfaceRemoval();
  p.needsPlacement = false; // onAdd asks for a placement update the fixture never sends
  assert.equal(p.busy(), false, "nothing open holds the clicks");
  const f = { p, c, inv: p.getInventory(), animations, sounds, messages, gone: false };
  f.logout = () => {
    if (f.gone) return;
    f.gone = true;
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (core.World.getPlayers().contains?.(p)) core.World.getPlayers().remove(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  };
  t.after(f.logout);
  return f;
}

function tick(fs, count = 1) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const f of fs) {
      if (f.gone) continue;
      f.c.processTurnPackets();
      f.p.getMovementQueue().process();
      core.TaskManager.processWalkTo(f.p.getIndex());
    }
    // The world cycle's NPC queues, which this fixture drives by hand.
    for (const npc of core.World.getAddNPCQueue().splice(0)) core.World.getNpcs().add(npc);
    for (const npc of core.World.getRemoveNPCQueue().splice(0)) if (npc.isRegistered()) core.World.getNpcs().remove(npc);
    for (const f of fs) f.p.resetUpdating();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const slotOf = (f, id) => f.inv.getItems().findIndex((item) => item?.getId() === id);
const drop = (f) => send(f, { type: "inventory_action", slot: slotOf(f, PET_ROCK), itemId: PET_ROCK, widgetId: 3214, option: "Drop" });
const openDoor = (f) => send(f, { type: "object_option", id: DOOR, x: 2491, y: 10162, clickType: 1 });

function rockNpc() {
  const rocks = require("../plugins/areas/WaterbirthPressureDoors.plugin")._test.rocks;
  return [...rocks.values()][0]?.npc ?? null;
}

function cleanup(t) {
  t.after(() => {
    const { rocks, openDoors } = require("../plugins/areas/WaterbirthPressureDoors.plugin")._test;
    for (const rock of rocks.values()) if (rock.npc.isRegistered()) core.World.getNpcs().remove(rock.npc);
    rocks.clear();
    openDoors.clear();
    core.TaskManager.cancelTasks?.("all");
    if (!idsAt(2491, 10162).includes(DOOR)) {
      for (const id of [OPEN, DOOR]) core.ObjectManager.deregister(new core.GameObject(id, new core.Location(2491, 10162, 0), 10, 1, null), true);
      core.ObjectManager.register(new core.GameObject(DOOR, new core.Location(2491, 10162, 0), 10, 1, null), true);
    }
  });
}

test("the doors and pads are where the captures saw them, in this cache's map", () => {
  assert.ok(idsAt(2491, 10162).includes(8958) && idsAt(2491, 10146).includes(8959) && idsAt(2491, 10130).includes(8960));
  assert.ok(idsAt(...SOUTH_PAD).includes(8964) || idsAt(...SOUTH_PAD).includes(8965), "a pad on the door's south row");
  assert.ok(idsAt(...NORTH_PAD).includes(8964) || idsAt(...NORTH_PAD).includes(8965), "a pad two rows north");
});

test("dropping the pet rock on a pad leaves a Pet rock NPC there; Take gives it back (captured)", async (t) => {
  cleanup(t);
  const f = actor(t, SOUTH_PAD);
  f.inv.add(new core.Item(PET_ROCK, 1), true);
  await drop(f);
  tick([f]);
  assert.equal(f.inv.getAmount(PET_ROCK), 0, "the rock leaves the inventory");
  assert.ok(f.animations.includes(827), "the drop animation");
  const npc = rockNpc();
  assert.equal(npc?.getId(), ROCK_NPC);
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], SOUTH_PAD);
  assert.ok(npc.isRegistered(), "the NPC is in the world");
  assert.equal(core.ItemOnGroundManager.getGroundItem?.(f.p.getUsername(), PET_ROCK, f.p.getLocation(), null) ?? null, null,
    "no ground item");

  const other = actor(t, [2489, 10162]);
  await send(other, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  tick([f, other], 2);
  assert.ok(npc.isRegistered(), "only the dropper picks it up (Ours)");

  f.p.setLocation(new core.Location(2489, 10163, 0));
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 });
  tick([f], 2);
  assert.equal(f.inv.getAmount(PET_ROCK), 1, "the rock returns");
  assert.ok(f.sounds.includes(2582), "the take sound");
  assert.equal(npc.isRegistered(), false, "the NPC is gone");
});

test("off the pads the pet rock drops as a ground item, as anywhere else", async (t) => {
  cleanup(t);
  const f = actor(t, [2488, 10160]);
  f.inv.add(new core.Item(PET_ROCK, 1), true);
  await drop(f);
  tick([f]);
  assert.equal(rockNpc(), null, "no Pet rock NPC");
  assert.equal(f.inv.getAmount(PET_ROCK), 0);
  assert.ok(core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), PET_ROCK, f.p.getLocation(), null), "a ground item");
});

test("Open from the west: shut without both pads held, opens for 49 ticks with the rock on the other pad", async (t) => {
  cleanup(t);
  const f = actor(t, NORTH_PAD);
  f.inv.add(new core.Item(PET_ROCK, 1), true);
  await openDoor(f);
  tick([f], 3);
  assert.ok(idsAt(2491, 10162).includes(DOOR), "one pad held is not enough");
  assert.equal(f.messages.length, 0, "and nothing is said (no capture tries it)");

  f.p.setLocation(new core.Location(...SOUTH_PAD, 0));
  await drop(f);
  tick([f]);
  f.p.setLocation(new core.Location(...NORTH_PAD, 0));
  await openDoor(f);
  tick([f]);
  let ticks = 1;
  while (!idsAt(2491, 10162).includes(OPEN) && ticks < 5) { tick([f]); ticks++; }
  assert.ok(idsAt(2491, 10162).includes(OPEN), "the open leaf replaces the door");
  assert.equal(idsAt(2491, 10162).includes(DOOR), false);

  const take = rockNpc();
  f.p.setLocation(new core.Location(2489, 10163, 0));
  await send(f, { type: "npc_option", index: take.getIndex(), clickType: 1 });
  tick([f], 47);
  assert.ok(idsAt(2491, 10162).includes(OPEN), "taking the rock back does not shut it (rec 91)");
  tick([f], 2);
  assert.ok(idsAt(2491, 10162).includes(DOOR), "it shuts 49 ticks after opening");
  assert.equal(idsAt(2491, 10162).includes(OPEN), false);
});

test("two players on the pads open it without a rock", async (t) => {
  cleanup(t);
  const a = actor(t, NORTH_PAD);
  const b = actor(t, SOUTH_PAD);
  await openDoor(a);
  tick([a, b], 3);
  assert.ok(idsAt(2491, 10162).includes(OPEN));
});

test("Open from the east: step to the middle row, then the door opens with inviswalls and lets them out (captured)", async (t) => {
  cleanup(t);
  const f = actor(t, [2492, 10164]);
  await openDoor(f);
  tick([f]); // arrival: the click runs this tick
  tick([f], 2);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [2492, 10163], "lined up on the middle row at +2");
  assert.ok(idsAt(2491, 10162).includes(DOOR), "still shut");
  tick([f]);
  assert.ok(idsAt(2491, 10162).includes(OPEN), "open at +3");
  for (const y of [10162, 10163, 10164]) assert.ok(idsAt(2491, y).includes(INVISWALL), `inviswall at ${y}`);
  tick([f]);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [2490, 10163], "walked out west");
  tick([f], 2);
  assert.ok(idsAt(2491, 10162).includes(OPEN), "open through +6");
  tick([f]);
  assert.ok(idsAt(2491, 10162).includes(DOOR), "shut at +7, 4 ticks after opening");
  for (const y of [10162, 10163, 10164]) assert.equal(idsAt(2491, y).includes(INVISWALL), false);
});

test("a dropped rock goes back to its owner on logout", async (t) => {
  cleanup(t);
  const f = actor(t, SOUTH_PAD);
  f.inv.add(new core.Item(PET_ROCK, 1), true);
  await drop(f);
  tick([f]);
  const npc = rockNpc();
  f.logout();
  tick([]);
  assert.equal(f.inv.getAmount(PET_ROCK), 1);
  assert.equal(npc.isRegistered(), false);
});

test("walking off during the east exit cancels it (Ours)", async (t) => {
  cleanup(t);
  const f = actor(t, [2492, 10164]);
  await openDoor(f);
  tick([f]);
  f.p.moveTo(new core.Location(2497, 10165, 0));
  tick([f], 5);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [2497, 10165], "not pulled back");
  assert.ok(idsAt(2491, 10162).includes(DOOR), "the door stays shut");
});

test("a dropped rock goes to the bank on logout with a full inventory (Ours)", async (t) => {
  cleanup(t);
  const f = actor(t, SOUTH_PAD);
  f.inv.add(new core.Item(PET_ROCK, 1), true);
  await drop(f);
  tick([f]);
  f.inv.add(new core.Item(995, 1), true);
  for (let id = 1; f.inv.getFreeSlots() > 0; id++) f.inv.add(new core.Item(1038 + 2 * id, 1), true);
  f.logout();
  assert.equal(f.inv.getAmount(PET_ROCK), 0);
  assert.ok([...Array(11).keys()].some((tab) => f.p.getBank(tab).getAmount(PET_ROCK) > 0), "banked");
});
