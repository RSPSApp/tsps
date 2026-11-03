const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
let core, Raid, Parties, next = 950;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3233, 5744); PM.emitServerStartup({});
  Raid = require("../plugins/minigames/cox/RaidState.ChambersOfXeric");
  Parties = require("../plugins/minigames/cox/Parties.ChambersOfXeric");
});
after(() => PM.emitServerShutdown({}));
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel)); p.setIndex(next++); p.setUsername("olmqa" + next); p.setRegistered(true);
  p.setLocation(new core.Location(3233, 5743, 0)); p.needsPlacement = false;
  const c = new ClientConnection(channel); c.player = p;
  const messages = []; t.mock.method(p.getPacketSender(), "sendMessage", m => { messages.push(m); return p.getPacketSender(); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n); });
  return { p, c, messages };
}
function completion(t, actors, roll = 0) {
  const party = new Parties.Party(actors[0].p, { key: actors[0].p.getUsername() });
  const raid = new Raid.Raid(party); party.raid = raid;
  // Seed earned points, not a synthetic pet or mocked raid. Invoke the real completion hooks.
  for (const { p } of actors) { raid.players.add(p); raid.original.add(p.getUsername()); raid.points.set(p.getUsername(), 100000); p.setAttribute(Raid.ATTR_RAID, raid); }
  raid.totalPoints = 100000 * actors.length; raid.startCycle = 0; raid.stage = Raid.STAGE.OLM;
  t.mock.method(Math, "random", () => roll); t.mock.method(core.World, "getProcessCycle", () => 100); raid.complete();
  assert.equal(raid.duration, 100, "completion must fix the elapsed time before setting its completed flag");
  t.after(() => { raid.players.clear(); raid.destroy("test"); });
  return raid;
}
const pet = () => core.CacheDefinitions.getObjId("olmpet");
const owned = f => (f.p.getAttribute("pets.owned") ?? []).includes(pet());
const pending = (f, r) => (r.rewards.get(f.p.getUsername()) ?? []).some(x => x.id === pet());
function follower(f) { PM.emitCustomEvent("npc-drops:roll", { player: f.p, drops: [{ itemId: core.ItemIdentifiers.HELLPUPPY, amount: 1 }] }); return f.p.getAttribute("pets:current"); }
async function open(t, f) {
  const object = new core.GameObject(core.CacheDefinitions.getLocId("raids_reward_chest"), new core.Location(3233, 5744, 0), 10, 0);
  core.ObjectManager.register(object, true); t.after(() => core.ObjectManager.deregister(object, true));
  f.p.getPacketSender().sendInterfaceRemoval();
  await f.c.dispatch([{ type: "object_option", id: object.getId(), x: 3233, y: 5744, clickType: 1, action: "Search" }]); f.c.processTurnPackets();
  for (let i = 0; i < 8; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); }
}
async function button(f, name) { const uid = core.CacheDefinitions.getComponentId("raids_rewards:" + name); await f.c.dispatch([{ type: "widget_action", widgetId: uid, groupId: uid >>> 16, childId: uid & 65535, buttonNum: 1, slot: 0 }]); f.c.processTurnPackets(); }
test("real completed raid awards Olmlet on native Search and removes it from ordinary loot", async t => {
  const f = actor(t), r = completion(t, [f]); assert.equal(pending(f, r), true); assert.equal(owned(f), false);
  await open(t, f); assert.equal(owned(f), true, JSON.stringify({messages:f.messages,ui:f.p.getInterfaceId(),at:f.p.getLocation()})); assert.equal(pending(f, r), false);
  const n = f.p.getAttribute("pets:current"); assert.ok(n?.isRegistered()); assert.equal(n.getOwner(), f.p); assert.equal(n.getId(), core.CacheDefinitions.getNpcId("raids_olm_pet")); assert.equal(f.p.getAttribute("clog.items")[pet()], 1);
});
test("existing follower sends pet to backpack once across repeated Search and Bank-all", async t => {
  const f = actor(t), n = follower(f), r = completion(t, [f]); await open(t, f);
  assert.equal(f.p.getAttribute("pets:current"), n); assert.equal(f.p.getInventory().getAmount(pet()), 1);
  const ordinary = r.rewards.get(f.p.getUsername()).map(x => ({ ...x })); await button(f, "bank"); await open(t, f);
  assert.equal(f.p.getInventory().getAmount(pet()), 1); assert.equal(f.p.getBanks().reduce((a, b) => a + (b?.getAmount(pet()) ?? 0), 0), 0);
  for (const x of ordinary) assert.equal(f.p.getBanks().reduce((a, b) => a + (b?.getAmount(x.id) ?? 0), 0), x.amount);
});
test("full backpack with follower keeps ownership for Probita", async t => {
  const f = actor(t), n = follower(f), r = completion(t, [f]); while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE), false);
  await open(t, f); assert.equal(owned(f), true); assert.equal(pending(f, r), false); assert.equal(f.p.getInventory().getAmount(pet()), 0); assert.equal(f.p.getAttribute("pets:current"), n); assert.ok(f.messages.some(m => m.includes("Probita")));
});
test("full backpack without follower still receives the follower", async t => {
  const f = actor(t), r = completion(t, [f]); while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(core.ItemIdentifiers.RAKE), false);
  await open(t, f); assert.equal(owned(f), true); assert.equal(pending(f, r), false); assert.ok(f.p.getAttribute("pets:current")?.isRegistered());
});
test("searching one raider's rewards does not claim another's", async t => {
  const a = actor(t), b = actor(t), r = completion(t, [a, b]); await open(t, a); assert.equal(owned(a), true); assert.equal(owned(b), false); assert.equal(pending(b, r), false); // Only the unique receiver rolled a pet.
});
test("a common reward has no pet and stays ordinary loot", async t => {
  const f = actor(t), r = completion(t, [f], 0.99); assert.equal(pending(f, r), false); await open(t, f); assert.equal(owned(f), false); assert.ok(!f.p.getAttribute("pets:current"));
});

test("leaving before search consumes pet through ownership instead of ground loot", t => {
  const f = actor(t), r = completion(t, [f]); r.removePlayer(f.p, false);
  assert.equal(owned(f), true); assert.ok(f.p.getAttribute("pets:current")?.isRegistered()); assert.equal(pending(f, r), false);
});

test("logout before search records the earned pet before transient raid rewards disappear", t => {
  const f = actor(t), r = completion(t, [f]); r.playerLeftArea(f.p, true); PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  assert.equal(owned(f), true); assert.equal(pending(f, r), false);
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave"); const g = actor(t); PlayerSave.fromPlayer(f.p).applyToPlayer(g.p);
  assert.equal(owned(g), true);
});

test("ownership survives real bank transfers and save restoration without another award", async t => {
  const f = actor(t); follower(f); const r = completion(t, [f]); await open(t, f);
  const inv = f.p.getInventory(); f.p.getPacketSender().sendInterfaceRemoval(); f.p.getBank(0).open();
  core.Bank.deposit(f.p, pet(), inv.getSlotForItemId(pet()), 1, false);
  const tab = core.Bank.getTabForItem(f.p, pet()); core.Bank.withdraw(f.p, pet(), f.p.getBank(tab).getSlotForItemId(pet()), 1, tab);
  assert.equal(inv.getAmount(pet()), 1);
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave"); const saved = PlayerSave.fromPlayer(f.p), g = actor(t);
  saved.applyToPlayer(g.p); PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  assert.equal(owned(g), true); assert.equal(g.p.getInventory().getAmount(pet()), 1); assert.equal(g.p.getAttribute("clog.items")[pet()], 1);
  const again = completion(t, [g]); g.p.needsPlacement = false; await open(t, g); assert.equal(pending(g, again), false); assert.equal(g.p.getInventory().getAmount(pet()), 1);
});
