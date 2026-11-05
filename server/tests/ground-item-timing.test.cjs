const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const {Item} = require("../dist/game/model/Item");
const {ItemOnGroundManager, OperationType} = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const {ItemOnGround, State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const {PacketSender} = require("../dist/net/packet/PacketSender");
const {Task} = require("../dist/game/task/Task");
const {TaskManager} = require("../dist/game/task/TaskManager");
const {World} = require("../dist/game/World");
const {Location} = require("../dist/game/model/Location");

const player = {getUsername: () => "GroundTimingTest", getPrivateArea: () => null, getIndex: () => 7,
  getLocation: () => new Location(3222, 3218), isPlayerBot: () => false};

// The tick the client is told each cycle is World.processCycle; tasks (NPC deaths)
// run before ground items age, player actions after. Same order as World.process.
function cycle(during = {}) {
  World.processCycle = World.getProcessCycle() + 1;
  if (during.tasks) TaskManager.submit(new class extends Task {
    constructor() { super(true); }
    execute() { during.tasks(); this.stop(); }
  }());
  TaskManager.process();
  ItemOnGroundManager.process();
  during.players?.();
}

function withWorld(fn) {
  const items = World.getItems(), previous = items.splice(0), cycleBefore = World.getProcessCycle();
  const finishedBefore = ItemOnGroundManager.finishedCycle;
  try { World.processCycle = 5000; cycle(); fn(); }
  finally {
    items.splice(0, items.length, ...previous);
    World.processCycle = cycleBefore; ItemOnGroundManager.finishedCycle = finishedBefore;
  }
}

// Runs the world until the stack is gone; the cycle it turns public and the one it despawns in.
function lifetime(pile) {
  let publicAt = -1;
  while (World.getItems().includes(pile)) {
    cycle();
    if (publicAt < 0 && pile.getState() === State.SEEN_BY_EVERYONE) publicAt = World.getProcessCycle();
    assert.ok(World.getProcessCycle() < 6000, "stack never despawned");
  }
  return {publicAt, goneAt: World.getProcessCycle()};
}

test("a dropped item reports the cycles it was created, turns public and despawns", () => withWorld(() => {
  let pile;
  cycle({players: () => { pile = ItemOnGroundManager.registers(player, new Item(1351)); }});
  const created = World.getProcessCycle();
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: created + 100, expiresTick: created + 300});
  cycle(); cycle();
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: created + 100, expiresTick: created + 300});
  assert.deepEqual(lifetime(pile), {publicAt: created + 100, goneAt: created + 300});
}));

test("a public unowned untradeable world item keeps its 200-tick lifetime", () => withWorld(() => {
  let pile;
  cycle({players: () => {
    pile = new ItemOnGround(State.SEEN_BY_EVERYONE, undefined, player.getLocation(), new Item(9468), false, -1, null);
    pile.setDespawnDelay(200);
    ItemOnGroundManager.register(pile);
  }});
  const created = World.getProcessCycle();
  assert.equal(ItemOnGroundManager.canSee(player, pile), true);
  assert.equal(pile.isStaticSpawn(), false);
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: 0, expiresTick: created + 200});
  assert.equal(lifetime(pile).goneAt, created + 200);
}));

test("an NPC drop made during the task phase counts the cycle it was made in", () => withWorld(() => {
  let pile, timing;
  cycle({tasks: () => {
    pile = ItemOnGroundManager.registerLocation(player, new Item(526), new Location(3223, 3218));
    timing = pile.getTiming();
  }});
  // Sent before ground items age this cycle, and again after: the same answer both times.
  assert.deepEqual(pile.getTiming(), timing);
  const {createdTick, privateUntilTick, expiresTick} = timing;
  assert.equal(createdTick, World.getProcessCycle() - 1);
  assert.deepEqual(lifetime(pile), {publicAt: privateUntilTick, goneAt: expiresTick});
  assert.equal(expiresTick - createdTick, 300);
}));

test("a stack despawning does not delay the next stack's timer", () => withWorld(() => {
  let first, second;
  cycle({players: () => { first = ItemOnGroundManager.registers(player, new Item(1351)); }});
  cycle({players: () => { second = ItemOnGroundManager.registers(player, new Item(1351)); }});
  const timing = second.getTiming();
  assert.equal(timing.expiresTick, first.getTiming().expiresTick + 1);
  // The first stack is removed in the cycle before the second one's last.
  assert.deepEqual(lifetime(second), {publicAt: timing.privateUntilTick, goneAt: timing.expiresTick});
}));

test("a public stack topped up by a stack going public reports its new timer", t => withWorld(() => {
  const tile = new Location(3224, 3218), sent = [];
  t.mock.method(ItemOnGroundManager, "perform", (item, type) => {
    if (type === OperationType.ALTER) sent.push(item.getTiming());
  });
  const mine = ItemOnGroundManager.registerLocation(player, new Item(995, 10), tile);
  for (let i = 0; i < 50; i++) cycle();
  // The owner's public coins on the same tile, later in the list than ours. Added directly:
  // registering would merge the private stack into it at once instead of when it goes public.
  const theirs = new ItemOnGround(State.SEEN_BY_EVERYONE, player.getUsername(), tile, new Item(995, 5), false, -1, null);
  World.getItems().push(theirs);
  while (!mine.isPendingRemoval()) cycle();
  assert.equal(theirs.getItem().getAmount(), 15);
  assert.equal(sent.length, 1);
  assert.deepEqual(theirs.getTiming(), sent[0]);
  assert.equal(lifetime(theirs).goneAt, sent[0].expiresTick);
}));

test("public, owner-only, merged and permanent stacks follow the server's rules", () => withWorld(() => {
  const now = () => World.getProcessCycle();
  const pub = new ItemOnGround(State.SEEN_BY_EVERYONE, "x", new Location(3222, 3218), new Item(1351), false, -1, null);
  const ownerOnly = new ItemOnGround(State.SEEN_BY_PLAYER, "x", new Location(3222, 3218), new Item(1351), false, -1, null);
  const respawning = new ItemOnGround(State.SEEN_BY_EVERYONE, null, new Location(3222, 3218), new Item(1351), false, 50, null);
  const staticSpawn = new ItemOnGround(State.SEEN_BY_EVERYONE, null, new Location(3222, 3218), new Item(1351), false, -1, null, true);
  assert.deepEqual(pub.getTiming(), {createdTick: now(), privateUntilTick: 0, expiresTick: now() + 300});
  assert.deepEqual(ownerOnly.getTiming(), {createdTick: now(), privateUntilTick: 0, expiresTick: now() + 300});
  assert.equal(respawning.getTiming().expiresTick, 0);
  assert.equal(staticSpawn.getTiming().expiresTick, 0);

  const coins = ItemOnGroundManager.registers(player, new Item(995, 10));
  for (let i = 0; i < 40; i++) cycle();
  assert.equal(coins.getTiming().createdTick, now() - 40);
  ItemOnGroundManager.registers(player, new Item(995, 5));
  assert.equal(coins.getItem().getAmount(), 15);
  assert.deepEqual(coins.getTiming(), {createdTick: now(), privateUntilTick: now() + 100, expiresTick: now() + 300});
}));

test("ground item views sent to the client carry the timing", () => withWorld(() => {
  const pile = ItemOnGroundManager.registers(player, new Item(1351));
  const view = new PacketSender(player).groundItemView(pile);
  assert.deepEqual({createdTick: view.createdTick, privateUntilTick: view.privateUntilTick, expiresTick: view.expiresTick},
    pile.getTiming());
  assert.equal(view.isPrivate, true);
  assert.equal(view.ownership, 1);
}));

test("a stack registered with its own lifetime keeps it, and stays owner-only when it does not go global", () => withWorld(() => {
  let reward, untradeable;
  cycle({players: () => {
    reward = ItemOnGroundManager.registerLocation(player, new Item(2327), player.getLocation(), undefined, {despawnDelay: 18000});
    untradeable = ItemOnGroundManager.registerLocation(player, new Item(6654), new Location(3223, 3218), undefined,
      {goesGlobal: false, despawnDelay: 18000});
  }});
  const created = World.getProcessCycle();
  assert.deepEqual(reward.getTiming(), {createdTick: created, privateUntilTick: created + 100, expiresTick: created + 18000});
  assert.deepEqual(untradeable.getTiming(), {createdTick: created, privateUntilTick: 0, expiresTick: created + 18000});
  let publicAt = -1, untradeableGone = -1;
  while (World.getItems().includes(reward)) {
    cycle();
    if (publicAt < 0 && reward.getState() === State.SEEN_BY_EVERYONE) publicAt = World.getProcessCycle();
    if (untradeableGone < 0 && !World.getItems().includes(untradeable)) untradeableGone = World.getProcessCycle();
    assert.equal(untradeable.getState(), State.SEEN_BY_PLAYER);
    assert.ok(World.getProcessCycle() < created + 20000, "stack never despawned");
  }
  assert.deepEqual({publicAt, goneAt: World.getProcessCycle(), untradeableGone},
    {publicAt: created + 100, goneAt: created + 18000, untradeableGone: created + 18000});
}));

test("a long-lived stack does not merge into an ordinary one on the same tile", () => withWorld(() => {
  const coins = ItemOnGroundManager.registers(player, new Item(995, 10));
  const reward = ItemOnGroundManager.registerLocation(player, new Item(995, 80), player.getLocation(), undefined, {despawnDelay: 18000});
  assert.equal(coins.getItem().getAmount(), 10);
  assert.ok(World.getItems().includes(reward));
  assert.equal(reward.clone().getDespawnDelay(), 18000);
}));
