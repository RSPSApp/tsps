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
  // Live counts the drop's own cycle as its first tick (see "the cycle a stack is added in counts" below).
  const added = World.getProcessCycle(), created = added - 1;
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: created + 100, expiresTick: created + 300});
  cycle(); cycle();
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: created + 100, expiresTick: created + 300});
  assert.deepEqual(lifetime(pile), {publicAt: added + 99, goneAt: added + 299});
}));

test("a public unowned untradeable world item keeps its 200-tick lifetime", () => withWorld(() => {
  let pile;
  cycle({players: () => {
    pile = new ItemOnGround(State.SEEN_BY_EVERYONE, undefined, player.getLocation(), new Item(9468), false, -1, null);
    pile.setDespawnDelay(200);
    ItemOnGroundManager.register(pile);
  }});
  const added = World.getProcessCycle(), created = added - 1;
  assert.equal(ItemOnGroundManager.canSee(player, pile), true);
  assert.equal(pile.isStaticSpawn(), false);
  assert.deepEqual(pile.getTiming(), {createdTick: created, privateUntilTick: 0, expiresTick: created + 200});
  // Live sends unowned sawdust as despawn=199 (rsprox_transcripts/242/900174.txt): gone 199 cycles after its add.
  assert.equal(lifetime(pile).goneAt, added + 199);
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
  assert.equal(coins.getTiming().createdTick, now() - 41);
  ItemOnGroundManager.registers(player, new Item(995, 5));
  assert.equal(coins.getItem().getAmount(), 15);
  // The top-up restarts the timer with this cycle as its first tick, as a new drop's does.
  assert.deepEqual(coins.getTiming(), {createdTick: now() - 1, privateUntilTick: now() + 99, expiresTick: now() + 299});
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
  const created = World.getProcessCycle() - 1;
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

// rsprox_transcripts/232/03202.txt: the Draynor tree guard's bowl (reveal=100, despawn=75, ownership=self) is
// added at ticks 7780, 7842 and 8190 and deleted at 7854, 7916 and 8264, 74 ticks later each time. Across
// revs 239-242, 49,339 self-owned despawn=200 and 26,619 despawn=300 stacks go 199 and 299 ticks after their add.
test("the cycle a stack is added in counts as its first tick, whichever phase adds it", () => withWorld(() => {
  const tile = new Location(3084, 3245);
  for (const phase of ["players", "tasks"]) {
    let bowl;
    cycle({[phase]: () => {
      bowl = ItemOnGroundManager.registerLocation(player, new Item(1923), tile, undefined, {despawnDelay: 75});
    }});
    const added = World.getProcessCycle();
    assert.equal(bowl.getTiming().expiresTick, added + 74, phase);
    assert.equal(lifetime(bowl).goneAt, added + 74, phase);
  }
  // A dropped stack that goes public does so 99 cycles after its add: other players then see it with 200
  // ticks left (despawn=200, ownership=other), and it goes 299 cycles after the drop.
  let drop;
  cycle({players: () => { drop = ItemOnGroundManager.registers(player, new Item(1351)); }});
  const dropped = World.getProcessCycle();
  assert.deepEqual(lifetime(drop), {publicAt: dropped + 99, goneAt: dropped + 299});
}));

// Wiki (Drops): a tradeable drop lasts 200 ticks, an untradeable one 300. A stack carried out of a closing
// instance (Phantom Muspah's lair on a death, the Fight Cave) is the same stack: the move keeps its timer.
test("a relocated stack keeps its owner, lifetime and the time it has already lain there", () => withWorld(() => {
  const area = {}, exit = new Location(3229, 3218);
  let drop, kept, moved, keptMoved;
  cycle({players: () => {
    drop = ItemOnGroundManager.registerLocation(player, new Item(1351), new Location(3222, 3218), area, {despawnDelay: 200});
    kept = ItemOnGroundManager.registerLocation(player, new Item(6654), new Location(3223, 3218), area, {goesGlobal: false});
  }});
  const timing = drop.getTiming(), keptTiming = kept.getTiming();
  for (let i = 0; i < 150; i++) cycle();
  assert.equal(drop.getState(), State.SEEN_BY_EVERYONE);
  cycle({players: () => {
    moved = ItemOnGroundManager.relocate(drop, exit, null);
    keptMoved = ItemOnGroundManager.relocate(kept, exit, null);
  }});
  assert.ok(drop.isPendingRemoval() && kept.isPendingRemoval());
  assert.deepEqual([moved.getPosition(), moved.getPrivateArea(), moved.getOwner(), moved.getState()],
    [exit, null, player.getUsername(), State.SEEN_BY_EVERYONE]);
  assert.deepEqual(moved.getTiming(), {...timing, privateUntilTick: 0}, "the move does not restart the 200-tick timer");
  assert.deepEqual(keptMoved.getTiming(), keptTiming);
  assert.equal(keptMoved.getgoesGlobal(), false);
  assert.equal(lifetime(moved).goneAt, timing.expiresTick);
  assert.ok(World.getItems().includes(keptMoved), "the untradeable lasts 300");
  assert.equal(lifetime(keptMoved).goneAt, keptTiming.expiresTick);
}));

test("an owner-only stack relocated before it goes public still goes public on time", () => withWorld(() => {
  let drop, moved;
  cycle({players: () => { drop = ItemOnGroundManager.registerLocation(player, new Item(1351), new Location(3222, 3218), {}); }});
  const timing = drop.getTiming();
  for (let i = 0; i < 40; i++) cycle();
  cycle({players: () => { moved = ItemOnGroundManager.relocate(drop, new Location(3229, 3218), null); }});
  assert.deepEqual(moved.getTiming(), timing);
  assert.deepEqual(lifetime(moved), {publicAt: timing.privateUntilTick, goneAt: timing.expiresTick});
}));

test("two stacks of one stackable relocated to one tile stay apart, each with its own timer and visibility", () => withWorld(() => {
  const area = {}, exit = new Location(3229, 3218);
  let older, newer;
  cycle({players: () => { older = ItemOnGroundManager.registerLocation(player, new Item(995, 100), new Location(3222, 3218), area); }});
  for (let i = 0; i < 150; i++) cycle();
  cycle({players: () => { newer = ItemOnGroundManager.registerLocation(player, new Item(995, 50), new Location(3223, 3218), area); }});
  const olderTiming = older.getTiming(), newerTiming = newer.getTiming();
  assert.equal(older.getState(), State.SEEN_BY_EVERYONE);
  let a, b;
  cycle({players: () => {
    a = ItemOnGroundManager.relocate(older, exit, null);
    b = ItemOnGroundManager.relocate(newer, exit, null);
  }});
  assert.ok(World.getItems().includes(a) && World.getItems().includes(b), "no merge");
  assert.deepEqual([a.getItem().getAmount(), b.getItem().getAmount()], [100, 50]);
  assert.deepEqual(a.getTiming(), {...olderTiming, privateUntilTick: 0});
  assert.deepEqual(b.getTiming(), newerTiming);
  assert.deepEqual([a.getState(), b.getState()], [State.SEEN_BY_EVERYONE, State.SEEN_BY_PLAYER]);
  // The owner-only stack goes public at its own first tick, not 100 after the move (it then joins the public
  // stack on the tile, as any stack going public does).
  while (b.getState() === State.SEEN_BY_PLAYER && !b.isPendingRemoval()) cycle();
  assert.equal(World.getProcessCycle(), newerTiming.privateUntilTick);
}));


// Darkness of Hallowvale's shared legacy lab spawn must survive the first player's pickup.
test("Haemalchemy volume 1 returns after 100 ticks (60 seconds), including after another pickup", () => withWorld(() => {
  const { GroundItemSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
  const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
  const bookId = ItemIdentifiers.HAEMALCHEMY_VOLUME_1;
  const definitions = require("../data/definitions/ground-items.json").filter(spawn => spawn.id === bookId);
  assert.equal(definitions.length, 1, "one shared laboratory book spawn");
  const definition = definitions[0];
  assert.deepEqual(definition.location, { x: 3624, y: 9690, z: 0 });
  assert.equal(definition.respawn, 100, "zero means never respawn, blocking the next quester");
  const first = new GroundItemSpawnDefinitionLoader().toItemOnGround(definition);
  assert.ok(first);
  assert.equal(first.isStaticSpawn(), true);
  assert.equal(first.getOwner(), undefined);
  assert.equal(first.getPrivateArea(), null);
  ItemOnGroundManager.register(first);
  const books = () => World.getItems().filter(item => item.getItem().getId() === bookId && !item.isPendingRemoval());
  for (let pickup = 0; pickup < 2; pickup++) {
    const [book] = books();
    assert.ok(book);
    assert.equal(book.getItem().getAmount(), 1);
    assert.equal(book.getRespawnTimer(), 100);
    assert.equal(book.respawns(), true);
    // Complete pickup uses the same deregister -> world pass -> respawn task lifecycle.
    ItemOnGroundManager.deregister(book);
    ItemOnGroundManager.process();
    assert.equal(books().length, 0);
    for (let tick = 0; tick < 99; tick++) cycle();
    assert.equal(books().length, 0, "not restored early");
    cycle();
    assert.equal(books().length, 1, "restored for the next quester after 100 ticks");
    assert.equal(books()[0].getOwner(), undefined);
    assert.equal(books()[0].getState(), State.SEEN_BY_EVERYONE);
  }
}));
