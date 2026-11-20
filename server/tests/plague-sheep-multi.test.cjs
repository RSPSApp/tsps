// Run after `yarn build`: node --test tests/plague-sheep-multi.test.cjs
//
// #2622: the sheep standing in the world are the cache's multi-NPCs 6179-6182, showing as 3986-3989 (with
// Prod) on varbits 801, 803, 800 and 802, and as 5305-5308 once Mourning's End Part I has re-dyed them.
//
// Native fixture: real npc_option and item_on_npc through ClientConnection.dispatch, with World's order: tasks,
// NPCs, then the player. Quest stages and equipment are set directly, and the toad is loaded through
// UseItemPacketListener.itemOnItem, the function the item-on-item packet calls. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
process.env.BROWSER_HOST = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [2609, 3344];
const DISPOSAL = "quest.sheep_herder.disposal";
const STAGE_DISPOSING = 2;
const STAGE_COMPLETE = 3;
const PENNED = "The sheep obligingly jumps over the gate and into the enclosure!";
// [world multi-NPC, Prod form, index in the quest's progress, pen tile]
const SHEEP = [
  [6179, 3986, 0, [2596, 3362]],
  [6180, 3987, 1, [2597, 3363]],
  [6181, 3988, 2, [2597, 3360]],
  [6182, 3989, 3, [2596, 3359]],
];
const MOURNING_STAGE_FIXED_DEVICE = 7;
const MOURNING_SHEEP = "quest.mournings_end_part_i.sheep";
const RED_VARBIT = 801;
const DYED_RED = 5305;

let core;
let I;
let next = 8300;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = (key) => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("sheepqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    core.World.unregisterPlayerPosition(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { t, p, c, inv: p.getInventory(), messages, spawned: [] };
}

function herder(t, { suit = true, prod = true, stage = STAGE_DISPOSING } = {}) {
  const f = actor(t);
  quest("sheep_herder").setStage(f.p, stage);
  const equipment = f.p.getEquipment();
  if (suit) {
    equipment.setItem(core.Equipment.BODY_SLOT, new core.Item(I.PLAGUE_JACKET, 1));
    equipment.setItem(core.Equipment.LEG_SLOT, new core.Item(I.PLAGUE_TROUSERS, 1));
  }
  if (prod) equipment.setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.CATTLEPROD, 1));
  const spawnNpc = PM.spawnNpc;
  t.mock.method(PM, "spawnNpc", (definition, ...rest) => {
    const npc = spawnNpc.call(PM, definition, ...rest);
    if (npc && definition?.owner === f.p) f.spawned.push(npc);
    return npc;
  });
  return f;
}

/** A sheep beside the player, as the world has it. */
function place(f, id) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  f.t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

function tick(f, npc, cycles = 6) {
  for (let i = 0; i < cycles; i++) {
    core.TaskManager.process();
    if (npc?.isRegistered()) npc.process();
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

async function send(f, packet, npc) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  tick(f, npc);
}

const prod = (f, npc) => send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 }, npc);

/** The first cardinal step from `at` to the gate approach, avoiding the pen and its gate. */
function stepToGate(at, gate) {
  const key = (x, y) => `${x},${y}`;
  const inPen = (x, y) => x >= 2595 && x <= 2598 && y >= 3358 && y <= 3364;
  const gateTile = (x, y) => x === 2594 && (y === 3361 || y === 3362);
  const start = key(at.getX(), at.getY());
  const target = key(gate[0], gate[1]);
  const prev = new Map([[start, null]]);
  const queue = [[at.getX(), at.getY()]];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (key(x, y) === target) {
      let cur = key(x, y);
      let step = null;
      while (prev.get(cur)) {
        const entry = prev.get(cur);
        step = entry;
        cur = entry.from;
      }
      return step;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 2576 || nx > 2624 || ny < 3336 || ny > 3380) continue;
      if (inPen(nx, ny) || gateTile(nx, ny) || prev.has(key(nx, ny))) continue;
      if (!core.RegionManager.canMovestart(new core.Location(x, y, at.getZ()), new core.Location(nx, ny, at.getZ()), 1, 1, null)) continue;
      prev.set(key(nx, ny), { from: key(x, y), dx, dy });
      queue.push([nx, ny]);
    }
  }
  return null;
}

/** Prod a tile at a time until the sheep reaches the pen (the wiki's spam-click herding). */
async function prodToPen(f, npc, index, pen) {
  const gate = [2592, pen[1] >= 3362 ? 3362 : 3361];
  for (let i = 0; i < 200 && progress(f, index) === 0 && npc.isRegistered(); i++) {
    const at = npc.getLocation();
    let step = null;
    if (at.getY() === gate[1] && at.getX() >= gate[0] && at.getX() <= 2593) {
      step = { dx: 1, dy: 0 }; // prod east through the west gate
    } else {
      step = stepToGate(at, gate);
    }
    if (!step) break;
    // Stand behind the sheep, so clicking it faces the prod along the next step.
    f.p.setLocation(new core.Location(at.getX() - step.dx, at.getY() - step.dy, at.getZ()));
    await prod(f, npc);
  }
  // This test's actor stays in the world until the test ends; step it away from the
  // gate so the next colour's sheep is not blocked by a previous player.
  if (progress(f, index) === 1) f.p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  return progress(f, index);
}

const groundBones = (bones) => core.World.getItems().find((entry) =>
  entry.getItem().getId() === bones && entry.isPendingRemoval?.() !== true);

function useOn(f, itemId, npc) {
  const slot = f.inv.getSlotForItemId(itemId);
  return send(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 3214 }, npc);
}

const loadToad = (f, toad) => UseItemPacketListener.itemOnItem(f.p, f.inv.getSlotForItemId(toad), f.inv.getSlotForItemId(I.FIXED_DEVICE));

const progress = (f, index) => ((Number(f.p.getAttribute(DISPOSAL)) || 0) >>> (index * 3)) & 7;

// ------------------------------------------------------------------ Sheep Herder

test("Sheep Herder: each sheep standing in the world can be prodded into the pen", async (t) => {
  for (const [world, form, index, pen] of SHEEP) {
    const f = herder(t);
    const npc = place(f, world);
    assert.equal(npc.getContentId(f.p), form, `control: ${world} shows as ${form}`);
    assert.equal(npc.getCurrentDefinition(f.p).getActions()[0], "Prod", "control: with Prod");
    await prodToPen(f, npc, index, pen);
    t.diagnostic(`${world}: progress ${progress(f, index)}; at ${npc.getLocation().getX()},${npc.getLocation().getY()}; messages ${f.messages}`);
    assert.ok(!f.messages.includes("Nothing interesting happens."), `${world}: not "Nothing interesting happens"`);
    assert.equal(progress(f, index), 1, `${world}: penned`);
    assert.ok(f.messages.includes(PENNED), `${world}: the transcript's line`);
    const penned = f.spawned.at(-1);
    assert.deepEqual([penned?.getLocation().getX(), penned?.getLocation().getY()], pen, `${world}: in its pen tile`);
    assert.equal(npc.isRegistered(), true, `${world}: the world's sheep stays for other players`);
    assert.equal(npc.isScriptedMovement(), false, 'penning releases the shared sheep');
  }
});

test("Sheep Herder: the quest's own spawned sheep still works", async (t) => {
  const f = herder(t);
  const npc = place(f, 3986);
  // Only the spawn the quest made counts as its own: this one isn't, and isn't a world sheep either.
  f.p.setAttribute(DISPOSAL, 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  const own = f.spawned.find((entry) => entry.getId() === 3986);
  assert.ok(own, "control: the quest spawned its red sheep");
  f.p.setLocation(new core.Location(own.getLocation().getX() - 1, own.getLocation().getY(), 0));
  await prodToPen(f, own, 0, [2596, 3362]);
  assert.equal(progress(f, 0), 1, "penned");
  assert.ok(npc.isRegistered(), "the other one is untouched");
});

test("Sheep Herder: a world sheep needs the suit, the prod and the stage, and only pens once", async (t) => {
  for (const [options, expected] of [
    [{ suit: false }, /protective plague suit/],
    [{ prod: false }, /equip the cattleprod/],
    [{ stage: STAGE_COMPLETE }, /no reason to interfere/],
  ]) {
    const f = herder(t, options);
    const npc = place(f, 6179);
    await prod(f, npc);
    assert.equal(progress(f, 0), 0, `not penned: ${JSON.stringify(options)}`);
    assert.ok(f.messages.some((message) => expected.test(message)), `told: ${f.messages}`);
    assert.equal(npc.isScriptedMovement(), false, 'refused prod takes no movement ownership');
  }

  const f = herder(t);
  const npc = place(f, 6179);
  await prodToPen(f, npc, 0, [2596, 3362]);
  assert.equal(progress(f, 0), 1, "control: penned");
  const spawns = f.spawned.length;
  f.messages.length = 0;
  await prod(f, npc);
  assert.ok(f.messages.includes("This sheep is already in the enclosure."), `again: ${f.messages}`);
  assert.equal(f.spawned.length, spawns, "and no second one");
});

test("Sheep Herder: feed on a world sheep doesn't remove it; on the penned one it gives the bones", async (t) => {
  const f = herder(t);
  f.inv.adds(I.SHEEP_FEED, 1);
  const npc = place(f, 6179);
  await prodToPen(f, npc, 0, [2596, 3362]);
  assert.equal(progress(f, 0), 1, "control: penned");

  f.messages.length = 0;
  await useOn(f, I.SHEEP_FEED, npc);
  t.diagnostic(`on the world sheep: ${f.messages}`);
  assert.equal(npc.isRegistered(), true, "the world's sheep stays");
  assert.equal(progress(f, 0), 1, "no bones from it");
  assert.ok(!f.messages.includes("Nothing interesting happens."), "and the player is told why");

  const penned = f.spawned.at(-1);
  f.p.setLocation(new core.Location(penned.getLocation().getX() + 1, penned.getLocation().getY(), 0));
  const death = t.mock.method(penned, "performAnimation", () => {});
  await useOn(f, I.SHEEP_FEED, penned);
  t.diagnostic(`on the penned sheep: ${f.messages}; progress ${progress(f, 0)}`);
  assert.equal(progress(f, 0), 2, "bones");
  assert.equal(death.mock.calls[0]?.arguments[0]?.getId?.(), 5336, "the sheep plays its collapse");
  assert.equal(f.inv.getAmount(I.SHEEP_BONES_1_), 0, "not teleported into the pack");
  assert.ok(groundBones(I.SHEEP_BONES_1_), "the bones fall where the sheep collapsed");
});

test("Sheep Herder: a sheep beside the west fence cannot be penned through it", async (t) => {
  const f = herder(t);
  const npc = place(f, 6179);
  npc.moveTo(new core.Location(2594, 3360, 0));
  f.p.setLocation(new core.Location(2593, 3360, 0));
  await prod(f, npc);
  t.diagnostic(`at ${npc.getLocation().getX()},${npc.getLocation().getY()}; progress ${progress(f, 0)}; messages ${f.messages}`);
  assert.equal(progress(f, 0), 0, "not penned through the fence");
  assert.ok(!f.messages.includes(PENNED), "no pen line");
  assert.equal(npc.isRegistered(), true, "the sheep is still outside");
});

test("Sheep Herder: disposed bones outlive the old 300-tick life and return after a logout", async (t) => {
  const f = herder(t);
  f.inv.adds(I.SHEEP_FEED, 1);
  const npc = place(f, 6179);
  await prodToPen(f, npc, 0, [2596, 3362]);
  const penned = f.spawned.at(-1);
  f.p.setLocation(new core.Location(penned.getLocation().getX() + 1, penned.getLocation().getY(), 0));
  await useOn(f, I.SHEEP_FEED, penned);
  assert.equal(progress(f, 0), 2, "bones stage");
  const bonesAt = () => core.World.getItems().filter((entry) =>
    entry.getItem().getId() === I.SHEEP_BONES_1_ && entry.getOwner?.() === f.p.getUsername()
    && entry.isPendingRemoval?.() !== true);
  const bones = bonesAt()[0];
  assert.ok(bones, "bones dropped");
  for (let i = 0; i < 301; i++) bones.process();
  assert.equal(bonesAt().length, 1, "bones outlive the default 300 ticks");
  core.ItemOnGroundManager.deregister(bones);
  assert.equal(bonesAt().length, 0, "owner-only bones are lost on logout");
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(bonesAt().length, 1, "ensureSheep re-drops the bones on login");
});

// ------------------------------------------------------------------ Mourning's End Part I

test("Mourning's End: the fixed device re-dyes a world sheep, which then shows dyed", async (t) => {
  const f = actor(t);
  quest("mournings_end_part_i").setStage(f.p, MOURNING_STAGE_FIXED_DEVICE);
  f.inv.adds(I.FIXED_DEVICE, 1);
  f.inv.adds(I.GREEN_TOAD, 1);
  f.inv.adds(I.RED_TOAD, 1);
  const npc = place(f, 6179);
  assert.equal(npc.getContentId(f.p), 3986, "control: it shows undyed");

  loadToad(f, I.GREEN_TOAD);
  assert.equal(f.inv.getAmount(I.GREEN_TOAD), 0, "control: the toad is loaded");
  await useOn(f, I.FIXED_DEVICE, npc);
  assert.equal(f.p.getPacketSender().getVarbit(RED_VARBIT), 0, "control: a green toad doesn't dye it");

  const fresh = actor(t);
  quest("mournings_end_part_i").setStage(fresh.p, MOURNING_STAGE_FIXED_DEVICE);
  fresh.inv.adds(I.FIXED_DEVICE, 1);
  fresh.inv.adds(I.RED_TOAD, 1);
  loadToad(fresh, I.RED_TOAD);
  assert.equal(fresh.inv.getAmount(I.RED_TOAD), 0, "control: the toad is loaded");
  await useOn(fresh, I.FIXED_DEVICE, npc);
  t.diagnostic(`messages ${fresh.messages}; bits ${fresh.p.getAttribute(MOURNING_SHEEP)}`);
  assert.equal(fresh.p.getPacketSender().getVarbit(RED_VARBIT), 1, "the varbit");
  assert.equal(npc.getContentId(fresh.p), DYED_RED, "it now shows dyed");
  assert.ok(!npc.getCurrentDefinition(fresh.p).getActions()[0], "with no Prod");
});

// Keep the production spawn tiles: moving every colour to HOME hid #6219.
const worldSheepSpawns = require('../data/definitions/npc-spawns.json')
  .filter((spawn) => SHEEP.some(([id]) => id === spawn.id));
for (const spawn of worldSheepSpawns) {
  test(`Sheep Herder: prod world sheep ${spawn.id} at its spawn ${spawn.x},${spawn.y}`, async (t) => {
    const f = herder(t);
    core.RegionManager.loadMapFiles(spawn.x, spawn.y);
    const npc = productionSheep(t, spawn);
    // Suppress random wandering only; retain production home/radius/retreat AI.
    t.mock.method(Math, 'random', () => 0.99);
    const at = npc.getLocation().clone();
    const step = [[0, -1], [1, 0], [-1, 0], [0, 1]].find(([dx, dy]) =>
      npc.getMovementQueue().canWalkTo(at.transform(dx, dy))
      && core.RegionManager.canMovestart(at, at.transform(-dx, -dy), 1, 1, null));
    assert.ok(step, 'control: open terrain for the sheep and adjacent actor');
    f.p.setLocation(at.transform(-step[0], -step[1]));
    await f.c.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: 1 }]);
    f.c.processTurnPackets();
    // Consume the interaction's prod in the following NPC phase, as World does.
    for (let i = 0; i < 6 && npc.getLocation().equals(at); i++) tick(f, npc, 1);
    t.diagnostic(`step ${step}; messages ${f.messages}; facing ${f.p.getFacingDirection()?.getX()},${f.p.getFacingDirection()?.getY()}; mobility ${npc.getMovementQueue().getMobility().canMove()}`);
    assert.ok(!f.messages.includes('The sheep has nowhere to go.'), `open tile refused: ${f.messages}`);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()],
      [spawn.x + step[0], spawn.y + step[1]], 'one ordinary collision-checked prod step');
  });
}

function productionSheep(t, spawn) {
  const { NpcSpawnDefinitionLoader: Loader } = require('../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader');
  const loader = new Loader();
  const sources = loader.loadSources('npc_spawns');
  assert.equal(sources.failures, 0);
  const row = sources.sources.flatMap(source => source.definitions.map(raw => ({ raw, source: source.name })))
    .find(({ raw }) => raw.id === spawn.id && raw.x === spawn.x && raw.y === spawn.y);
  assert.ok(row, 'production provider contains this spawn');
  const definition = loader.toDefinition(row.raw, row.source);
  core.RegionManager.loadMapFiles(spawn.x, spawn.y);
  assert.ok(Loader.spawn(definition));
  const npc = core.World.getNpcs().search(entry => entry.getId() === spawn.id
    && entry.getSpawnPosition().equals(definition.getPosition()));
  assert.ok(npc);
  assert.equal(npc.getMovementCoordinator().getRadius(), definition.getRadius());
  t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

async function promptProd(f, npc, dx = 1, dy = 0) {
  const at = npc.getLocation().clone();
  f.p.setLocation(at.transform(-dx, -dy));
  f.p.needsPlacement = false;
  await f.c.dispatch([{ type: 'npc_option', index: npc.getIndex(), clickType: 1 }]);
  f.c.processTurnPackets();
  core.TaskManager.process();
  assert.equal(npc.getMovementQueue().size(), 1, 'native input queued one prod');
  npc.process();
  f.p.getMovementQueue().process();
  core.TaskManager.processWalkTo(f.p.getIndex());
  assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()],
    [at.getX() + dx, at.getY() + dy], 'NPC phase preserves the requested prod');
}

for (const spawn of worldSheepSpawns.filter(row => row.id === 6181 || row.id === 6182)) {
  test(`Sheep Herder: prompt prods escape production radius at ${spawn.x},${spawn.y}`, async t => {
    const f = herder(t);
    const npc = productionSheep(t, spawn);
    t.mock.method(Math, 'random', () => 0.99);
    const home = npc.getSpawnPosition().clone();
    const radius = npc.getMovementCoordinator().getRadius();
    const direction = [[1, 0], [0, -1], [-1, 0], [0, 1]].find(([dx, dy]) =>
      Array.from({ length: 8 }, (_, i) => home.transform(i * dx, i * dy))
        .every(at => core.RegionManager.canMovestart(at, at.transform(dx, dy), 1, 1, null)));
    assert.ok(direction, 'eight clear production terrain steps');
    for (let i = 0; i < 8; i++) {
      await promptProd(f, npc, ...direction);
      tick(f, npc, 1); // >10 total cycles; every new prod refreshes the window.
    }
    assert.ok(npc.isScriptedMovement());
    assert.equal(npc.getMovementCoordinator().getRadius(), radius);
    assert.ok(npc.getSpawnPosition().equals(home));
    f.p.setLocation(npc.getLocation().transform(0, 3));
    tick(f, npc, 10);
    assert.equal(npc.isScriptedMovement(), false, 'idle restores ordinary movement');
    assert.equal(npc.getMovementCoordinator().getCoordinateState(), 1, 'ordinary return resumes');
    assert.ok(npc.getLocation().getDistance(home) < 8, 'returns toward original home');
  });
}

test('Sheep Herder: shared prods transfer logout cleanup and cancellation restores prior state', async t => {
  const first = herder(t);
  const second = herder(t);
  const npc = productionSheep(t, { id: 6181, x: 2561, y: 3388 });
  t.mock.method(Math, 'random', () => 0.99);
  await promptProd(first, npc);
  first.p.setLocation(npc.getLocation().transform(0, 3));
  await promptProd(second, npc);
  PM.emitPlayerLogout({ player: first.p, username: first.p.getUsername() });
  assert.ok(npc.isScriptedMovement(), 'earlier herder logout cannot release latest prod');
  PM.emitPlayerLogout({ player: second.p, username: second.p.getUsername() });
  assert.equal(npc.isScriptedMovement(), false, 'latest herder logout releases');
  npc.setScriptedMovement(true);
  await promptProd(second, npc);
  core.TaskManager.cancelTasks(npc);
  assert.equal(npc.isScriptedMovement(), true, 'external cancellation restores original flag');
  npc.setScriptedMovement(false);
  await promptProd(second, npc);
  core.TaskManager.cancelTasks(npc);
  assert.equal(npc.isScriptedMovement(), false);
  await promptProd(second, npc);
  core.World.getNpcs().remove(npc);
  core.TaskManager.process();
  assert.equal(npc.isScriptedMovement(), false, 'removed sheep releases');
});

test('Sheep Herder: blocked or foreign private prods cannot start or refresh movement ownership', async t => {
  const f = herder(t);
  const other = herder(t);
  const npc = productionSheep(t, { id: 6181, x: 2561, y: 3388 });
  t.mock.method(Math, 'random', () => 0.99);
  await promptProd(f, npc);
  t.mock.method(npc.getMovementQueue(), 'canWalk', () => false);
  await prod(f, npc);
  assert.ok(f.messages.includes('The sheep has nowhere to go.'));
  tick(f, npc, 4);
  assert.equal(npc.isScriptedMovement(), false, 'blocked prod did not refresh idle window');
  await prod(f, npc);
  assert.equal(npc.isScriptedMovement(), false, 'blocked prod cannot start a window');
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  const own = f.spawned.find(entry => entry.getId() === 3986);
  assert.ok(own);
  other.p.setLocation(own.getLocation().transform(-1, 0));
  await prod(other, own);
  assert.equal(own.isScriptedMovement(), false, 'another player cannot drive private sheep');
  assert.equal(progress(other, 0), 0);
});

// #6377: native actual-doorway and out-of-local-search retreat regression.
const {MapObjects}=require('../dist/game/entity/impl/object/MapObjects');
const {CacheDefinitions}=require('../dist/game/cache/CacheDefinitions');
const doorwayReport=[];
const xy=n=>[n.getLocation().getX(),n.getLocation().getY()];
const pos=n=>({at:xy(n),home:[n.getSpawnPosition().getX(),n.getSpawnPosition().getY()],radius:n.getMovementCoordinator().getRadius(),state:n.getMovementCoordinator().getCoordinateState(),scripted:n.isScriptedMovement(),queue:n.getMovementQueue().size(),blocked:n.getMovementQueue().isStepBlocked(),dest:[n.getMovementQueue().lastDestX,n.getMovementQueue().lastDestY]});
function advance(actors,npc,count=1){
  for(let i=0;i<count;i++){
    core.World.processCycle=(core.World.getProcessCycle()+1)&0x7fffffff;
    core.TaskManager.process();
    if(npc?.isRegistered())npc.process();
    for(const f of actors){f.p.needsPlacement=false;f.p.getMovementQueue().process();core.TaskManager.processWalkTo(f.p.getIndex());}
  }
}
async function clickNative(f,npc,packet,count=3){
  f.p.needsPlacement=false;
  await f.c.dispatch([packet]);f.c.processTurnPackets();advance([f],npc,count);
}
function route(from,to,npc){
  const q=[[...from]], prev=new Map([[from.join(','),null]]);
  for(let i=0;i<q.length&&i<45000;i++){
    const [x,y]=q[i];
    if(x===to[0]&&y===to[1]){
      const out=[];let k=to.join(',');while(prev.get(k)){const p=prev.get(k);out.push(k.split(',').map(Number));k=p;}return out.reverse();
    }
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy,k=nx+','+ny;
      if(nx<2490||nx>2680||ny<3240||ny>3460||prev.has(k))continue;
      const at=new core.Location(x,y,0),target=at.transform(dx,dy),behind=at.transform(-dx,-dy);
      if(!core.RegionManager.canMovestart(at,target,1,1,null))continue;
      if(npc&&!npc.getMovementQueue().canWalkTo(target,at))continue;
      // Supplied player positions must be real open tiles, not inside walls/scenery.
      if(core.RegionManager.getClipping(behind.getX(),behind.getY(),0,null)&0x240100)continue;
      if(!core.RegionManager.canMovestart(behind,at,1,1,null))continue;
      prev.set(k,x+','+y);q.push([nx,ny]);
    }
  }
  return null;
}
async function herd(f,npc,target){
  // Planning must not treat the moving herder's previous supplied position as a permanent obstacle.
  f.p.getMovementQueue().reset();f.p.setLocation(new core.Location(2605,3355,0));
  const path=route(xy(npc),target,npc);assert.ok(path,'actual cardinal prod route to '+target);
  const start=xy(npc);const points=[start];
  for(const [x,y]of path){
    const at=npc.getLocation().clone(),dx=x-at.getX(),dy=y-at.getY();
    f.p.getMovementQueue().reset();f.p.setLocation(at.transform(-dx,-dy));f.p.needsPlacement=false;
    assert.ok(npc.getMovementQueue().canWalk(dx,dy),'real sheep clipping permits step');
    await clickNative(f,npc,{type:'npc_option',index:npc.getIndex(),clickType:1},2);
    if(npc.getLocation().getX()!==x||npc.getLocation().getY()!==y)doorwayReport.push({kind:'failed-native-step',from:[at.getX(),at.getY()],expected:[x,y],sheep:pos(npc),player:xy(f.p),messages:f.messages});
    assert.deepEqual(xy(npc),[x,y],'native prod reaches next real map tile');points.push(xy(npc));
  }
  doorwayReport.push({kind:'native-herd',from:start,target,prods:path.length,points});
}
function nearDoors(){return [...MapObjects.mapObjects.values()].flat().filter(o=>Math.abs(o.getLocation().getX()-2616)<4&&Math.abs(o.getLocation().getY()-3345)<4&&/door/i.test(CacheDefinitions.getObject(o.getId())?.name??'')).map(o=>({id:o.getId(),at:xy(o),face:o.getFace(),shape:o.getType(),actions:CacheDefinitions.getObject(o.getId()).actions}));}
test('Sheep Herder: distant shared sheep returns through an actual reopened doorway',async t=>{
  t.mock.method(Math,'random',()=>0.99); // suppress wandering only, never routing or clipping
  const first=herder(t),second=herder(t);
  const npc=productionSheep(t,{id:6179,x:2609,y:3344});
  const home=npc.getSpawnPosition().clone(),radius=npc.getMovementCoordinator().getRadius();
  doorwayReport.push({kind:'spawn',id:npc.getId(),index:npc.getIndex(),...pos(npc)});
  const door=MapObjects.get(1535,new core.Location(2616,3345,0),null);assert.ok(door,'actual cache map door');
  doorwayReport.push({kind:'closed-map-door',doors:nearDoors()});
  first.p.setLocation(new core.Location(2615,3345,0));
  await clickNative(first,npc,{type:'object_option',id:1535,x:2616,y:3345,clickType:1,action:'Open'},3);
  doorwayReport.push({kind:'opened',doors:nearDoors(),messages:first.messages});
  const opened=nearDoors().find(d=>d.id!==1535);assert.ok(opened,'native opening produces open leaf');
  await herd(first,npc,[2618,3345]);
  first.p.setLocation(new core.Location(2615,3345,0));
  await clickNative(first,npc,{type:'object_option',id:opened.id,x:opened.at[0],y:opened.at[1],clickType:1,action:'Close'},3);
  doorwayReport.push({kind:'reclosed',doors:nearDoors(),sheep:pos(npc)});
  first.p.setLocation(new core.Location(2613,3342,0));second.p.setLocation(new core.Location(2618,3344,0));
  advance([first,second],npc,50);
  assert.ok(npc.getLocation().getX() >= 2617 && npc.getLocation().getDistance(home) > radius,
    'the actual closed door blocks retreat out of the building');
  assert.equal(core.RegionManager.canMovestart(new core.Location(2616,3345,0),
    new core.Location(2617,3345,0),1,1,null),false,'closed doorway retains real clipping');
  npc.setNeedsPlacement(false);
  core.World.updateLocalNpcs(first.p,[...core.World.getNpcs()]);
  core.World.updateLocalNpcs(second.p,[...core.World.getNpcs()]);
  assert.ok(first.p.getLocalNpcs().includes(npc)&&second.p.getLocalNpcs().includes(npc),'real visibility filters expose same world NPC to both players');
  doorwayReport.push({kind:'closed-idle50',sheep:pos(npc),firstContent:npc.getContentId(first.p),secondContent:npc.getContentId(second.p),firstInMainWorld:first.p.getPrivateArea()===null,secondInMainWorld:second.p.getPrivateArea()===null,firstSeesSharedNpc:first.p.getLocalNpcs().includes(npc),secondSeesSharedNpc:second.p.getLocalNpcs().includes(npc)});
  assert.ok(npc.getSpawnPosition().equals(home));assert.equal(npc.getMovementCoordinator().getRadius(),radius);
  second.p.setLocation(new core.Location(2617,3345,0));
  await clickNative(second,npc,{type:'object_option',id:1535,x:2616,y:3345,clickType:1,action:'Open'},3);
  first.p.setLocation(new core.Location(2613,3342,0));second.p.setLocation(new core.Location(2618,3342,0));
  doorwayReport.push({kind:'reopened',doors:nearDoors(),sheep:pos(npc)});
  advance([first,second],npc,80);
  doorwayReport.push({kind:'reopened-idle80',sheep:pos(npc)});
  // Observation before judging: stopping inside the unchanged wander radius can be normal.
  assert.ok(npc.getSpawnPosition().equals(home));
  assert.ok(npc.getLocation().equals(home),'reopened doorway allows ordinary home recovery');
  await herd(first,npc,[2618,3345]);
  first.p.setLocation(new core.Location(2613,3342,0));
  await herd(second,npc,[2614,3345]);
  doorwayReport.push({kind:'second-player-retrieved-through-door',sheep:pos(npc)});
  {
    first.p.setLocation(new core.Location(2605,3355,0));
    await herd(second,npc,[2618,3268]);
    first.p.setLocation(new core.Location(2613,3265,0));second.p.setLocation(new core.Location(2620,3268,0));
    const far=xy(npc);
    const finder=new core.RsmodRouteFinding();
    const direct=finder.findRoute({level:0,srcX:far[0],srcY:far[1],srcSize:1,destX:home.getX(),destY:home.getY(),privateArea:null,moveNear:true});
    const reverse=route(far,[home.getX(),home.getY()],npc);
    doorwayReport.push({kind:'long-real-route-control',direct,collisionAndOccupancyCheckedReverseLength:reverse?.length,doors:nearDoors()});
    assert.ok(reverse,'real unobstructed reverse prod route to original home');
    const controls=[64,65].map(distance=>{
      const at=reverse.find(([x,y])=>Math.max(Math.abs(x-home.getX()),Math.abs(y-home.getY()))===distance);
      assert.ok(at,'reverse route crosses distance '+distance);
      const args={level:0,srcX:at[0],srcY:at[1],srcSize:1,destX:home.getX(),destY:home.getY(),privateArea:null};
      return {distance,at,exact:finder.findRoute({...args,moveNear:false}),coordinatorMode:finder.findRoute({...args,moveNear:true})};
    });
    doorwayReport.push({kind:'cache-route-distance-controls',controls});
    advance([first,second],npc,120);doorwayReport.push({kind:'long-idle120',sheep:pos(npc)});
    advance([first,second],npc,120);doorwayReport.push({kind:'long-idle240',sheep:pos(npc)});
    assert.ok(npc.getLocation().getDistance(home) <= radius, 'idle retreat must recover to original home radius after distant native herding');
  }
  t.diagnostic(JSON.stringify(doorwayReport.filter(entry => entry.kind !== 'native-herd')));
});

test('Sheep Herder: a native re-prod takes authority over an active distant retreat segment', async t => {
  t.mock.method(Math, 'random', () => 0.99);
  const f = herder(t);
  const npc = productionSheep(t, { id:6179, x:2609, y:3344 });
  const home = npc.getSpawnPosition().clone();
  await herd(f, npc, [2618,3268]);
  f.p.setLocation(new core.Location(2604,3266,0));
  advance([f],npc,12);
  assert.ok(npc.getMovementQueue().size() > 0 && !npc.isScriptedMovement(), 'real partial retreat is active');
  const at = npc.getLocation().clone();
  const direction = [[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy]) =>
    npc.getMovementQueue().canWalk(dx,dy)
      && core.RegionManager.canMovestart(at.transform(-dx,-dy),at,1,1,null));
  assert.ok(direction, 'accessible native prod during retreat');
  f.p.setLocation(at.transform(-direction[0],-direction[1]));
  f.p.needsPlacement = false;
  await f.c.dispatch([{type:'npc_option',index:npc.getIndex(),clickType:1}]);
  f.c.processTurnPackets();
  assert.ok(npc.isScriptedMovement(), 'accepted prod takes movement authority');
  t.diagnostic(JSON.stringify({kind:'accepted-reprod-before-NPC-phase',at:[at.getX(),at.getY()],direction,...pos(npc)}));
  advance([f],npc,1);
  assert.deepEqual(xy(npc),[at.getX()+direction[0],at.getY()+direction[1]],
    'accepted native re-prod replaces the pending return segment');
  f.p.setLocation(new core.Location(2604,3266,0));
  advance([f],npc,4);
  assert.ok(npc.isScriptedMovement(), 'refreshed hold does not return early');
  advance([f],npc,240);
  assert.ok(!npc.isScriptedMovement() && npc.getLocation().getDistance(home) <= 3,
    'idle return resumes after the refreshed prod hold');
  assert.ok(npc.getSpawnPosition().equals(home));
});
