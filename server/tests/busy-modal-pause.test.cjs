// Run after `yarn build`: node --test tests/busy-modal-pause.test.cjs
// A busy main modal (varbit 12393: the diary journal, the CA overview, the equipment screen)
// pauses a repeating gathering action and it resumes after the modal closes, without a re-click
// (rsprox 227/01757 t8544-8548, 227/00555 t24898-24918, 227/00562 t153-177;
// docs/interface-interruption.md). Native input: a real Player in the World, its ClientConnection
// and the packets the client sends, advanced with World.process().
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { SkillManager } = require("../dist/game/content/skill/SkillManager");
const Fishing = require("../plugins/skills/Fishing.plugin");

const SPOT_TILE = { x: 3105, y: 3424 };
const ROCK_TILE = { x: 3110, y: 3424 };
const BUSY_VARBIT = 12393;
/** The Ardougne row of the diary list (area_task:taskbox, slot 1), op1: its journal scroll (741). */
const DIARY_PACKET = { type: "widget_action", widgetId: (259 << 16) | 2, groupId: 259, childId: 2, slot: 1, buttonNum: 1, opId: 1, itemId: -1 };
const STATS_PACKET = { type: "widget_action", widgetId: (387 << 16) | 1, groupId: 387, childId: 1, buttonNum: 1, simple: true };
const CLOSE_PACKET = { type: "interface_close" };
let core, next = 5200;
const previousBots = process.env.DISABLE_PLAYER_BOTS;
const random = Math.random;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(SPOT_TILE.x, SPOT_TILE.y);
  PM.emitServerStartup({});
});
after(() => {
  Math.random = random;
  try { PM.emitServerShutdown({}); } finally {
    if (previousBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = previousBots;
  }
});

/** A real Player in the World with a client connection; every catch and ore roll succeeds. */
function actor(t, at, skill) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("busymodal" + next++);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at.x, at.y, 0));
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  t.after(() => {
    core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().removes(p);
  });
  const skills = p.getSkillManager();
  skills.setExperience(skill, SkillManager.getExperienceForLevel(40));
  skills.setMaxLevel(skill, 40);
  skills.setCurrentLevel(skill, 40, true);
  const busy = [];
  const sender = p.getPacketSender();
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value, ...rest) => { if (id === BUSY_VARBIT) busy.push(value); return sendVarbit(id, value, ...rest); });
  Math.random = () => {
    const stack = new Error().stack;
    if (stack.includes("rollCatch")) return 0;
    if (stack.includes("rollClueBottles") || stack.includes("Pet") || stack.includes("pet")) return 0.999999;
    return random();
  };
  t.after(() => { Math.random = random; });
  return { p, c, busy };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

function ticks(n) {
  for (let i = 0; i < n; i++) core.World.process();
}

function fishingScene(t) {
  const { ItemIdentifiers: I, NpcIdentifiers: N, NPC, Location, World } = core;
  const f = actor(t, { x: SPOT_TILE.x - 1, y: SPOT_TILE.y }, core.Skill.FISHING);
  f.p.getInventory().add(new core.Item(I.FLY_FISHING_ROD), true);
  f.p.getInventory().add(new core.Item(I.FEATHER, 50), true);
  const spot = NPC.create(N.ROD_FISHING_SPOT_10, new Location(SPOT_TILE.x, SPOT_TILE.y, 0));
  spot.setScriptedMovement(true);
  assert.equal(World.getNpcs().add(spot), true);
  spot.needsPlacement = false;
  t.after(() => { if (spot.isRegistered()) World.getNpcs().removes(spot); });
  ticks(1);
  f.p.needsPlacement = false;
  spot.needsPlacement = false;
  const definition = spot.getCurrentDefinition(f.p);
  const clickType = definition.getActions().indexOf("Lure") + 1;
  assert.ok(clickType > 0);
  assert.equal(PM.emitNpcInteraction({ player: f.p, npc: spot, npcId: spot.getId(), definition, clickType, handled: false }), true);
  return { ...f, caught: () => 50 - f.p.getInventory().getAmount(I.FEATHER) };
}

function miningScene(t) {
  const { ItemIdentifiers: I, CacheDefinitions, GameObject, Location, ObjectManager } = core;
  const f = actor(t, { x: ROCK_TILE.x - 1, y: ROCK_TILE.y }, core.Skill.MINING);
  f.p.getInventory().add(new core.Item(I.BRONZE_PICKAXE), true);
  const rock = new GameObject(CacheDefinitions.getLocId("copperrock1"), new Location(ROCK_TILE.x, ROCK_TILE.y, 0), 10, 0, null);
  ObjectManager.register(rock, true);
  t.after(() => ObjectManager.deregister(rock, true));
  return { ...f, rock, mined: () => f.p.getInventory().getAmount(I.COPPER_ORE) };
}

test("fishing waits under the diary journal and resumes after it closes, without a re-click", async (t) => {
  const f = fishingScene(t);
  ticks(8);
  assert.ok(f.caught() > 0, "the spot lands a catch before the journal opens");
  await send(f, DIARY_PACKET);
  assert.equal(f.p.getInterfaceId(), 741, "the diary journal opens");
  assert.equal(f.p.inBusyModal(), true);
  const caught = f.caught();
  ticks(12);
  assert.equal(f.caught(), caught, "no catch while it is open");
  assert.equal(Fishing.isFishingActive(f.p), true, "the session is held, not ended");
  await send(f, CLOSE_PACKET);
  assert.equal(f.p.inBusyModal(), false);
  ticks(8);
  assert.ok(f.caught() > caught, "catches resume after the close");
});

test("mining waits under the diary journal and resumes after it closes", async (t) => {
  const f = miningScene(t);
  await send(f, { type: "object_option", id: f.rock.getId(), x: ROCK_TILE.x, y: ROCK_TILE.y, action: "Mine" });
  ticks(1);
  await send(f, DIARY_PACKET);
  ticks(15);
  assert.equal(f.mined(), 0, "no ore while the journal is open");
  await send(f, CLOSE_PACKET);
  ticks(15);
  assert.ok(f.mined() > 0, "the rock gives ore after the close");
});

test("busy is set while the journal or the equipment screen is open and cleared by the close", async (t) => {
  const f = actor(t, { x: ROCK_TILE.x - 1, y: ROCK_TILE.y }, core.Skill.MINING);
  await send(f, DIARY_PACKET);
  await send(f, CLOSE_PACKET);
  await send(f, STATS_PACKET);
  assert.equal(f.p.getInterfaceId(), 84);
  assert.equal(f.p.inBusyModal(), true);
  await send(f, CLOSE_PACKET);
  assert.equal(f.p.inBusyModal(), false);
  assert.deepEqual(f.busy, [1, 0, 1, 0], "the equipment screen's busy is cleared too");
});

test("a 12393 sent for a teleport or cutscene pauses nothing", async (t) => {
  const f = fishingScene(t);
  ticks(2);
  f.p.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
  const caught = f.caught();
  ticks(10);
  assert.ok(f.caught() > caught, "fishing goes on");
  f.p.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
});

test("a walk under the diary journal goes on (live's Resizable-classic layout)", async (t) => {
  // Live 227/1000342 t8963 (classic layout) walks on; 227/00552 t12937 (modern) pauses.
  // The modern layout's pause is recorded but not implemented.
  const f = actor(t, { x: 3103, y: 3424 }, core.Skill.MINING);
  ticks(1);
  f.p.needsPlacement = false;
  await send(f, { type: "move", worldX: 3108, worldY: 3424, modifierFlags: 0, run: false });
  ticks(1);
  await send(f, DIARY_PACKET);
  const at = f.p.getLocation();
  assert.ok(f.p.getMovementQueue().size() > 0, "steps are still queued");
  ticks(2);
  assert.equal(f.p.getLocation().equals(at), false, "the player keeps walking");
});

test("the CA overview is a busy modal too, across its own screens", async (t) => {
  // Live 227/00100 t8867 and 236/03915: busy 1 while the overview is open.
  const f = actor(t, { x: ROCK_TILE.x - 1, y: ROCK_TILE.y }, core.Skill.MINING);
  await send(f, { type: "widget_action", widgetId: (712 << 16) | 3, groupId: 712, childId: 3, slot: 5, buttonNum: 1, opId: 1, itemId: -1 });
  assert.equal(f.p.getInterfaceId(), 717, "the character summary's Combat Achievements row opens the overview");
  assert.equal(f.p.inBusyModal(), true);
  // Its burger menu's Bosses row (717:17 slot 14) swaps in the bosses list (716): busy stays 1.
  await send(f, { type: "widget_action", widgetId: (717 << 16) | 17, groupId: 717, childId: 17, slot: 14, buttonNum: 1, opId: 1, itemId: -1 });
  assert.equal(f.p.getInterfaceId(), 716, "the bosses list replaces the overview");
  assert.equal(f.p.inBusyModal(), true);
  await send(f, CLOSE_PACKET);
  assert.equal(f.p.inBusyModal(), false);
  assert.deepEqual(f.busy, [1, 0], "no 0 between the two screens (live 237/1001305 t5413)");
});
