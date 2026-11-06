// Run after `yarn build`: node --test tests/farming-herb-sack-autostore.test.cjs
//
// Wiki (Herb sack): an open sack "will automatically store any grimy herbs that are picked up by the player",
// and herbs "harvested from herb patches and herbiboars, provided there is space for it". A closed sack "will not
// automatically store herbs". Patches already did this; the ground pickup and the herbiboar did not.
//
// The Looting bag and Ironman tests are controls: the plugin API's onGroundItemPickup wrapper skips an event an earlier
// hook handled (PluginManager.ts), so one hook takes a herb and the others never see it. Which of the bag and the sack
// takes it follows load order, so only the count is asserted. The marked-herb test is the one
// that fails without the instance check.
//
// Native fixture: the pickup is a decoded ground_item_action object through ClientConnection.dispatch. The herbiboar is
// tracked through the real Hunter producers (inspect, attack, harvest) on a real Player, with Math.random fixed so
// the trail is deterministic; it is not a packet (the Harvest option is the hook Hunter.plugin registers, called
// directly). No client ran.
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

const HOME = [3222, 3218];
const WILDERNESS = [3100, 3600];
const OPEN_LOOTING_BAG = 22586;
const STORED = "farming:stored";
const MAX_STORED = 30;

let core, I, Data, Herbi, Hunter;
let next = 9100;
const pickupPolicies = new WeakMap();
const pickupEvents = new WeakMap();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Data = require("../plugins/skills/farming/Data.Farming");
  Herbi = require("../plugins/skills/hunter/Herbiboar.Hunter");
  Hunter = require("../plugins/skills/hunter/Context.Hunter");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  core.RegionManager.loadMapFiles(...WILDERNESS);
  core.RegionManager.loadMapFiles(3700, 3820);
  PM.emitServerStartup({});
  PM.createApi("HerbPickupPolicyTest").onCustomEvent("ground-items:take", (event) => pickupPolicies.get(event.player)?.(event));
  PM.createApi("HerbPickupEventTest").onCustomEvent("ground-items:taken", (event) => pickupEvents.get(event.player)?.push({
    itemId: event.itemId, amount: event.amount, discarded: event.discarded, source: event.source,
  }));
});
after(() => PM.emitServerShutdown({}));

function actor(t, sack, at = HOME) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("herbsack" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  for (const name of ["HERBLORE", "HUNTER"]) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const npc of [...core.World.getNpcs()]) if (npc?.getOwner?.() === p) core.World.getNpcs().remove(npc);
  });
  const f = { t, p, c, inv: p.getInventory() };
  if (sack) {
    f.inv.add(new core.Item(Data.itemId(sack)), false);
    f.sack = f.inv.getItems()[0];
  }
  return f;
}

const stored = (f) => f.sack.getMetaValue(STORED) ?? {};
const storedTotal = (f) => Object.values(stored(f)).reduce((sum, n) => sum + n, 0);
const HERBS = () => [...Data.CROPS.values()].filter((c) => c.type === "HERB" && core.CacheDefinitions.getItem(c.produce).name.startsWith("Grimy ")).map((c) => c.produce);
const grimyInPack = (f) => HERBS().reduce((sum, id) => sum + f.inv.getAmount(id), 0);

function advance(n) {
  for (let i = 0; i < n; i++) core.TaskManager.process();
}

async function take(f, id, { item = new core.Item(id, 1), owner = f.p, isPublic = false } = {}) {
  core.ItemOnGroundManager.registerLocation(owner, item, f.p.getLocation().clone(), null, { public: isPublic });
  await f.c.dispatch([{ type: "ground_item_action", itemId: id, x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), option: "Take", optionIndex: 3 }]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

/** Track and stun the herbiboar through the real producers; returns its NPC. */
function stunHerbiboar(f) {
  const p = f.p;
  QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "bone_voyage").setStage(p, 11);
  const object = (id) => new core.GameObject(id, p.getLocation().clone(), 10, 0, null);
  p.setLocation(new core.Location(...Herbi.data.starts[0], 0));
  Herbi.inspect({ player: p, object: object(core.ObjectIdentifiers.ROCK_72) });
  advance(3);
  const sender = p.getPacketSender();
  for (let step = 0; !sender.getVarbit(5766) && step < 8; step++) {
    const edge = Herbi.data.edges.find((e) => sender.getVarbit(e[0]) >= 3);
    assert.ok(edge, "a trail edge is showing");
    p.setLocation(new core.Location(...edge[sender.getVarbit(edge[0]) === 4 ? 2 : 1].slice(1), 0));
    Herbi.inspect({ player: p, object: object(core.ObjectIdentifiers.MUDDY_PATCH) });
    advance(3);
  }
  assert.ok(sender.getVarbit(5766) > 0, "the trail leads to a tunnel");
  p.setLocation(new core.Location(...Herbi.data.ends[sender.getVarbit(5766) - 1], 0));
  Herbi.attack({ player: p, object: object(core.ObjectIdentifiers.TUNNEL_47) });
  advance(3);
  const npc = [...core.World.getNpcs()].find((n) => n?.getOwner?.() === p && n.getId() === core.NpcIdentifiers.HERBIBOAR);
  assert.ok(npc, "the herbiboar is stunned");
  return npc;
}

async function harvest(t, f) {
  const random = Math.random;
  Math.random = () => 0.5;
  t.after(() => { Math.random = random; });
  const npc = stunHerbiboar(f);
  const held = () => grimyInPack(f) + (f.sack ? storedTotal(f) : 0);
  const before = held();
  Herbi.harvest({ player: f.p, npc });
  advance(5);
  assert.equal(npc.isRegistered(), false, "control: the harvest finished");
  return held() - before;
}

test("an open sack takes a grimy herb picked up from the ground", async (t) => {
  const f = actor(t, "Open herb sack");
  const guam = I.GRIMY_GUAM_LEAF;
  await take(f, guam);
  assert.equal(stored(f)[guam], 1, "in the sack");
  assert.equal(f.inv.getAmount(guam), 0, "not in the pack");
  assert.equal(core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), guam, f.p.getLocation(), null), null, "off the ground");
});

test("herb sack pickup uses the normal pickup sound only after a successful take", async (t) => {
  const success = actor(t, "Open herb sack"), denied = actor(t, "Open silklined herb sack");
  const sounds = [];
  const sendSound = core.Sounds.sendSound.bind(core.Sounds);
  t.mock.method(core.Sounds, "sendSound", (player, sound, ...rest) => {
    if (player === success.p || player === denied.p) sounds.push([player, sound]);
    return sendSound(player, sound, ...rest);
  });
  t.after(() => {
    const ground = core.ItemOnGroundManager.getGroundItem(denied.p.getUsername(), I.GRIMY_GUAM_LEAF, denied.p.getLocation(), null);
    if (ground) core.ItemOnGroundManager.deregister(ground);
  });
  pickupPolicies.set(denied.p, (event) => { event.allow = false; });
  await take(success, I.GRIMY_GUAM_LEAF);
  assert.equal(stored(success)[I.GRIMY_GUAM_LEAF], 1);
  await take(denied, I.GRIMY_GUAM_LEAF);
  assert.equal(storedTotal(denied), 0);
  assert.deepEqual(sounds, [[success.p, core.Sound.PICK_UP_ITEM]]);
});

for (const sack of ["Open herb sack", "Open silklined herb sack"]) {
  test(`${sack} respects a refused ground take`, async (t) => {
    const f = actor(t, sack), herb = I.GRIMY_GUAM_LEAF, events = [];
    let calls = 0;
    pickupPolicies.set(f.p, (event) => { calls++; event.allow = false; });
    pickupEvents.set(f.p, events);
    t.after(() => {
      const ground = core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), herb, f.p.getLocation(), null);
      if (ground) core.ItemOnGroundManager.deregister(ground);
    });
    await take(f, herb);
    assert.equal(calls, 1, "the take policy was consulted");
    assert.equal(storedTotal(f), 0, "the sack did not take a refused herb");
    assert.equal(f.inv.getAmount(herb), 0, "the inventory did not take it");
    assert.ok(core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), herb, f.p.getLocation(), null), "the herb remains on the ground");
    assert.deepEqual(events, []);
  });

  test(`${sack} reports a successfully stored ground herb`, async (t) => {
    const f = actor(t, sack), herb = I.GRIMY_GUAM_LEAF, events = [];
    pickupEvents.set(f.p, events);
    await take(f, herb);
    assert.equal(stored(f)[herb], 1);
    assert.deepEqual(events, [{ itemId: herb, amount: 1, discarded: 0, source: "pickup" }]);
  });
}

test("a nested ground take during herb policy does not duplicate the herb", async (t) => {
  const f = actor(t, "Open herb sack"), herb = I.GRIMY_GUAM_LEAF, events = [];
  let calls = 0;
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => {
    calls++;
    if (calls === 1) core.ItemOnGroundManager.pickup(f.p, event.groundItem);
  });
  await take(f, herb);
  assert.equal(calls, 1);
  assert.equal(stored(f)[herb], 1);
  assert.equal(f.inv.getAmount(herb), 0);
  assert.deepEqual(events, [{ itemId: herb, amount: 1, discarded: 0, source: "pickup" }]);
});

test("a policy that changes a ground herb cancels storage", async (t) => {
  const f = actor(t, "Open herb sack"), herb = I.GRIMY_GUAM_LEAF, events = [];
  pickupEvents.set(f.p, events);
  pickupPolicies.set(f.p, (event) => event.groundItem.getItem().setMetaValue("herb-test:changed", 1));
  t.after(() => {
    const ground = core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), herb, f.p.getLocation(), null);
    if (ground) core.ItemOnGroundManager.deregister(ground);
  });
  await take(f, herb);
  assert.equal(storedTotal(f), 0);
  assert.equal(f.inv.getAmount(herb), 0);
  assert.equal(core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), herb, f.p.getLocation(), null)?.getItem().getMetaValue("herb-test:changed"), 1);
  assert.deepEqual(events, []);
});

test("a closed sack does not take a picked up herb", async (t) => {
  const f = actor(t, "Herb sack");
  await take(f, I.GRIMY_GUAM_LEAF);
  assert.equal(f.inv.getAmount(I.GRIMY_GUAM_LEAF), 1, "in the pack");
  assert.equal(storedTotal(f), 0, "nothing stored");
});

test("an open sack full of that herb leaves the pickup in the pack", async (t) => {
  const f = actor(t, "Open herb sack");
  f.sack.setMetaValue(STORED, { [I.GRIMY_GUAM_LEAF]: MAX_STORED });
  await take(f, I.GRIMY_GUAM_LEAF);
  assert.equal(f.inv.getAmount(I.GRIMY_GUAM_LEAF), 1, "in the pack");
  assert.equal(stored(f)[I.GRIMY_GUAM_LEAF], MAX_STORED, "the sack is unchanged");
});

test("an open sack does not take a herb that is not grimy", async (t) => {
  const f = actor(t, "Open herb sack");
  await take(f, I.GUAM_LEAF);
  assert.equal(f.inv.getAmount(I.GUAM_LEAF), 1, "in the pack");
  assert.equal(storedTotal(f), 0, "nothing stored");
});

test("an open sack takes the herbs harvested from a herbiboar", async (t) => {
  const f = actor(t, "Open herb sack");
  const gained = await harvest(t, f);
  t.diagnostic(`gained ${gained}, stored ${JSON.stringify(stored(f))}`);
  assert.ok(gained >= 1, "control: herbs were harvested");
  assert.equal(grimyInPack(f), 0, "none left in the pack");
  assert.equal(storedTotal(f), gained, "all in the sack");
});

test("a closed sack leaves the herbiboar's herbs in the pack", async (t) => {
  const f = actor(t, "Herb sack");
  const gained = await harvest(t, f);
  assert.ok(gained >= 1, "control: herbs were harvested");
  assert.equal(grimyInPack(f), gained, "all in the pack");
  assert.equal(storedTotal(f), 0, "nothing stored");
});

test("an open sack full of every herb leaves the herbiboar's herbs in the pack", async (t) => {
  const f = actor(t, "Open herb sack");
  f.sack.setMetaValue(STORED, Object.fromEntries(HERBS().map((id) => [id, MAX_STORED])));
  const total = storedTotal(f);
  const gained = await harvest(t, f);
  assert.ok(gained >= 1, "control: herbs were harvested");
  assert.equal(storedTotal(f), total, "the sack is unchanged");
  assert.equal(grimyInPack(f), gained, "all in the pack");
});

test("an open sack takes what fits of the herbiboar's herbs and the pack takes the rest", async (t) => {
  const f = actor(t, "Open herb sack");
  // With Math.random fixed the herbiboar always gives the same herb; fill all but one of each type.
  f.sack.setMetaValue(STORED, Object.fromEntries(HERBS().map((id) => [id, MAX_STORED - 1])));
  const total = storedTotal(f);
  const gained = await harvest(t, f);
  assert.ok(gained >= 1, "control: herbs were harvested");
  assert.equal(storedTotal(f), total + 1, "one more fits, then the type is full");
  assert.equal(grimyInPack(f), gained - 1, "the rest is in the pack");
});

const lootingBagContents = (f) => (f.inv.getItems().find((i) => i?.getId() === OPEN_LOOTING_BAG)?.getMetaValue("lootingBag") ?? []);
const onFloor = (f, id) => core.ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), null);

test("control: an open looting bag and an open sack in the Wilderness keep a picked up herb to one copy", async (t) => {
  const f = actor(t, "Open herb sack", WILDERNESS);
  f.inv.add(new core.Item(OPEN_LOOTING_BAG), false);
  await take(f, I.GRIMY_GUAM_LEAF);
  const inBag = lootingBagContents(f).filter((e) => e.id === I.GRIMY_GUAM_LEAF).reduce((sum, e) => sum + e.amount, 0);
  const inPack = f.inv.getAmount(I.GRIMY_GUAM_LEAF);
  t.diagnostic(`bag ${inBag}, sack ${JSON.stringify(stored(f))}, pack ${inPack}`);
  // Which one takes it follows the hooks' load order (Farming's runs before the Looting bag's); one herb must stay one herb.
  assert.equal(inBag + storedTotal(f) + inPack, 1, "one herb in, one herb held");
  assert.equal(onFloor(f, I.GRIMY_GUAM_LEAF), null, "and it is off the ground");
});

test("control: an Ironman can't take another player's drop into an open sack", async (t) => {
  const f = actor(t, "Open herb sack");
  const other = actor(t);
  require("../plugins/modes/ironman/Common.Ironman").setMode(f.p, "ironman");
  await take(f, I.GRIMY_GUAM_LEAF, { owner: other.p, isPublic: true });
  // The click finds a ground item by id and tile, so a leftover herb would answer the next test's click.
  t.after(() => { const left = onFloor(f, I.GRIMY_GUAM_LEAF); if (left) core.ItemOnGroundManager.deregister(left); });
  assert.equal(storedTotal(f), 0, "nothing stored");
  assert.equal(f.inv.getAmount(I.GRIMY_GUAM_LEAF), 0, "nothing in the pack");
  assert.ok(onFloor(f, I.GRIMY_GUAM_LEAF), "the herb is still on the ground");
});

test("a herb with item metadata is not laundered into the sack", async (t) => {
  const f = actor(t, "Open herb sack");
  // Its own herb id: the click finds a ground item by id and tile, and other tests leave plain Guam leaves around.
  const item = new core.Item(I.GRIMY_RANARR_WEED, 1).setMetaValue("test:mark", 1);
  await take(f, I.GRIMY_RANARR_WEED, { item });
  assert.equal(storedTotal(f), 0, "not stored");
  const held = f.inv.getItems().find((i) => i?.getId() === I.GRIMY_RANARR_WEED);
  assert.equal(held?.getMetaValue("test:mark"), 1, "the marked herb itself is in the pack");
});

test("a refused herbiboar harvest (full sack, full pack) stores nothing and keeps the herbs for a retry", async (t) => {
  const f = actor(t, "Open herb sack");
  f.sack.setMetaValue(STORED, Object.fromEntries(HERBS().map((id) => [id, MAX_STORED])));
  const random = Math.random;
  Math.random = () => 0.5;
  t.after(() => { Math.random = random; });
  const npc = stunHerbiboar(f);
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
  const total = storedTotal(f);
  Herbi.harvest({ player: f.p, npc });
  advance(5);
  assert.equal(npc.isRegistered(), true, "the herbiboar stays: the harvest was refused");
  assert.equal(storedTotal(f), total, "the sack is unchanged");
  assert.equal(grimyInPack(f), 0, "no herbs in the pack");
  for (let i = 0; i < 4; i++) f.inv.deleteNumber(I.RAKE, 1);
  f.inv.refreshItems();
  Herbi.harvest({ player: f.p, npc });
  advance(5);
  assert.equal(npc.isRegistered(), false, "the retry works");
  assert.ok(grimyInPack(f) >= 1, "the herbs arrive in the pack");
  assert.equal(storedTotal(f), total, "the full sack still has no room");
});
