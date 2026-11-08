const assert = require("node:assert/strict");
const {test} = require("node:test");
const {Server} = require("../dist/Server");
Server.installProductionPathResolver();
require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
const {Item} = require("../dist/game/model/Item");
const {Inventory} = require("../dist/game/model/container/impl/Inventory");
const {MAX_STACK_AMOUNT} = require("../dist/game/model/container/StackType");
const {ItemOnGroundManager} = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const {State} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const {ItemOnGround} = require("../dist/game/entity/impl/grounditem/ItemOnGround");
const {MagicOnItemPacketListener} = require("../dist/net/packet/impl/MagicOnItemPacketListener");
const {PluginManager} = require("../dist/plugins/PluginManager");
const {World} = require("../dist/game/World");
const {Location} = require("../dist/game/model/Location");

function fixture() {
  const messages = [], xp = [], player = {getUsername: () => "GroundTransferTest", getPrivateArea: () => null,
    getLocation: () => new Location(3222, 3218), isRegistered: () => true, getHitpoints: () => 10,
    getPacketSender: () => ({sendItemContainer() {}, sendSoundEffect() {}}),
    getSkillManager: () => ({addExperiences: (...args) => xp.push(args)}),
    sendMessage: message => messages.push(message), isPlayerBot: () => false,
    getLastItemPickup: () => ({reset() {}})};
  const inventory = new Inventory(player); player.getInventory = () => inventory;
  const listener = new MagicOnItemPacketListener();
  return {player, inventory, listener, messages, xp,
    grab: pile => listener.landGroundItemGrab(player, pile.getItem().getId(), pile.getPosition())};
}

test("public unowned untradeables are sent to nearby players and can be picked up once", t => {
  const {Player} = require("../dist/game/entity/impl/player/Player");
  const {PlayerSession} = require("../dist/net/PlayerSession");
  const create = name => {
    const transport = {kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {}};
    const player = new Player(new PlayerSession(transport));
    player.setUsername(name); player.setRegistered(true);
    player.setLocation(new Location(3222, 3218));
    return player;
  };
  const payer = create("WorldDropPayer"), observer = create("WorldDropObserver"), sent = [];
  t.mock.method(World, "forEachNetworkPlayer", send => { send(payer); send(observer); });
  for (const player of [payer, observer]) {
    const sender = player.getPacketSender();
    t.mock.method(sender, "createGroundItem", item => { sent.push(["create", player, item]); return sender; });
    t.mock.method(sender, "deleteGroundItem", item => { sent.push(["delete", player, item]); return sender; });
  }
  const items = World.getItems(), previous = items.splice(0);
  t.after(() => items.splice(0, items.length, ...previous));
  const item = new Item(9468);
  assert.equal(item.getDefinition().getName(), "Sawdust", "the item resolves from the native cache");
  assert.equal(item.isTradeable(), false, "the native cache marks this world item untradeable");
  const pile = new ItemOnGround(State.SEEN_BY_EVERYONE, undefined, payer.getLocation().clone(), item, false, -1, null);
  pile.owner = "OtherPlayer";
  assert.equal(ItemOnGroundManager.canSee(payer, pile), false, "other-player-owned untradeables remain hidden");
  pile.owner = undefined; pile.setState(State.SEEN_BY_PLAYER);
  assert.equal(ItemOnGroundManager.canSee(payer, pile), false, "ownerless private items remain hidden");
  pile.setState(State.SEEN_BY_EVERYONE);
  ItemOnGroundManager.register(pile);
  assert.deepEqual(sent.map(([kind, player]) => [kind, player.getUsername()]),
    [["create", payer.getUsername()], ["create", observer.getUsername()]]);
  assert.equal(ItemOnGroundManager.canSee(payer, pile), true);
  assert.equal(ItemOnGroundManager.canSee(observer, pile), true);
  const snapshot = t.mock.method(observer.getPacketSender(), "sendGroundItems", visible => {
    assert.ok(visible.includes(pile)); return observer.getPacketSender();
  });
  ItemOnGroundManager.onRegionChange(observer);
  assert.equal(snapshot.mock.calls.length, 1, "region snapshots include the same public item");
  ItemOnGroundManager.pickup(payer, pile);
  assert.equal(payer.getInventory().getAmount(item.getId()), 1);
  assert.equal(pile.isPendingRemoval(), true);
  assert.equal(sent.filter(([kind]) => kind === "delete").length, 2);
  ItemOnGroundManager.pickup(observer, pile);
  assert.equal(observer.getInventory().getAmount(item.getId()), 0, "a second player cannot duplicate the pickup");
});

for (const [label, existing, metadata, freeSlots, expectedAdded] of [
  ["capped stack", MAX_STACK_AMOUNT, null, 27, 0],
  ["partially filled stack", MAX_STACK_AMOUNT - 2, null, 27, 2],
  ["different metadata with a full inventory", 100, {source: "old"}, 0, 0],
  ["different metadata with a free slot", MAX_STACK_AMOUNT, {source: "old"}, 1, 10],
]) test(`real Telegrab preserves a ${label}`, () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0), observed = [];
  const emit = PluginManager.emitCustomEvent;
  try {
    PluginManager.emitCustomEvent = (name, event) => { if (name === "magic:telekinetic-grab") observed.push(event); };
    f.inventory.setItem(0, new Item(995, existing, metadata));
    for (let slot = 1; slot < 28 - freeSlots; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = ItemOnGroundManager.registers(f.player, new Item(995, 10));
    f.grab(pile);
    assert.equal(f.inventory.getAmount(995) - existing, expectedAdded);
    assert.equal(pile.isPendingRemoval(), expectedAdded === 10);
    const left = pile.isPendingRemoval() ? 0 : pile.getItem().getAmount();
    assert.equal(left, 10 - expectedAdded);
    assert.equal(f.inventory.getAmount(995) + left, existing + 10);
    assert.equal(observed.length, expectedAdded > 0 ? 1 : 0);
    assert.equal(f.listener.canReceiveGroundItem(f.player, new Item(995, 1)), expectedAdded === 10);
  } finally { PluginManager.emitCustomEvent = emit; items.splice(0, items.length, ...previous); }
});

test("Telegrab leaves a partially fitting nonstackable ground batch behind", () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    for (let slot = 0; slot < 25; slot++) f.inventory.setItem(slot, new Item(385));
    const pile = ItemOnGroundManager.registers(f.player, new Item(385, 5));
    f.grab(pile);
    assert.equal(f.inventory.getAmount(385), 28); assert.equal(pile.getItem().getAmount(), 2);
    assert.equal(pile.isPendingRemoval(), false);
  } finally { items.splice(0, items.length, ...previous); }
});

for (const method of ["pickup", "telegrab"]) test(`${method} cannot take another owner's invisible untradeable item`, () => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  try {
    const pile = ItemOnGroundManager.registers(f.player, new Item(23182));
    pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
    if (method === "telegrab") f.grab(pile); else ItemOnGroundManager.pickup(f.player, pile);
    assert.equal(f.inventory.getAmount(23182), 0); assert.equal(pile.isPendingRemoval(), false);
  } finally { items.splice(0, items.length, ...previous); }
});

test("invisible walking requests cannot invoke handled pickup hooks", t => {
  const f = fixture(), items = World.getItems(), previous = items.splice(0);
  let calls = 0;
  t.mock.method(PluginManager, "emitGroundItemPickup", () => { calls++; return true; });
  try {
    const pile = ItemOnGroundManager.registers(f.player, new Item(23182));
    pile.owner = "OtherPlayer"; pile.setState(State.SEEN_BY_EVERYONE);
    ItemOnGroundManager.pickup(f.player, pile);
    assert.equal(calls, 0, "an invisible item cannot trigger quest or other pickup effects");
    assert.equal(pile.isPendingRemoval(), false);
    assert.equal(f.inventory.getAmount(23182), 0);
  } finally { items.splice(0, items.length, ...previous); }
});

const {GroundItemRespawnTask} = require("../dist/game/task/impl/GroundItemRespawnTask");
const {TaskManager} = require("../dist/game/task/TaskManager");
function respawnFixture(t) {
  const f = fixture(), items = World.getItems(), previous = items.splice(0), tasks = [];
  t.after(() => items.splice(0, items.length, ...previous));
  t.mock.method(TaskManager, "submit", task => { task.setRunning(true); tasks.push(task); });
  return {...f, items, tasks};
}
function spawn(f, id, amount, {timer = 4, staticSpawn = true, state = State.SEEN_BY_EVERYONE,
  goesGlobal = false, meta = null, paused = false, owner = undefined} = {}) {
  const pile = new ItemOnGround(state, owner, f.player.getLocation().clone(), new Item(id, amount, meta),
    goesGlobal, timer, null, staticSpawn);
  pile.setAgingPaused(paused);
  ItemOnGroundManager.register(pile);
  return pile;
}
function finishRespawn(f, amount) {
  ItemOnGroundManager.process();
  const task = f.tasks.shift();
  assert.ok(task instanceof GroundItemRespawnTask, "real manager schedules the real respawn task");
  for (let tick = 1; tick < task.getDelay(); tick++) {
    task.tick();
    assert.equal(f.items.length, 0, "the source remains absent before its configured delay");
  }
  task.tick();
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].getItem().getAmount(), amount);
  return f.items[0];
}

test("static batch restores its original quantity after real partial then final pickups, across cycles", t => {
  const f = respawnFixture(t), pile = spawn(f, 385, 3, {meta: {origin: "static-fixture"}});
  pile.setEnabledOps(4);
  for (let slot = 0; slot < 27; slot++) f.inventory.setItem(slot, new Item(4151));
  ItemOnGroundManager.pickup(f.player, pile);
  assert.equal(f.inventory.getAmount(385), 1);
  assert.equal(pile.getItem().getAmount(), 2);
  assert.equal(pile.isPendingRemoval(), false);
  ItemOnGroundManager.process();
  assert.equal(f.tasks.length, 0, "partial pickup does not start a second supply");
  f.inventory.resetItems();
  ItemOnGroundManager.pickup(f.player, pile);
  assert.equal(f.inventory.getAmount(385), 2);
  assert.equal(pile.isPendingRemoval(), true);
  const restored = finishRespawn(f, 3);
  assert.equal(restored.getRespawnTimer(), 4);
  assert.equal(restored.isStaticSpawn(), true);
  assert.deepEqual(restored.getItem().getMeta(), {origin: "static-fixture"});
  assert.equal(restored.getEnabledOps(), 4);
  f.inventory.resetItems();
  ItemOnGroundManager.pickup(f.player, restored);
  assert.equal(f.inventory.getAmount(385), 3);
  finishRespawn(f, 3);
});

test("full-bag refusal and ordinary clone preserve current quantity without spawning supply", t => {
  const f = respawnFixture(t), pile = spawn(f, 385, 3);
  for (let slot = 0; slot < 28; slot++) f.inventory.setItem(slot, new Item(4151));
  ItemOnGroundManager.pickup(f.player, pile);
  assert.equal(pile.getItem().getAmount(), 3);
  assert.equal(pile.isPendingRemoval(), false);
  ItemOnGroundManager.process();assert.equal(f.tasks.length, 0);
  f.inventory.setItem(0, new Item(-1, 0));
  ItemOnGroundManager.pickup(f.player, pile);
  assert.equal(pile.getItem().getAmount(), 2);
  assert.equal(pile.clone().getItem().getAmount(), 2, "clone is a snapshot, not a respawn");
  const fixtureOnly = new ItemOnGround(State.SEEN_BY_EVERYONE, null, f.player.getLocation(), new Item(385, 3), false, -1, null, true);
  fixtureOnly.getItem().setAmount(1);
  assert.equal(fixtureOnly.clone().getItem().getAmount(), 1, "visibility-only static items never reset quantity");
});

test("compatible static piles aggregate original templates and retain first timing, metadata and operations", t => {
  const f = respawnFixture(t), first = spawn(f, 995, 3);
  f.inventory.setItem(0, new Item(995, MAX_STACK_AMOUNT - 2));
  ItemOnGroundManager.pickup(f.player, first);
  assert.equal(first.getItem().getAmount(), 1);
  const incoming = spawn(f, 995, 5);
  assert.equal(f.items.length, 1);
  assert.equal(first.getItem().getAmount(), 6);
  assert.equal(f.items[0], first);
  assert.equal(first.getRespawnTimer(), 4);
  f.inventory.resetItems();
  ItemOnGroundManager.pickup(f.player, first);
  assert.equal(f.inventory.getAmount(995), 6);
  finishRespawn(f, 8);
});

test("recurring static sources never absorb dropped supply or incompatible lifecycle piles, in either order", t => {
  const f = respawnFixture(t);
  for (const options of [
    {staticSpawn: false, timer: -1}, {staticSpawn: true, timer: -1},
    {timer: 5}, {state: State.SEEN_BY_PLAYER}, {goesGlobal: true}, {paused: true},
  ]) for (const reversed of [false, true]) {
    f.items.splice(0);
    const a = () => spawn(f, 995, 3, {owner: f.player.getUsername()}),
      b = () => spawn(f, 995, 5, {...options, owner: f.player.getUsername()});
    const [first, second] = reversed ? [b(), a()] : [a(), b()];
    assert.equal(f.items.length, 2, JSON.stringify({options, reversed}));
    assert.equal(first.getItem().getAmount() + second.getItem().getAmount(), 8);
    const recurring = reversed ? second : first;
    assert.equal(ItemOnGroundManager.getOperableGroundItem(f.player, 995, f.player.getLocation(), 3, recurring.getId()), recurring,
      "browser stack ID resolves the recurring pile independently");
    assert.equal(ItemOnGroundManager.getOperableGroundItem(f.player, 995, f.player.getLocation(), 3),
      f.items.find(p => ItemOnGroundManager.canOperate(f.player, p, 3)),
      "native fallback retains first-operable resolution");
  }
  f.items.splice(0);f.inventory.resetItems();
  const source = spawn(f, 995, 3), dropped = spawn(f, 995, 5, {staticSpawn: false, timer: -1});
  ItemOnGroundManager.pickup(f.player, source);
  ItemOnGroundManager.process();
  assert.deepEqual(f.items, [dropped], "unrelated dropped supply remains on the floor");
  const task = f.tasks.shift();task.execute();
  const restored = f.items.find(p => p.isStaticSpawn());
  assert.equal(restored.getItem().getAmount(), 3, "only the source quantity recurs");
  assert.equal(dropped.getItem().getAmount(), 5);
});

test("static template cap is checked independently of depleted floor quantity; ordinary merges stay unchanged", t => {
  const f = respawnFixture(t), source = spawn(f, 995, 3);
  f.inventory.setItem(0, new Item(995, MAX_STACK_AMOUNT - 2));
  ItemOnGroundManager.pickup(f.player, source);
  assert.equal(source.getItem().getAmount(), 1);
  spawn(f, 995, MAX_STACK_AMOUNT - 1);
  assert.equal(f.items.length, 2, "a legal current sum cannot overflow a future respawn template");
  f.items.splice(0);
  const a = spawn(f, 995, 3, {staticSpawn: false, timer: -1});
  spawn(f, 995, 5, {staticSpawn: false, timer: -1});
  assert.equal(f.items.length, 1);assert.equal(a.getItem().getAmount(), 8);
  assert.equal(a.clone().getItem().getAmount(), 8);
});


test("a drop becoming public cannot merge into recurring supply", t => {
  const f = respawnFixture(t), owner = f.player.getUsername();
  const source = spawn(f, 995, 3, {owner});
  const drop = spawn(f, 995, 5, {staticSpawn: false, timer: -1, owner,
    state: State.SEEN_BY_PLAYER, goesGlobal: true});
  assert.equal(f.items.length, 2);
  drop.setTick(ItemOnGroundManager.PUBLIC_REVEAL_DELAY - 1);
  drop.process();
  assert.equal(drop.getState(), State.SEEN_BY_EVERYONE);
  assert.equal(drop.isPendingRemoval(), false);
  assert.equal(f.items.length, 2);
  assert.equal(source.getItem().getAmount(), 3);
  assert.equal(drop.getItem().getAmount(), 5);
});

for (const [label,id,x,y,z,delay] of [
  ["Crossbow",837,3174,3663,0,500],
  ["Shears",1735,3152,3306,0,100],
  ["Aldarin Hammer",2347,1373,2949,0,100],
  ["Fortis Chisel",1755,1657,3142,0,100],
  ["Overlook Tinderbox",590,1625,3287,0,100],
  ["Outer Fortis Spade",952,1641,3052,0,100],
  ["Aldarin Spade",952,1405,2938,0,100],
]) test("audited "+label+" definition preserves full-bag refusal and its real respawn delay", t=>{
  const f=respawnFixture(t);
  const definition=require("../data/definitions/ground-items.json").find(row=>
    row.id===id&&row.location.x===x&&row.location.y===y&&row.location.z===z);
  assert.ok(definition,"audited source definition is present");
  f.player.getLocation=()=>new Location(x,y,z);
  const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
  const pile=new GroundItemSpawnDefinitionLoader().toItemOnGround(definition);
  assert.ok(pile);assert.equal(pile.getRespawnTimer(),delay);assert.equal(pile.isStaticSpawn(),true);
  ItemOnGroundManager.register(pile);
  for(let slot=0;slot<28;slot++)f.inventory.setItem(slot,new Item(385));
  ItemOnGroundManager.pickup(f.player,pile);
  assert.equal(pile.isPendingRemoval(),false);assert.equal(pile.getItem().getAmount(),1);
  assert.equal(f.inventory.getAmount(id),0);ItemOnGroundManager.process();assert.equal(f.tasks.length,0);
  f.inventory.setItem(0,new Item(-1,0));ItemOnGroundManager.pickup(f.player,pile);
  assert.equal(f.inventory.getAmount(id),1);assert.equal(pile.isPendingRemoval(),true);
  const restored=finishRespawn(f,1);
  assert.equal(restored.getRespawnTimer(),delay,"uses full source delay, never a shortened fixture");
  assert.deepEqual([restored.getPosition().getX(),restored.getPosition().getY(),restored.getPosition().getZ()],[x,y,z]);
});

for(const[id,x,y,amount]of[[557,1394,3116,4],[558,1392,3118,2]])test("audited member rune "+id+" conserves a capped-stack partial pickup and restores its source quantity",t=>{
 const f=respawnFixture(t),definition=require("../data/definitions/ground-items.json").find(r=>r.id===id&&r.location.x===x&&r.location.y===y&&r.location.z===0);
 assert.ok(definition,"audited member rune source row");assert.equal(definition.members,true);
 f.player.getLocation=()=>new Location(x,y,0);
 const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
 const pile=new GroundItemSpawnDefinitionLoader().toItemOnGround(definition);
 assert.equal(pile.getRespawnTimer(),100);assert.equal(pile.getItem().getAmount(),amount);
 ItemOnGroundManager.register(pile);
 f.inventory.setItem(0,new Item(id,MAX_STACK_AMOUNT-1));
 for(let slot=1;slot<28;slot++)f.inventory.setItem(slot,new Item(385));
 ItemOnGroundManager.pickup(f.player,pile);
 assert.equal(f.inventory.getAmount(id),MAX_STACK_AMOUNT);assert.equal(pile.getItem().getAmount(),amount-1);
 assert.equal(pile.isPendingRemoval(),false);ItemOnGroundManager.process();assert.equal(f.tasks.length,0);
 f.inventory.resetItems();ItemOnGroundManager.pickup(f.player,pile);
 assert.equal(f.inventory.getAmount(id),amount-1);assert.equal(pile.isPendingRemoval(),true);
 const restored=finishRespawn(f,amount);assert.equal(restored.getRespawnTimer(),100);
 assert.deepEqual([restored.getPosition().getX(),restored.getPosition().getY(),restored.getPosition().getZ()],[x,y,0]);
});

for(const[x,y]of[[2671,3737],[2672,3738]])test("real Telegrab landing transfers island Nature source and respawns full quantity at"+x+","+y,t=>{
 const f=respawnFixture(t),r=require("../data/definitions/ground-items.json").find(r=>r.id===561&&r.location.x===x&&r.location.y===y);
 assert.ok(r);f.player.getLocation=()=>new Location(2678,3731,0);
 const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
 const pile=new GroundItemSpawnDefinitionLoader().toItemOnGround(r);ItemOnGroundManager.register(pile);
 f.listener.landGroundItemGrab(f.player,561,pile.getPosition());
 assert.equal(f.inventory.getAmount(561),2);assert.equal(pile.isPendingRemoval(),true);
 const restored=finishRespawn(f,2);assert.equal(restored.getRespawnTimer(),200);
});
test("island Nature Telegrab landing preserves capped/full bags and original respawn quantity",t=>{
 const f=respawnFixture(t),r=require("../data/definitions/ground-items.json").find(r=>r.id===561&&r.location.x===2671&&r.location.y===3737);
 assert.ok(r);f.player.getLocation=()=>new Location(2678,3731,0);
 const {GroundItemSpawnDefinitionLoader}=require("../dist/game/definition/loader/impl/GroundItemSpawnDefinitionLoader");
 const pile=new GroundItemSpawnDefinitionLoader().toItemOnGround(r);ItemOnGroundManager.register(pile);
 for(let s=0;s<28;s++)f.inventory.setItem(s,new Item(385));
 f.listener.landGroundItemGrab(f.player,561,pile.getPosition());assert.equal(pile.getItem().getAmount(),2);assert.equal(pile.isPendingRemoval(),false);
 f.inventory.setItem(0,new Item(561,MAX_STACK_AMOUNT-1));f.listener.landGroundItemGrab(f.player,561,pile.getPosition());
 assert.equal(f.inventory.getAmount(561),MAX_STACK_AMOUNT);assert.equal(pile.getItem().getAmount(),1);assert.equal(pile.isPendingRemoval(),false);
 f.inventory.resetItems();f.listener.landGroundItemGrab(f.player,561,pile.getPosition());assert.equal(f.inventory.getAmount(561),1);
 assert.equal(finishRespawn(f,2).getRespawnTimer(),200);
});
