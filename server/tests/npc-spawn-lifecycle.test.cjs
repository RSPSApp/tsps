// Run after `yarn build`: node --test tests/npc-spawn-lifecycle.test.cjs
// An NPC's life in the world: a respawn comes back on its own tile, plane, facing, wander radius
// and scope after its own delay (the Wiki's infobox respawn times: Smoke devil 7 ticks, Man 25);
// a ::reloadnpcspawns replaces the spawn file's NPCs without duplicating any, respawn clones and
// queued respawns included; a unique boss can't be live twice; plugin spawns remember their
// plugin, and the unowned ones go when the server shuts down.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
const { NpcSpawnDefinition } = require("../dist/game/definition/NpcSpawnDefinition");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { NpcSpawnLineage } = require("../dist/game/entity/impl/npc/NpcSpawnLineage");
const { Direction } = require("../dist/game/model/Direction");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { NPCDeathTask } = require("../dist/game/task/impl/NPCDeathTask");
const { NPCRespawnTask } = require("../dist/game/task/impl/NPCRespawnTask");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ServerPerf } = require("../dist/util/ServerPerf");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");

const MAN = 3106;
const SMOKE_DEVIL = 498;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
});

/** The world's own add/remove queue pass, without the rest of its tick. */
function flushNpcQueues() {
  for (let npc; (npc = World.getAddNPCQueue().shift());) World.getNpcs().add(npc);
  for (let npc; (npc = World.getRemoveNPCQueue().shift());) World.getNpcs().remove(npc);
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) {
    TaskManager.process();
    flushNpcQueues();
  }
}

/** Every live NPC with this id, in the world or queued to join it. */
function live(id) {
  return [...World.getNpcs(), ...World.getAddNPCQueue()].filter((npc) => npc && npc.getId() === id && NpcSpawnLineage.isLive(npc));
}

/** Dies the way NPCDeathTask ends: out of the world, its respawn queued. */
function kill(npc) {
  new NPCDeathTask(npc).remove();
  flushNpcQueues();
}

/** Ticks until an NPC with this id joins the world; the count, or null past `limit`. */
function ticksUntilRespawn(id, limit = 60) {
  for (let ticks = 1; ticks <= limit; ticks++) {
    tick();
    if (live(id).length > 0) return ticks;
  }
  return null;
}

function clearWorld() {
  new NpcSpawnDefinitionLoader().applyToWorld([]);
  // Lets every queued task (respawns included) run out first.
  tick(80);
  for (const npc of [...World.getNpcs()]) if (npc) World.getNpcs().remove(npc);
  World.getAddNPCQueue().length = 0;
  World.getRemoveNPCQueue().length = 0;
}

afterEach(clearWorld);

const spawnFile = (rows, activate = true) => {
  const loader = new NpcSpawnDefinitionLoader();
  loader.applyToWorld(rows.map((row) => loader.toDefinition({ level: 0, ...row }, "test")));
  if (activate) for (const row of rows) NpcSpawnDefinitionLoader.activateNear(new Location(row.x, row.y, row.level ?? 0));
  return loader;
};

test("spawn records allocate no NPC until a player approaches, including neighbouring map squares", (t) => {
  const create = t.mock.method(NPC, "create");
  spawnFile([
    { id: MAN, x: 3300, y: 3218 },
    { id: SMOKE_DEVIL, x: 2400, y: 9440 },
    { id: MAN, x: 3222, y: 3218, level: 1 },
  ], false);
  assert.equal(create.mock.callCount(), 0);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(create.mock.callCount(), 1, "activate beyond view distance before the player reaches the next square");
  assert.equal(live(MAN).length, 1);
  assert.equal(live(SMOKE_DEVIL).length, 0);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 1));
  assert.equal(live(MAN).length, 2, "each floor activates independently");
});

test("login and a bot's registration activate nearby NPCs", () => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }], false);
  World.registerPlayerPosition({ getLocation: () => new Location(3222, 3218, 0), isPlayerBot: () => true });
  assert.equal(live(MAN).length, 1);
});

test("Death Plateau's wounded soldier stays seated at the road fork", (t) => {
  const woundedSoldier = NpcIdentifiers.SOLDIER_8;
  const row = require("../data/definitions/npc-spawns.json").find(spawn => spawn.id === woundedSoldier);
  assert.ok(row, "the canonical wounded soldier spawn exists");
  const gamevals = new Gamevals();
  assert.equal(gamevals.namesOf(GamevalKind.NPC).get(woundedSoldier), "death_ig_solider_wounded");
  const definition = CacheDefinitions.getNpc(woundedSoldier);
  assert.equal(gamevals.namesOf(GamevalKind.SEQ).get(definition.idleSeqId), "wounded_sitting");
  assert.equal(definition.walkSeqId, definition.idleSeqId, "walking cannot replace the seated pose");

  spawnFile([row]);
  const [soldier] = live(woundedSoldier);
  assert.ok(soldier, "the real loader activates the canonical spawn");
  t.mock.method(World, "isLocationActive", () => true);
  t.mock.method(Math, "random", () => 0.1);
  const steps = t.mock.method(soldier.getMovementQueue(), "addSteps");
  for (let tick = 0; tick < 100; tick++) soldier.getMovementCoordinator().process();
  assert.equal(steps.mock.callCount(), 0, "a visible wounded soldier never attempts to wander");
  assert.equal(soldier.getMovementCoordinator().getRadius(), 0);
});

// Corsair Cove's seated crew: the cache gives each of these NPCs a seated or lying pose as its walk
// animation, so a wander radius makes them slide around in that pose (issue #2410).
for (const [label, id, walkSeq] of [
  ["Altarkiz", 7986, 4851],
  ["Ithoi the Navigator", 7962, 6284],
  ["Cabin Boy Colin", 7968, 6282],
  ["Gnocci the Cook", 7973, 6282],
  ["Arsen the Thief", 7977, 6282],
]) test(`${label} does not slide around in a seated pose`, (t) => {
  const row = require("../data/definitions/npc-spawns.json").find(spawn => spawn.id === id);
  assert.ok(row, "the spawn exists");
  const definition = CacheDefinitions.getNpc(id);
  assert.equal(definition.walkSeqId, walkSeq, "the cache's walk animation is a seated pose (4851 aide sitting cross-legged, 6284 sitting up, 6282 barely conscious)");

  spawnFile([row]);
  const [npc] = live(id);
  assert.ok(npc, "the real loader activates the spawn");
  t.mock.method(World, "isLocationActive", () => true);
  t.mock.method(Math, "random", () => 0.1);
  const steps = t.mock.method(npc.getMovementQueue(), "addSteps");
  for (let tick = 0; tick < 100; tick++) npc.getMovementCoordinator().process();
  assert.equal(steps.mock.callCount(), 0, "a seated NPC never attempts to wander");
  assert.equal(npc.getMovementCoordinator().getRadius(), 0);
});

// Every spawn whose cache walk animation is a seated or lying pose must stand still: with a wander radius
// it slides around in that pose. 4851 aide sitting cross-legged, 6284 sitting up, 6282 barely conscious.
// The Corsair crew were found first (#2410); this takes every other row on the same poses, found from the
// cache so a later import cannot bring one back.
const SEATED_WALK_SEQUENCES = new Set([4851, 6284, 6282]);

test("no spawn walks in a seated pose", () => {
  const offenders = require("../data/definitions/npc-spawns.json")
    .filter(row => typeof row.id === "number" && SEATED_WALK_SEQUENCES.has(CacheDefinitions.getNpc(row.id)?.walkSeqId) && row.wanderRadius !== 0)
    .map(row => `${row.name} ${row.id} at ${row.x},${row.y},${row.level} radius ${row.wanderRadius ?? "default"}`);
  assert.deepEqual(offenders, [], "these rows would slide around in a seated or lying pose");
});

for (const id of [8573, 9193, 14227]) test(`NPC ${id} does not slide around in a seated pose`, (t) => {
  const row = require("../data/definitions/npc-spawns.json").find(spawn => spawn.id === id);
  assert.ok(row, "the spawn exists");
  assert.ok(SEATED_WALK_SEQUENCES.has(CacheDefinitions.getNpc(id).walkSeqId), "its cache walk animation is a seated pose");
  spawnFile([row]);
  const [npc] = live(id);
  assert.ok(npc, "the real loader activates the spawn");
  t.mock.method(World, "isLocationActive", () => true);
  t.mock.method(Math, "random", () => 0.1);
  const steps = t.mock.method(npc.getMovementQueue(), "addSteps");
  for (let tick = 0; tick < 100; tick++) npc.getMovementCoordinator().process();
  assert.equal(steps.mock.callCount(), 0, "a seated NPC never attempts to wander");
  assert.equal(npc.getMovementCoordinator().getRadius(), 0);
});

// The ferry parents (Rimmington dock, Corsair Cove docks) walk with human_ready but show a captain who walks
// with human_walk_f; an unrestricted radius made the ferry captain drift without a walk animation (#2410).
for (const [label, parentName] of [["Rimmington", "corsair_ferry_rimmington"], ["Corsair Cove docks", "corsair_ferry_covedocks"]]) test(`the ${label} ferry spawn does not wander`, (t) => {
  const id = CacheDefinitions.getNpcId(parentName);
  const row = require("../data/definitions/npc-spawns.json").find(spawn => spawn.id === id);
  assert.ok(row, "the canonical ferry spawn exists");
  assert.equal(CacheDefinitions.getSeqName(CacheDefinitions.getNpc(id).walkSeqId), "human_ready", "the parent has a standing pose as its walk");

  spawnFile([row]);
  const [ferry] = live(id);
  assert.ok(ferry, "the real loader activates the canonical spawn");
  t.mock.method(World, "isLocationActive", () => true);
  t.mock.method(Math, "random", () => 0.1);
  const steps = t.mock.method(ferry.getMovementQueue(), "addSteps");
  for (let tick = 0; tick < 100; tick++) ferry.getMovementCoordinator().process();
  assert.equal(steps.mock.callCount(), 0, "the ferry must not attempt random walking");
  assert.equal(ferry.getMovementCoordinator().getRadius(), 0);
});

for (const [name, parentName, childName, stage, pose] of [
  ["crossroads", "corsair_captain_crossroads", "corsair_captain_1op", 0, "human_ready"],
  ["post-quest", "corsair_captain_throne", "corsair_captain_throne_child", 60, "rd_sitting_at_bench"],
]) test(`Captain Tock's ${name} base spawn does not slide around in its fixed pose`, (t) => {
  const id = CacheDefinitions.getNpcId(parentName);
  const row = require("../data/definitions/npc-spawns.json").find(spawn => spawn.id === id);
  assert.ok(row, "the canonical captain spawn exists");
  const definition = CacheDefinitions.getNpc(id);
  assert.equal(CacheDefinitions.getSeqName(definition.walkSeqId), "human_ready", "the parent has a standing pose as its walk");
  const visible = CacheDefinitions.resolveNpc(id, { getVarbit: () => stage, getVarp: () => 0 });
  assert.equal(visible.id, CacheDefinitions.getNpcId(childName));
  assert.equal(CacheDefinitions.getSeqName(visible.idleSeqId), pose);
  assert.equal(CacheDefinitions.getSeqName(visible.walkSeqId), "human_walk_f", "the visible child keeps its real walk animation");

  spawnFile([row]);
  const [captain] = live(id);
  assert.ok(captain, "the real loader activates the canonical spawn");
  t.mock.method(World, "isLocationActive", () => true);
  t.mock.method(Math, "random", () => 0.1);
  const steps = t.mock.method(captain.getMovementQueue(), "addSteps");
  for (let tick = 0; tick < 100; tick++) captain.getMovementCoordinator().process();
  assert.equal(steps.mock.callCount(), 0, "the base captain must not attempt random walking");
  assert.equal(captain.getMovementCoordinator().getRadius(), 0);
});

test("extended NPC view distances preload their full view and wander margin", () => {
  spawnFile([{ id: MAN, x: 3370, y: 3218 }], false);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 0);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0), 127);
  assert.equal(live(MAN).length, 1);
});

test("crossing a square or teleporting activates the destination before map-square hooks", (t) => {
  spawnFile([{ id: SMOKE_DEVIL, x: 2400, y: 9440 }], false);
  let countAtHook = 0;
  t.mock.method(PluginManager, "emitPlayerMapSquareChange", () => { countAtHook = live(SMOKE_DEVIL).length; });
  const player = {};
  World.onPlayerMoved(player, new Location(3222, 3218, 0), new Location(2400, 9440, 0));
  assert.equal(countAtHook, 1);
});

test("server perf includes login and teleport activation work without a periodic sweep", (t) => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }, { id: SMOKE_DEVIL, x: 2400, y: 9440 }], false);
  let now = 0n;
  t.mock.method(process.hrtime, "bigint", () => now);
  const create = NPC.create;
  t.mock.method(NPC, "create", function (...args) {
    now += 7_000_000n;
    return create.apply(this, args);
  });
  const origin = new Location(3222, 3218, 0);
  const player = { getLocation: () => origin };
  ServerPerf.beginTick(1, 0, 0, 0, 0);
  try {
    World.registerPlayerPosition(player);
    World.onPlayerMoved(player, origin, new Location(2400, 9440, 0));
    ServerPerf.endTick(14, 0, World.getNpcs().sizeReturn(), 0);
    const phase = ServerPerf.getSummary(1).topPhases.find(row => row.name === "world.activate_npc_spawns");
    assert.equal(phase?.totalMs, 14, "both 7 ms creation bursts must be counted");
  } finally {
    ServerPerf.endTick(0, 0, 0, 0);
    World.unregisterPlayerPosition(player);
  }
});

test("a teleport during player processing includes new NPCs in that tick's visibility candidates", () => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }], false);
  let location = new Location(2400, 9440, 0);
  let registered = false;
  let index = -1;
  const player = {
    getLocation: () => location,
    getNpcViewDistance: () => 15,
    getAttribute: () => undefined,
    getPrivateArea: () => null,
    getArea: () => null,
    getSession: () => ({ getChannel: () => ({ readyState: 1 }) }),
    isPlayerBot: () => false,
    isRegistered: () => registered,
    setRegistered: value => { registered = value; },
    getIndex: () => index,
    setIndex: value => { index = value; },
    onAdd() {}, onRemove() {},
  };
  World.getPlayers().add(player);
  try {
    const previous = location;
    location = new Location(3222, 3218, 0);
    World.onPlayerMoved(player, previous, location);
    World.rebuildUpdateBuckets();
    assert.ok(World.getNearbyNpcsForUpdate(player).includes(live(MAN)[0]));
  } finally {
    World.getPlayers().remove(player);
    World.refreshActiveRegions();
  }
});

test("returning to an activated square preserves identity, damage, position and queued respawns", () => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }]);
  const [npc] = live(MAN);
  npc.moveTo(new Location(3224, 3219, 0));
  npc.setHitpoints(1);
  NpcSpawnDefinitionLoader.activateNear(new Location(2400, 9440, 0));
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.deepEqual(live(MAN), [npc]);
  assert.equal(npc.getHitpoints(), 1);
  assert.equal(npc.getLocation().getX(), 3224);
  kill(npc);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 0, "re-entry cannot bypass the respawn delay");
  assert.equal(ticksUntilRespawn(MAN), 25);
});

test("a reload discards unvisited old spawns too", () => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }], false);
  spawnFile([{ id: SMOKE_DEVIL, x: 2400, y: 9440 }], false);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 0);
  NpcSpawnDefinitionLoader.activateNear(new Location(2400, 9440, 0));
  assert.equal(live(SMOKE_DEVIL).length, 1);
});

test("a full NPC pool retains pending spawns and retries without duplicating successful ones", (t) => {
  spawnFile([{ id: MAN, x: 3222, y: 3218 }, { id: MAN, x: 3223, y: 3218 }], false);
  const add = World.getNpcs().add;
  let accepted = 0;
  const mock = t.mock.method(World.getNpcs(), "add", function (npc) {
    return accepted++ === 0 && add.call(this, npc);
  });
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 1);
  mock.mock.restore();
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 2);
  NpcSpawnDefinitionLoader.activateNear(new Location(3222, 3218, 0));
  assert.equal(live(MAN).length, 2);
});

test("wide-ranging NPCs stay eager so their roaming is not tied to visits to the spawn square", () => {
  spawnFile([{ id: MAN, x: 3222, y: 3218, wanderRadius: 100 }], false);
  assert.equal(live(MAN).length, 1);
  assert.equal(live(MAN)[0].getMovementCoordinator().getRadius(), 100);
});

test("a respawn keeps its tile, plane, facing and wander radius", () => {
  const npc = NPC.create(MAN, new Location(3222, 3218, 1));
  npc.setFace(Direction.EAST);
  npc.getMovementCoordinator().setRadius(2);
  World.getNpcs().add(npc);
  npc.moveTo(new Location(3224, 3219, 1));

  kill(npc);
  assert.equal(ticksUntilRespawn(MAN), 25);
  const [respawn] = live(MAN);
  assert.notEqual(respawn, npc);
  assert.deepEqual([respawn.getLocation().getX(), respawn.getLocation().getY(), respawn.getLocation().getZ()], [3222, 3218, 1]);
  assert.equal(respawn.getFace(), npc.getFace());
  assert.equal(respawn.getMovementCoordinator().getRadius(), 2);
});

test("each NPC respawns after its own delay: Smoke devil 7 ticks, Man 25 (Wiki)", () => {
  assert.equal(NPC.create(SMOKE_DEVIL, new Location(2400, 9440, 0)).getDefinition().getRespawn(), 7);
  const devil = NPC.create(SMOKE_DEVIL, new Location(2400, 9440, 0));
  World.getNpcs().add(devil);
  kill(devil);
  assert.equal(ticksUntilRespawn(SMOKE_DEVIL), 7);
});

test("a respawn clone keeps its owner, owner-only scope, lineage and unique key", () => {
  const owner = { getUsername: () => "tester" };
  const lineage = new NpcSpawnLineage("Test");
  const npc = NPC.create(MAN, new Location(3222, 3218, 0));
  npc.setOwner(owner);
  npc.setOwnerOnly(true);
  npc.setSpawnLineage(lineage);
  npc.setUniqueKey("test:man");
  const clone = npc.clone();
  assert.equal(clone.getOwner(), owner);
  assert.equal(clone.isOwnerOnly(), true);
  assert.equal(clone.getSpawnLineage(), lineage);
  assert.equal(clone.getUniqueKey(), "test:man");
});

test("::reloadnpcspawns leaves one NPC per spawn, with a respawn clone and a queued respawn", () => {
  const rows = [{ id: MAN, x: 3222, y: 3218 }, { id: SMOKE_DEVIL, x: 2400, y: 9440 }];
  spawnFile(rows);
  // The Smoke devil dies and comes back as a clone; the Man dies and waits for his respawn.
  kill(live(SMOKE_DEVIL)[0]);
  assert.equal(ticksUntilRespawn(SMOKE_DEVIL), 7);
  kill(live(MAN)[0]);
  assert.equal(live(MAN).length, 0);

  spawnFile(rows);
  tick(30);
  assert.equal(live(MAN).length, 1, "the Man's old respawn must not land beside the reloaded one");
  assert.equal(live(SMOKE_DEVIL).length, 1, "the old clone goes with the reload");
  assert.equal(live(MAN)[0].getSpawnLineage().owner, NpcSpawnDefinitionLoader.LINEAGE_OWNER);
});

test("a unique boss can't be live twice: spawned, queued, dying or respawning", () => {
  const spawn = () => PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218, unique: "test:boss" }, "Test");
  const boss = spawn();
  assert.ok(boss);
  assert.equal(spawn(), null, "while it is in the world");
  boss.setDying(true);
  assert.equal(spawn(), null, "while it is dying");
  kill(boss);

  // Something else brings it back before its own respawn: the respawn stays away.
  const again = spawn();
  assert.ok(again, "once it has left the world");
  tick(30);
  assert.deepEqual(live(MAN), [again]);

  // Its own respawn, with nothing else in the way, still lands.
  kill(again);
  assert.equal(ticksUntilRespawn(MAN), 25);
  assert.equal(spawn(), null, "the respawn holds the key");
});

test("a unique key queued for addition already counts", () => {
  World.getNpcs().add = () => false; // the pool is full: the spawn waits in the add queue
  try {
    assert.ok(PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218, unique: "test:queued" }, "Test"));
  } finally {
    delete World.getNpcs().add;
  }
  assert.equal(World.getAddNPCQueue().length, 1);
  assert.equal(PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218, unique: "test:queued" }, "Test"), null);
});

test("a plugin's spawns remember it; the server's shutdown removes the unowned ones and their respawns", () => {
  const owner = { getUsername: () => "tester" };
  const wanderer = PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218 }, "Shutdown test");
  const quester = PluginManager.spawnNpc({ id: MAN, x: 3223, y: 3218, owner, ownerOnly: true }, "Shutdown test");
  const devil = PluginManager.spawnNpc({ id: SMOKE_DEVIL, x: 2400, y: 9440 }, "Shutdown test");
  assert.equal(wanderer.getSpawnLineage().owner, "Shutdown test");
  assert.equal(quester.getSpawnLineage().owner, "Shutdown test");
  kill(devil); // its respawn is queued

  assert.ok(PluginManager.removeUnownedPluginNpcs() >= 1);
  assert.equal(wanderer.isRegistered(), false);
  assert.equal(quester.isRegistered(), true, "a player's own NPC goes with its owner's logout");
  tick(30);
  assert.equal(live(SMOKE_DEVIL).length, 0, "the queued respawn never lands");
});

test("a respawn task for an NPC whose source was retired does nothing", () => {
  const lineage = new NpcSpawnLineage("Retired");
  const npc = NPC.create(MAN, new Location(3222, 3218, 0));
  npc.setSpawnLineage(lineage);
  lineage.retire();
  const task = new NPCRespawnTask(npc, 1);
  task.execute();
  assert.equal(World.getAddNPCQueue().length, 0);
});

test("requeue hands a live spawn back to its pending list once, and never a dead or dying one", () => {
  const vetoed = new Set();
  const api = PluginManager.createApi("RequeueVetoTest");
  api.onCanSpawnNpc((event) => { if (vetoed.has(event.npcId)) event.allow = false; });
  const loader = new NpcSpawnDefinitionLoader();
  const definitions = [loader.toDefinition({ id: MAN, x: 3222, y: 3218, level: 0, wanderRadius: 0 }, "test")];
  NpcSpawnDefinition.replace(definitions);
  loader.applyToWorld(definitions);
  const here = new Location(3222, 3218, 0);
  try {
    NpcSpawnDefinitionLoader.activateNear(here);
    flushNpcQueues();
    const [man] = live(MAN);
    assert.ok(man);
    // Live: it steps aside while vetoed and comes back once, through the loader.
    vetoed.add(MAN);
    assert.equal(NpcSpawnDefinitionLoader.requeue(man), true);
    flushNpcQueues();
    NpcSpawnDefinitionLoader.activateNear(here);
    flushNpcQueues();
    assert.equal(live(MAN).length, 0, "the veto keeps it pending");
    vetoed.delete(MAN);
    NpcSpawnDefinitionLoader.activateNear(here);
    flushNpcQueues();
    assert.equal(live(MAN).length, 1, "it returns once the veto ends");
    // Dead: its respawn is already queued, so requeue refuses rather than doubling it.
    const [again] = live(MAN);
    again.setDying(true);
    assert.equal(NpcSpawnDefinitionLoader.requeue(again), false, "a dying spawn is not requeued");
    again.setDying(false);
    kill(again);
    assert.equal(NpcSpawnDefinitionLoader.requeue(again), false, "a dead spawn is not requeued");
    ticksUntilRespawn(MAN);
    NpcSpawnDefinitionLoader.activateNear(here);
    flushNpcQueues();
    assert.equal(live(MAN).length, 1, "only its own respawn comes back");
  } finally {
    NpcSpawnDefinition.replace([]);
  }
});
