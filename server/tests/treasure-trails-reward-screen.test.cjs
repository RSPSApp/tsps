const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const Screen = require("../plugins/treasuretrails/CasketRewardScreen.plugin");
const Caskets = require("../plugins/treasuretrails/trails/Caskets.TreasureTrails");
const Beginner = require("../plugins/treasuretrails/beginner/Rewards.BeginnerTreasureTrails");
const Runtime = require("../plugins/treasuretrails/trails/Runtime.TreasureTrails");
const { byName } = require("../plugins/treasuretrails/trails/Tiers.TreasureTrails");
let core, index = 1400;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218); PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(index++); p.setUsername("cluesave" + index); p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  t.after(() => { core.TaskManager.cancelTasks(p.getIndex()); p.setRegistered(false); });
  return p;
}
function open(p, tier = "easy") {
  const id = tier === "beginner" ? 23245 : Runtime.data(byName.get(tier)).casket;
  const item = new core.Item(id); p.getInventory().setItem(0, item);
  const old = Math.random;
  try { Math.random = () => 0; return (tier === "beginner" ? Beginner : Caskets).open({ player: p, itemId: id, slot: 0, item }); }
  finally { Math.random = old; }
}
function totals(items) {
  const out = {};
  for (const { id, amount } of items) out[id] = (out[id] ?? 0) + amount;
  return out;
}
function bag(p) { return totals(p.getInventory().getValidItems().map(item => ({ id: item.getId(), amount: item.getAmount() }))); }
function reload(t, p) {
  const codec = new Json.JsonPlayerPersistence();
  const encoded = JSON.stringify(PlayerSave.fromPlayer(p), codec.replacer.bind(codec));
  const restored = actor(t);
  codec.hydratePlayerSave(JSON.parse(encoded, codec.reviver.bind(codec))).applyToPlayer(restored);
  return restored;
}
test("all six tiers display owed items without inventory credit; closing transfers once", t => {
  for (const tier of ["beginner", "easy", "medium", "hard", "elite", "master"]) {
    const p = actor(t); assert.equal(open(p, tier), true);
    assert.deepEqual(bag(p), {}, tier + ": bag is unchanged while the screen is open");
    const pending = p.getAttribute(Screen.PENDING_ATTRIBUTE);
    assert.ok(pending.length > 0, tier);
    const key = Runtime.completedAttribute({name:tier});
    assert.equal(p.getAttribute(key), 1, "completion still happens at opening");
    assert.equal(p.getInterfaceId(), 73);
    const expected = totals(pending);
    p.getPacketSender().sendInterfaceRemoval();
    assert.deepEqual(bag(p), expected, tier);
    Screen.closed({ player: p, interfaceId: 73 }); Screen.settle({ player: p });
    assert.deepEqual(bag(p), expected, "repeated close cannot duplicate");
  }
});
test("autosaved pending rewards survive the actual JSON codec and login exactly once", t => {
  const p = actor(t); open(p); const expected = totals(p.getAttribute(Screen.PENDING_ATTRIBUTE));
  const restored = reload(t, p);
  assert.deepEqual(bag(restored), {}); assert.deepEqual(totals(restored.getAttribute(Screen.PENDING_ATTRIBUTE)), expected);
  PM.emitPlayerLogin({ player: restored, username: restored.getUsername(), isNewAccount: false });
  assert.deepEqual(bag(restored), expected); assert.deepEqual(restored.getAttribute(Screen.PENDING_ATTRIBUTE), []);
  const twice = reload(t, restored); PM.emitPlayerLogin({ player: twice, username: twice.getUsername(), isNewAccount: false });
  assert.deepEqual(bag(twice), expected, "cleared obligation does not return after reload");
});
test("replacement modal preserves the same one-time transfer", t => {
  const p = actor(t); open(p); const expected = totals(p.getAttribute(Screen.PENDING_ATTRIBUTE)); p.getPacketSender().sendInterface(12);
  assert.deepEqual(bag(p), expected); const restored = reload(t, p); Screen.settle({ player: restored }); assert.deepEqual(bag(restored), expected, "reload");
});
test("logout with a full bag keeps the owed rewards saved instead of dropping them unattended", t => {
  const p = actor(t); open(p); const expected = totals(p.getAttribute(Screen.PENDING_ATTRIBUTE));
  for (let i = 0; i < 28; i++) p.getInventory().setItem(i, new core.Item(core.ItemIdentifiers.RAKE));
  const drops = []; t.mock.method(core.ItemOnGroundManager, "registers", (_player, item) => drops.push(item));
  const queue = core.World.getRemovePlayerQueue(); queue.push(p);
  try { p.getPacketSender().sendInterfaceRemoval(); PM.emitPlayerLogout({ player: p, username: p.getUsername() }); }
  finally { queue.splice(queue.indexOf(p), 1); }
  assert.deepEqual(drops, [], "nothing is dropped while the owner leaves");
  assert.deepEqual(totals(p.getAttribute(Screen.PENDING_ATTRIBUTE)), expected);
  const restored = reload(t, p); restored.getInventory().resetItems();
  PM.emitPlayerLogin({ player: restored, username: restored.getUsername(), isNewAccount: false });
  assert.deepEqual(bag(restored), expected, "login delivers exactly once");
  assert.deepEqual(restored.getAttribute(Screen.PENDING_ATTRIBUTE), []);
});
test("unrelated closes do not grant; repeated opening conserves both reward obligations", t => {
  const p = actor(t); open(p); const first = p.getAttribute(Screen.PENDING_ATTRIBUTE);
  Screen.closed({ player:p, interfaceId:12 }); assert.deepEqual(bag(p), {});
  open(p); const both = p.getAttribute(Screen.PENDING_ATTRIBUTE);
  assert.equal(both.length, first.length * 2); p.getPacketSender().sendInterfaceRemoval(); assert.deepEqual(bag(p), totals(both));
});
test("full inventory and saturated stack deliver exact overflow once through forceAdd", t => {
  const p = actor(t), inv = p.getInventory(), id = core.ItemIdentifiers.COINS;
  inv.setItem(0, new core.Item(id, 2147483646));
  for (let i = 1; i < 28; i++) inv.setItem(i, new core.Item(core.ItemIdentifiers.RAKE));
  const manager = core.ItemOnGroundManager;
  assert.ok(manager, "ground manager is exposed by the production API");
  const drops = [];
  t.mock.method(manager, "registers", (_player,item) => drops.push(item));
  Screen.queue(p, [{creditId:id,amount:5,stackable:true},{creditId:core.ItemIdentifiers.SPADE,amount:2,stackable:false}]);
  Screen.settle({player:p}); Screen.settle({player:p});
  assert.equal(inv.getAmount(id), 2147483647);
  assert.deepEqual(totals(drops.map(i=>({id:i.getId(),amount:i.getAmount()}))), {[id]:4,[core.ItemIdentifiers.SPADE]:2});
  assert.deepEqual(p.getAttribute(Screen.PENDING_ATTRIBUTE), []);
});

test("a real won-Mimic checkpoint uses the shared screen close and saved obligation", t => {
  const p = actor(t);
  const State = require("../plugins/bosses/mimic/State.Mimic");
  const Reward = require("../plugins/bosses/mimic/Reward.Mimic");
  const item = new core.Item(core.ItemIdentifiers.MIMIC);
  p.getInventory().setItem(0,item); State.initialize(item,"elite",4);
  const won=State.ensure(p,item); State.defeat(p,item,won.id);
  const old=Math.random;try{Math.random=()=>0.1;Reward.openMimic({player:p,item,slot:0});}finally{Math.random=old;}
  assert.deepEqual(bag(p), {});
  const owed=totals(p.getAttribute(Screen.PENDING_ATTRIBUTE));assert.ok(Object.keys(owed).length);
  p.getPacketSender().sendInterfaceRemoval();assert.deepEqual(bag(p),owed);
  const restored=reload(t,p);Screen.settle({player:restored});assert.deepEqual(bag(restored),owed);
});
