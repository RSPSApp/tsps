// Run after `yarn build`: node --test tests/kraken.test.cjs
// Kraken Cove: the task gate on the area's attacks, including the tentacles that
// belong to the Kraken fight but carry no Slayer task of their own.
const assert = require("node:assert/strict");
const { test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";

require("../dist/Server").Server.installProductionPathResolver();
const { Projectile } = require("../dist/game/model/Projectile");
const { Location } = require("../dist/game/model/Location");
const Shared = require("../plugins/bosses/kraken/Shared.Kraken");
const { areaClass } = require("../plugins/bosses/kraken/Area.Kraken");
const Fight = require("../plugins/bosses/kraken/Fight.Kraken");

class Area {}
class Boundary {}

const requests = [];
let onTaskAnswer = () => false;

Shared.bind({
  core: {
    Area,
    Boundary,
    Projectile,
    CombatMethod: class {},
    CombatType: { MAGIC: "magic" },
    PendingHit: class {
      constructor(attacker, target, method, delay) { this.delay = delay; }
      getDelay() { return this.delay; }
    },
    NpcIdentifiers: {
      WHIRLPOOL: 493,
      CAVE_KRAKEN: 492,
      WHIRLPOOL_2: 496,
      KRAKEN: 494,
      WHIRLPOOL_3: 5534,
      ENORMOUS_TENTACLE: 5535,
    },
  },
  emitCustomEvent: (name, request) => {
    assert.equal(name, "slayer:on-task");
    requests.push(request);
    request.onTask = onTaskAnswer(request);
  },
});

const area = new (areaClass())();
const player = { isPlayer: () => true, getAsPlayer: () => player };
const npc = (id) => ({ isNpc: () => true, getId: () => id });

test("the cove refuses attacks off a Kraken or cave kraken task", () => {
  onTaskAnswer = () => false;
  for (const id of [Shared.ids().CAVE_KRAKEN, Shared.ids().BOSS, Shared.ids().TENTACLE]) {
    assert.equal(area.canAttack(player, npc(id)), false);
  }
  assert.equal(area.canAttack({ isPlayer: () => false }, npc(Shared.ids().BOSS)), null);
  assert.equal(area.canAttack(player, { isNpc: () => false }), null);
});

test("the cove allows attacks covered by the player's task", () => {
  onTaskAnswer = () => true;
  for (const id of [Shared.ids().CAVE_KRAKEN, Shared.ids().BOSS, Shared.ids().TENTACLE]) {
    assert.equal(area.canAttack(player, npc(id)), null);
  }
});

test("a tentacle is asked about as the Kraken, which carries the task", () => {
  const tentacle = npc(Shared.ids().TENTACLE);
  onTaskAnswer = (request) => request.npc === tentacle && request.npcId === Shared.ids().BOSS;
  assert.equal(Shared.onTask(player, tentacle), true);
  assert.equal(requests.at(-1).npcId, Shared.ids().BOSS);
});

test("the Kraken's hit lands with its legacy-shape projectile at any range (#1862)", (t) => {
  const sent = [];
  t.mock.method(Projectile.prototype, "sendProjectile", function () { sent.push(this); });
  const mobile = (x, y, size) => ({ getLocation: () => new Location(x, y, 0), getSize: () => size, getPrivateArea: () => null, getIndex: () => 1, isPlayer: () => false, getAttackAnim: () => -1, getId: () => 494 });
  const kraken = mobile(2278, 10034, 5);
  for (const tiles of [1, 10]) {
    const player = mobile(2280 + tiles, 10036, 1);
    const method = new (Fight.methodClass())();
    method.start(kraken, player);
    const shot = sent.at(-1);
    // The legacy shape (0/20, 43/31) is sent as 51 -> 46 + 10 a tile.
    assert.deepEqual([shot.delay, shot.speed, shot.startHeight, shot.endHeight], [0, 20, 43, 31]);
    const end = 46 + 10 * shot.start.getDistance(shot.end);
    assert.equal(method.hits(kraken, player)[0].getDelay(), Math.ceil(end / 30), `${tiles} tiles`);
  }
});

// Actual cache/player/registered-object fixture. This block is intentionally
// initialized after the four existing facade controls, which own Shared.bind.
let native;
async function nativeBootstrap() {
  if (native) return native;
  const path = require("node:path");
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  const { PluginManager } = require("../dist/plugins/PluginManager");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  RegionManager.loadMapFiles(2280, 10017);
  const core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("KrakenNativeEntryTest");
  require("../plugins/items/ItemDefinitionLoader.plugin").register(api);
  require("../plugins/interface/BankPin.plugin").register(api);
  const SlayerData = require("../plugins/skills/slayer/Data.Slayer");
  const SlayerState = require("../plugins/skills/slayer/State.Slayer");
  const SlayerTasks = require("../plugins/skills/slayer/Tasks.Slayer");
  SlayerData.init(api);
  SlayerState.init(api);
  SlayerTasks.init(api);
  SlayerTasks.attach(api);
  // The four legacy facade controls memoize a class with their fake CombatMethod.
  // Native registration must instantiate the module against the real core instead.
  delete require.cache[require.resolve("../plugins/bosses/kraken/Fight.Kraken")];
  require("../plugins/bosses/Kraken.plugin").register(api);
  require("../plugins/npcs/NpcDrops.plugin").register(api);
  const claims = [];
  const npcDeaths = [];
  api.onCustomEvent("npc-drops:claim", event => claims.push(event));
  api.onNpcDeath(event => npcDeaths.push(event.npc));
  native = { core, PluginManager, api, claims, npcDeaths };
  return native;
}

let nextNativeActor = 0;
function assertNativeReach(core, player, object) {
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
  const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
  const location = object.getLocation(), type = object.getType();
  const definition = ObjectDefinition.forPlayer(object.getId(), player);
  const footprint = type === 22 ? definition : (ObjectDefinition.forId(object.getId()) ?? definition);
  const rectangular = type === 10 || type === 11 || type === 22;
  assert.equal(RegionManager.blocked(player.getLocation(), player.getPrivateArea()), false, "standing tile is walkable");
  assert.equal(PathFinder.reachedObject(player, location.getX(), location.getY(),
    rectangular ? footprint.getSizeX() : 1, rectangular ? footprint.getSizeY() : 1,
    object.getFace(), rectangular ? 10 : type, rectangular ? definition.getBlockingMask() : 0), true,
  "the actual standing tile reaches the cache object");
}

function nativeActor(t, core, sharedErrors = null) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const connection = new ClientConnection(channel);
  const name = `kraknative${++nextNativeActor}`;
  const rooms = [];
  const deaths = [];
  const errors = sharedErrors ?? [];
  if (!sharedErrors) t.mock.method(console, "error", (...args) => errors.push(args));
  t.after(() => {
    try {
      try { player.closeInterruptibleInterfaces(); }
      finally {
        try {
          const area = player.getPrivateArea();
          if (area?.isKrakenInstance && area.hasMember(player)) area.leave(player, false);
        } finally {
          try {
            for (const npc of deaths) {
              const limit = Math.max(100, (npc.getCurrentDefinition()?.getDeathTicks?.() ?? 0) + 10);
              for (let i = 0; i < limit && npc.isDyingFunction(); i++) core.TaskManager.process();
            }
            if (deaths.some(npc => core.World.getRemoveNPCQueue().includes(npc))) core.World.process();
          } finally {
            core.TaskManager.cancelTasks(player);
            core.TaskManager.cancelTasks(player.getIndex());
          }
        }
      }
    } finally {
      try { if (player.isRegistered()) core.World.getPlayers().remove(player); }
      finally {
        assert.equal(player.isRegistered(), false);
        assert.equal(core.TaskManager.hasActiveTask(player), false);
        assert.equal(core.TaskManager.hasActiveTask(player.getIndex()), false);
        assert.equal(require("../dist/game/model/menu/MultiChatboxPrompt").MultiChatboxPrompt.getPending(player), null);
        for (const npc of deaths) {
          assert.equal(npc.isDyingFunction(), false);
          assert.equal(core.World.getRemoveNPCQueue().includes(npc), false);
        }
        for (const room of rooms) {
          assert.equal(room.isDestroyed(), true);
          assert.equal(core.TaskManager.hasActiveTask(room), false);
          assert.equal([...core.World.getNpcs()].some(npc => npc.getPrivateArea() === room), false);
          assert.equal(core.World.getAddNPCQueue().some(npc => npc.getPrivateArea() === room), false);
        }
        assert.deepEqual(errors, [], "no caught native or cleanup errors");
      }
    }
  });
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  assert.notEqual(player.getLongUsername(), 0n);
  player.setAttribute("bot-skip-persistence", true);
  connection.player = player;
  assert.equal(core.World.getPlayers().add(player), true);
  player.moveTo(new core.Location(2280, 10016, 0));
  require("../dist/game/model/areas/AreaManager").AreaManager.process(player);
  player.setNeedsPlacement(false);
  assert.equal(player.getPrivateArea(), null);
  assert.ok(player.getHitpoints() > 0);
  const location = new core.Location(2280, 10017, 0);
  const object = core.World.findCacheObject(player, core.ObjectIdentifiers.CREVICE_4, location);
  assert.ok(object, "active map exposes the actual entrance crevice");
  const actions = object.getDefinition().getInteractions();
  assert.equal(actions[0], "Enter");
  assert.equal(actions[1], "Private");
  assert.equal(actions[2], "Peek");
  assertNativeReach(core, player, object);
  return { player, connection, object, rooms, deaths, errors };
}

function nativeObject(PluginManager, actor, clickType) {
  const event = { player: actor.player, object: actor.object, objectId: actor.object.getId(),
    location: actor.object.getLocation(), clickType, handled: false };
  return PluginManager.emitObjectInteraction(event);
}

async function nativeChoice(actor, option) {
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  await actor.connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: option }]);
  actor.connection.processTurnPackets();
}

function tickUntil(core, predicate, limit, message) {
  for (let tick = 0; tick < limit && !predicate(); tick++) core.World.process();
  assert.equal(predicate(), true, message);
}

function killNativeNpc(t, core, actor, npc, transformedId) {
  actor.deaths.push(npc);
  npc.setNpcTransformationId(transformedId);
  const combat = npc.getCombat();
  t.mock.method(combat, "getKiller", () => actor.player);
  t.mock.method(combat, "getRecentDamagers", () => [actor.player]);
  npc.setHitpoints(0);
}

test("registered private entrance offers a native prompt and conserves a cancelled fee", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 30000);
  assert.equal(nativeObject(PluginManager, actor, 1), true, "public Enter remains registered");
  assert.equal(actor.player.getLocation().equals(new core.Location(2280, 10022, 0)), true);
  require("../dist/game/model/areas/AreaManager").AreaManager.process(actor.player);
  actor.player.setNeedsPlacement(false);
  const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
  assert.ok(exit, "the active public map exposes the return crevice");
  assertNativeReach(core, actor.player, exit);
  assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true, "public Use remains registered");
  assert.equal(actor.player.getLocation().equals(new core.Location(2280, 10016, 0)), true);
  assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 30000, "public round trip has no fee");
  require("../dist/game/model/areas/AreaManager").AreaManager.process(actor.player);
  actor.player.setNeedsPlacement(false);
  assertNativeReach(core, actor.player, actor.object);
  assert.equal(nativeObject(PluginManager, actor, 2), true, "Private is handled by the registered crevice");
  assert.deepEqual(MultiChatboxPrompt.getPending(actor.player)?.options,
    ["Pay from inventory", "Pay from bank", "Cancel"]);
  await nativeChoice(actor, 3);
  assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 30000);
  assert.equal(actor.player.getPrivateArea(), null);
});

test("inventory rental creates an isolated room and exit closes it", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 30000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 5000);
  assert.equal(room?.owner === actor.player, true);
  assert.equal(room.getPlayers().includes(actor.player), true);
  assert.equal(room.getNpcs().length, 5);
  assert.equal(room.getNpcs().every(npc => npc.getPrivateArea() === room), true);
  const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
  assert.ok(exit, "active map exposes the inside exit");
  assertNativeReach(core, actor.player, exit);
  assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true);
  assert.equal(actor.player.getPrivateArea(), null);
  assert.equal(room.isDestroyed(), true);
  assert.equal(room.getNpcs().filter(npc => npc.isRegistered()).length, 0);
});

test("private floor items last thirty minutes and are removed on exit", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const { ItemOnGroundManager: ground } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  const publicItem = ground.registerLocation(actor.player, new core.Item(core.ItemIdentifiers.COINS, 1), actor.player.getLocation().clone());
  assert.equal(publicItem.getDespawnDelay(), 300, "public floor lifetime remains unchanged");
  ground.deregister(publicItem);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25010);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  assert.ok(room?.isKrakenInstance);
  const position = actor.player.getLocation().clone();
  const slot = actor.player.getInventory().getItems().findIndex(item => item?.getId() === core.ItemIdentifiers.COINS);
  assert.ok(slot >= 0);
  require("../dist/net/packet/impl/DropItemPacketListener").DropItemPacketListener.drop(
    actor.player, core.ItemIdentifiers.COINS, core.Inventory.INTERFACE_ID, slot);
  const item = core.World.getItems().find(item => item.getPrivateArea() === room && !item.isPendingRemoval());
  assert.ok(item, "the ordinary inventory drop reaches the room floor");
  assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0);
  const custom = ground.registerLocation(actor.player, new core.Item(core.ItemIdentifiers.COINS, 2), position,
    room, { despawnDelay: 600 });
  assert.equal(item.getDespawnDelay(), 3000);
  assert.equal(custom.getDespawnDelay(), 600, "explicit lifetimes remain intact");
  assert.equal(core.World.getItems().includes(custom), true, "different lifetimes do not merge");
  for (let tick = 0; tick < 2999; tick++) item.process();
  assert.equal(item.isPendingRemoval(), false);
  item.process();
  assert.equal(item.isPendingRemoval(), true);
  const remaining = ground.registerLocation(actor.player, new core.Item(core.ItemIdentifiers.COINS, 3), position);
  const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
  assertNativeReach(core, actor.player, exit);
  assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true);
  assert.equal(remaining.isPendingRemoval(), true);
  assert.equal(custom.isPendingRemoval(), true);
});

test("a second player in the public cove cannot see the owner's private actors", async t => {
  const { core, PluginManager } = await nativeBootstrap(), owner = nativeActor(t, core);
  owner.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, owner, 2), true);
  await nativeChoice(owner, 1);
  const room = owner.player.getPrivateArea();
  owner.rooms.push(room);
  const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
  assert.ok(boss?.isRegistered());
  const other = nativeActor(t, core, owner.errors);
  assert.equal(other.player.getPrivateArea(), null);
  core.World.process();
  assert.equal(owner.player.getLocalNpcs().includes(boss), true, "owner sees the private boss actor");
  assert.equal(other.player.getLocalNpcs().includes(boss), false, "public player does not see the private boss actor");
});

test("the real Slayer task producer controls public and private attack guards", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const Data = require("../plugins/skills/slayer/Data.Slayer");
  const State = require("../plugins/skills/slayer/State.Slayer");
  const publicArea = actor.player.getArea();
  assert.equal(publicArea?.getName(), "Kraken Cove");
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
  assert.ok(boss);
  boss.setNpcTransformationId(core.NpcIdentifiers.KRAKEN);
  assert.equal(publicArea.canAttack(actor.player, boss), false);
  assert.equal(room.canAttack(actor.player, boss), false);
  const taskId = Data.npcTaskId(core.NpcIdentifiers.KRAKEN);
  assert.ok(Number.isInteger(taskId) && taskId > 0, "active cache binds Kraken to a Slayer task");
  State.setVarp(actor.player, "slayer_target", taskId);
  State.setVarp(actor.player, "slayer_count", 10);
  assert.equal(publicArea.canAttack(actor.player, boss), null);
  assert.equal(room.canAttack(actor.player, boss), null);
});

test("bank rental debits exactly one fee while insufficient funds change nothing", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const id = core.ItemIdentifiers.COINS, bank = actor.player.getBank(0);
  bank.adds(id, 24999);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 2);
  assert.equal(bank.getAmount(id), 24999);
  assert.equal(actor.player.getPrivateArea(), null);
  bank.adds(id, 1);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 2);
  assert.equal(bank.getAmount(id), 0);
  assert.equal(actor.player.getPrivateArea()?.owner === actor.player, true);
  actor.rooms.push(actor.player.getPrivateArea());
});

for (const moveDuringPin of [false, true]) {
  test(`bank PIN ${moveDuringPin ? "cannot resume a stale room prompt" : "returns to the payment prompt without charging"}`, async t => {
    const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
    const Common = require("../plugins/interface/bankpin/Common.BankPin");
    const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
    const id = core.ItemIdentifiers.COINS, bank = actor.player.getBank(0);
    bank.adds(id, 25000);
    Common.set(actor.player, "hash", Common.hash(actor.player, "1234"));
    assert.equal(Common.hasPin(actor.player), true);
    assert.equal(Common.isUnlocked(actor.player), false);
    assert.equal(nativeObject(PluginManager, actor, 2), true);
    await nativeChoice(actor, 2);
    assert.ok(actor.player.getEnteredAmountAction(), "the actual PIN keypad owns the amount input");
    assert.equal(bank.getAmount(id), 25000);
    if (moveDuringPin) actor.player.moveTo(new core.Location(2280, 10015, 0));
    await actor.connection.dispatch([{ type: "dialogue_amount", amount: 1234 }]);
    actor.connection.processTurnPackets();
    for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
    assert.equal(Common.isUnlocked(actor.player), true);
    assert.equal(bank.getAmount(id), 25000, "PIN entry alone never charges");
    if (moveDuringPin) {
      assert.equal(MultiChatboxPrompt.getPending(actor.player), null);
      assert.equal(actor.player.getPrivateArea(), null);
    } else {
      assert.deepEqual(MultiChatboxPrompt.getPending(actor.player)?.options,
        ["Pay from inventory", "Pay from bank", "Cancel"]);
      await nativeChoice(actor, 2);
      assert.equal(bank.getAmount(id), 0);
      assert.ok(actor.player.getPrivateArea()?.hasMember(actor.player));
      actor.rooms.push(actor.player.getPrivateArea());
    }
  });
}

test("a PIN relocked during room preparation refuses debit and removes prepared actors", async t => {
  const { core, PluginManager, api } = await nativeBootstrap(), actor = nativeActor(t, core);
  const Common = require("../plugins/interface/bankpin/Common.BankPin");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  const bank = actor.player.getBank(0), id = core.ItemIdentifiers.COINS;
  bank.adds(id, 25000);
  Common.set(actor.player, "hash", Common.hash(actor.player, "1234"));
  Common.unlock(actor.player);
  const created = [], original = api.spawnNpc;
  t.mock.method(api, "spawnNpc", definition => {
    const npc = original.call(api, definition);
    created.push(npc);
    if (created.length === 5) Common.lock(actor.player);
    return npc;
  });
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 2);
  assert.equal(created.length, 5);
  assert.ok(actor.player.getEnteredAmountAction(), "commit recheck opens the actual PIN keypad");
  assert.equal(bank.getAmount(id), 25000);
  assert.equal(actor.player.getPrivateArea(), null);
  assert.equal(created.every(npc => !npc.isRegistered()), true);
  assert.equal(created.some(npc => core.World.getAddNPCQueue().includes(npc)), false);
  await actor.connection.dispatch([{ type: "dialogue_amount", amount: 1234 }]);
  actor.connection.processTurnPackets();
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  assert.ok(MultiChatboxPrompt.getPending(actor.player));
  assert.equal(bank.getAmount(id), 25000, "resuming asks again and does not charge automatically");
});

test("a PIN resume does not replace an unrelated interface", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const Common = require("../plugins/interface/bankpin/Common.BankPin");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  const bank = actor.player.getBank(0), id = core.ItemIdentifiers.COINS;
  bank.adds(id, 25000);
  Common.set(actor.player, "hash", Common.hash(actor.player, "1234"));
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 2);
  assert.ok(actor.player.getEnteredAmountAction());
  await actor.connection.dispatch([{ type: "dialogue_amount", amount: 1234 }]);
  actor.connection.processTurnPackets();
  actor.player.getPacketSender().sendInterface(12);
  assert.equal(actor.player.getInterfaceId(), 12);
  for (let tick = 0; tick < 3; tick++) core.TaskManager.process();
  assert.equal(actor.player.getInterfaceId(), 12);
  assert.equal(MultiChatboxPrompt.getPending(actor.player), null);
  assert.equal(bank.getAmount(id), 25000);
  assert.equal(actor.player.getPrivateArea(), null);
});

test("a stale private-entry prompt does not debit or create a room", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const id = core.ItemIdentifiers.COINS;
  actor.player.getInventory().adds(id, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  actor.player.moveTo(new core.Location(2280, 10015, 0));
  await nativeChoice(actor, 1);
  assert.equal(actor.player.getInventory().getAmount(id), 25000);
  assert.equal(actor.player.getPrivateArea(), null);
});

test("failed NPC admission removes its queued actor without taking the fee", async t => {
  const { core, PluginManager, api } = await nativeBootstrap(), actor = nativeActor(t, core);
  const id = core.ItemIdentifiers.COINS, queue = core.World.getAddNPCQueue();
  const worldBefore = [...core.World.getNpcs()];
  const queueBefore = [...queue];
  actor.player.getInventory().adds(id, 25000);
  let queued;
  t.mock.method(api, "spawnNpc", ({ id, x, y, z }) => {
    queued = core.NPC.create(id, new core.Location(x, y, z));
    queue.push(queued);
    return queued;
  });
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  assert.ok(queued);
  assert.equal(queue.includes(queued), false);
  assert.deepEqual([...core.World.getNpcs()], worldBefore);
  assert.deepEqual([...queue], queueBefore);
  assert.ok(!queued.isRegistered());
  assert.equal(actor.player.getInventory().getAmount(id), 25000);
  assert.equal(actor.player.getPrivateArea(), null);
});

test("an incomplete debit restores the original slots and values", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const id = core.ItemIdentifiers.COINS, inventory = actor.player.getInventory();
  const worldBefore = [...core.World.getNpcs()], queueBefore = [...core.World.getAddNPCQueue()];
  const bank = actor.player.getBank(0);
  bank.adds(id, 37);
  const coin = new core.Item(id, 25000, { test: { marker: 7 } });
  inventory.setItem(0, coin);
  const original = inventory.deleteNumber;
  t.mock.method(inventory, "deleteNumber", function(itemId, amount) {
    coin.getMeta().test.marker = 9;
    return original.call(this, itemId, amount - 1);
  });
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  assert.equal(inventory.getItems()[0] === coin, true);
  assert.equal(coin.getId(), id);
  assert.equal(coin.getAmount(), 25000);
  assert.deepEqual(coin.getMeta(), { test: { marker: 7 } });
  assert.equal(bank.getAmount(id), 37, "unselected bank source remains unchanged");
  assert.deepEqual([...core.World.getNpcs()], worldBefore);
  assert.deepEqual([...core.World.getAddNPCQueue()], queueBefore);
  assert.equal(actor.player.getPrivateArea(), null);
});

test("an injected failure after entry restores the paid slot and destroys the prepared room", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const id = core.ItemIdentifiers.COINS, inventory = actor.player.getInventory();
  const coin = new core.Item(id, 25000, { test: { marker: 11 } });
  inventory.setItem(0, coin);
  const publicArea = actor.player.getArea(), position = actor.player.getLocation().clone();
  const worldBefore = [...core.World.getNpcs()], queueBefore = [...core.World.getAddNPCQueue()];
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  const Instance = require("../plugins/bosses/kraken/Instance.Kraken");
  const original = Instance.enter;
  let entered = false, balanceAtEntry = null;
  t.mock.method(Instance, "enter", (room, player) => {
    original(room, player);
    actor.rooms.push(room);
    entered = room.hasMember(player) && player.getPrivateArea() === room;
    balanceAtEntry = inventory.getAmount(id);
    throw new Error("injected entry failure after the fee debit");
  });
  await nativeChoice(actor, 1);
  assert.equal(entered, true, "real room membership was established before the injected failure");
  assert.equal(balanceAtEntry, 0, "the fee was actually debited before the injected failure");
  assert.equal(inventory.getItems()[0] === coin, true);
  assert.equal(coin.getId(), id);
  assert.equal(coin.getAmount(), 25000);
  assert.deepEqual(coin.getMeta(), { test: { marker: 11 } });
  assert.equal(actor.player.getPrivateArea(), null);
  assert.equal(actor.player.getLocation().equals(position), true);
  AreaManager.process(actor.player);
  assert.equal(actor.player.getArea() === publicArea, true, "normal area processing restores public membership");
  assert.deepEqual([...core.World.getNpcs()], worldBefore);
  assert.deepEqual([...core.World.getAddNPCQueue()], queueBefore);
});

test("a cancelled teleport keeps the room; an actual completed teleport closes it", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  assert.ok(room?.hasMember(actor.player));
  const destination = new core.Location(2279, 10016, 0);
  actor.player.setNeedsPlacement(false);
  assert.equal(core.TeleportHandler.checkReqs(actor.player, destination), true);
  core.TeleportHandler.teleport(actor.player, destination, core.TeleportType.NORMAL, false);
  core.TaskManager.cancelTasks(actor.player);
  assert.equal(actor.player.getPrivateArea(), room);
  assert.equal(room.isDestroyed(), false);
  assert.equal(core.TeleportHandler.checkReqs(actor.player, destination), true);
  core.TeleportHandler.teleport(actor.player, destination, core.TeleportType.NORMAL, false);
  for (let i = 0; i < core.TeleportType.NORMAL.getStartTick() + 2; i++) {
    core.TaskManager.process();
    AreaManager.process(actor.player);
  }
  assert.equal(actor.player.getLocation().equals(destination), true);
  assert.equal(actor.player.getPrivateArea(), null);
  assert.equal(room.isDestroyed(), true);
});

test("world logout destroys the owned room and records its recovery marker", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  assert.ok(room?.hasMember(actor.player));
  core.World.getPlayers().remove(actor.player);
  assert.equal(actor.player.isRegistered(), false);
  assert.equal(room.isDestroyed(), true);
  assert.equal(actor.player.getAttribute("kraken:private-instance"), true);
  assert.equal([...core.World.getNpcs()].some(npc => npc.getPrivateArea() === room), false);
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const save = PlayerSave.fromPlayer(actor.player);
  const restored = nativeActor(t, core, actor.errors);
  save.applyToPlayer(restored.player);
  restored.player.setAttribute("bot-skip-persistence", true);
  assert.equal(restored.player.getAttribute("kraken:private-instance"), true);
  PluginManager.emitPlayerLogin({ player: restored.player, username: restored.player.getUsername(), isNewAccount: false });
  assert.equal(restored.player.getAttribute("kraken:private-instance"), false);
  assert.equal(restored.player.getLocation().equals(new core.Location(2280, 10016, 0)), true);
});

test("the registered grave-location event routes private deaths outside the crevice", async t => {
  const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
  const outside = { player: actor.player, location: actor.player.getLocation(), tile: null };
  PluginManager.emitCustomEvent("gravestones:grave-location", outside);
  assert.equal(outside.tile, null, "public cove is not claimed");
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const request = { player: actor.player, location: actor.player.getLocation(), tile: null };
  PluginManager.emitCustomEvent("gravestones:grave-location", request);
  assert.deepEqual(request.tile, { x: 2280, y: 10016, z: 0 });
});

test("a death finishing after room exit neither respawns publicly nor places late loot", async t => {
  const { core, PluginManager, claims } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
  assert.ok(boss?.isRegistered());
  actor.deaths.push(boss);
  boss.setNpcTransformationId(core.NpcIdentifiers.KRAKEN);
  const combat = boss.getCombat();
  t.mock.method(combat, "getKiller", () => actor.player);
  t.mock.method(combat, "getRecentDamagers", () => [actor.player]);
  const delay = boss.getCurrentDefinition().getDeathTicks();
  assert.ok(Number.isInteger(delay) && delay >= 0);
  boss.setHitpoints(0);
  core.TaskManager.process(); // Actual death task captures its killer before the player leaves.
  const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
  assert.ok(exit);
  assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true);
  assert.equal(room.isDestroyed(), true);
  const beforeItems = core.World.getItems().filter(item => item.getOwner() === actor.player.getUsername());
  const beforeInventory = actor.player.getInventory().getCopiedItems();
  for (let i = 0; i < delay + 3; i++) core.TaskManager.process();
  const claim = claims.find(event => event.npc === boss);
  assert.ok(claim, "actual NPC death reached the drop claim producer");
  assert.equal(claim.handled, true);
  assert.deepEqual(actor.player.getInventory().getItems(), beforeInventory);
  assert.deepEqual(core.World.getItems().filter(item => item.getOwner() === actor.player.getUsername()), beforeItems);
  assert.equal(core.TaskManager.hasActiveTask(room), false);
  assert.equal(core.World.getAddNPCQueue().some(npc => npc === boss || npc.getPrivateArea() === room), false);
  core.World.process(); // Drain the engine's normal removal queue after the late death task.
  assert.equal(core.World.getRemoveNPCQueue().includes(boss), false);
  assert.equal(boss.isRegistered(), false);
});

for (const leaveAfterFailure of [false, true]) {
  test(`private standalone respawn ${leaveAfterFailure ? "is cancelled on exit" : "recovers after failed admission"}`, async t => {
    const { core, PluginManager, api, npcDeaths } = await nativeBootstrap(), actor = nativeActor(t, core);
    actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
    assert.equal(nativeObject(PluginManager, actor, 2), true);
    await nativeChoice(actor, 1);
    const room = actor.player.getPrivateArea();
    actor.rooms.push(room);
    assert.ok(room?.hasMember(actor.player));
    const tentacle = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3);
    assert.ok(tentacle);
    const delay = Math.max(1, tentacle.getDefinition().getRespawn());
    const deathTicks = tentacle.getCurrentDefinition().getDeathTicks();
    assert.ok(Number.isInteger(delay) && Number.isInteger(deathTicks));
    const original = api.spawnNpc, queue = core.World.getAddNPCQueue();
    let attempts = 0, failed;
    t.mock.method(api, "spawnNpc", definition => {
      attempts++;
      if (attempts === 1) {
        failed = core.NPC.create(definition.id, new core.Location(definition.x, definition.y, definition.z));
        queue.push(failed);
        return failed;
      }
      return original.call(api, definition);
    });
    killNativeNpc(t, core, actor, tentacle, core.NpcIdentifiers.ENORMOUS_TENTACLE);
    tickUntil(core, () => npcDeaths.includes(tentacle), deathTicks + 10, "actual tentacle death reached registered hooks");
    assert.equal(room.owned.has(tentacle), false, "completed death no longer occupies the room's owned set");
    tickUntil(core, () => attempts >= 1, delay + 5, "first private respawn reached actual admission");
    assert.ok(failed);
    assert.equal(queue.includes(failed), false);
    assert.ok(!failed.isRegistered());
    assert.equal(core.TaskManager.hasActiveTask(room), true, "failed admission retains a room-owned retry");
    if (leaveAfterFailure) {
      const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
      assert.ok(exit);
      assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true);
      for (let i = 0; i < delay + 3; i++) core.TaskManager.process();
      assert.equal(attempts, 1, "room closure cancels retry");
      assert.equal(core.TaskManager.hasActiveTask(room), false);
    } else {
      tickUntil(core, () => attempts >= 2, delay + 5, "the owned retry attempts admission");
      assert.equal(room.getNpcs().length, 5);
      assert.equal(room.getNpcs().every(npc => npc.getPrivateArea() === room && npc.isRegistered()), true);
      assert.equal(room.owned.size, 5);
      assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, "retry charges no second fee");
    }
  });
}

test("an earlier standalone respawn does not release a later mid-fight tentacle", async t => {
  const { core, PluginManager, npcDeaths } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const tentacles = room.getNpcs().filter(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3);
  const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
  assert.equal(tentacles.length, 4);
  assert.ok(boss);
  const [first, second] = tentacles, firstAt = first.getSpawnPosition(), secondAt = second.getSpawnPosition();
  const delay = Math.max(1, first.getDefinition().getRespawn());
  second.setNpcTransformationId(core.NpcIdentifiers.ENORMOUS_TENTACLE);
  const secondDeathTicks = second.getCurrentDefinition().getDeathTicks();
  assert.ok(delay > secondDeathTicks + 3, "native respawn delay permits the intended phase interleaving");
  killNativeNpc(t, core, actor, first, core.NpcIdentifiers.ENORMOUS_TENTACLE);
  tickUntil(core, () => npcDeaths.includes(first), first.getCurrentDefinition().getDeathTicks() + 10,
    "first native death is processed while boss is down");
  boss.setNpcTransformationId(core.NpcIdentifiers.KRAKEN);
  assert.ok(boss.getHitpoints() > 0);
  killNativeNpc(t, core, actor, second, core.NpcIdentifiers.ENORMOUS_TENTACLE);
  tickUntil(core, () => npcDeaths.includes(second), secondDeathTicks + 10,
    "second native death is processed while boss is active");
  const whirlpoolAt = location => room.getNpcs().some(npc => npc.isRegistered()
    && npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3 && npc.getLocation().equals(location));
  tickUntil(core, () => whirlpoolAt(firstAt), delay + 5, "the earlier standalone tentacle returns");
  assert.equal(whirlpoolAt(secondAt), false, "the later mid-fight tentacle stays dead");
  for (let i = 0; i < delay + 2; i++) core.World.process();
  assert.equal(whirlpoolAt(secondAt), false, "a standalone timer did not release the joint wait list");
  assert.equal(room.owned.has(first), false);
  assert.equal(room.owned.has(second), false);
});

test("standalone tentacles retain their own later respawn deadlines", async t => {
  const { core, PluginManager, npcDeaths } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const [first, second] = room.getNpcs().filter(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3);
  assert.ok(first && second);
  const firstAt = first.getSpawnPosition(), secondAt = second.getSpawnPosition();
  const delay = Math.max(1, first.getDefinition().getRespawn());
  second.setNpcTransformationId(core.NpcIdentifiers.ENORMOUS_TENTACLE);
  const deathTicks = second.getCurrentDefinition().getDeathTicks();
  assert.ok(delay > deathTicks + 6, "definition timing allows staggered deaths before the first retry");
  killNativeNpc(t, core, actor, first, core.NpcIdentifiers.ENORMOUS_TENTACLE);
  tickUntil(core, () => npcDeaths.includes(first), first.getCurrentDefinition().getDeathTicks() + 10,
    "first standalone death was processed");
  for (let i = 0; i < 3; i++) core.World.process();
  killNativeNpc(t, core, actor, second, core.NpcIdentifiers.ENORMOUS_TENTACLE);
  tickUntil(core, () => npcDeaths.includes(second), deathTicks + 10, "second standalone death was processed later");
  const whirlpoolAt = location => room.getNpcs().some(npc => npc.isRegistered()
    && npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3 && npc.getLocation().equals(location));
  tickUntil(core, () => whirlpoolAt(firstAt), delay + 5, "the earlier standalone respawn arrived");
  assert.equal(whirlpoolAt(secondAt), false, "the later standalone respawn has not arrived early");
  tickUntil(core, () => whirlpoolAt(secondAt), delay + 5, "the later standalone respawn eventually arrives");
  assert.equal(room.owned.size, 5);
});

test("joint private respawn waits for an already-dying unhit tentacle and retries an atomic batch", async t => {
  const { core, PluginManager, api, npcDeaths } = await nativeBootstrap(), actor = nativeActor(t, core);
  actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  assert.equal(nativeObject(PluginManager, actor, 2), true);
  await nativeChoice(actor, 1);
  const room = actor.player.getPrivateArea();
  actor.rooms.push(room);
  const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
  const tentacles = room.getNpcs().filter(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_3);
  assert.ok(boss);
  assert.equal(tentacles.length, 4);
  for (const tentacle of tentacles) tentacle.setNpcTransformationId(core.NpcIdentifiers.ENORMOUS_TENTACLE);
  boss.setNpcTransformationId(core.NpcIdentifiers.KRAKEN);
  const delay = Math.max(1, boss.getDefinition().getRespawn());
  const longDeath = delay * 2 + 10;
  const definition = tentacles[0].getCurrentDefinition();
  t.mock.method(definition, "getDeathTicks", () => longDeath);
  assert.equal(tentacles[0].getCurrentDefinition().getDeathTicks(), longDeath, "controlled long death is active");
  assert.equal(tentacles.every(npc => npc.getCombat().getRecentDamagers().length === 0), true,
    "all four tentacles have no player damagers before boss cleanup");
  actor.deaths.push(...tentacles);
  tentacles[0].setHitpoints(0);
  core.World.process(); // The unhit tentacle starts dying before the boss.
  assert.equal(tentacles[0].isDyingFunction(), true);
  killNativeNpc(t, core, actor, boss, core.NpcIdentifiers.KRAKEN);
  const original = api.spawnNpc, queue = core.World.getAddNPCQueue();
  let attempts = 0, failed, firstTrial;
  t.mock.method(api, "spawnNpc", spawn => {
    attempts++;
    if (attempts === 2) {
      failed = core.NPC.create(spawn.id, new core.Location(spawn.x, spawn.y, spawn.z));
      queue.push(failed);
      return failed;
    }
    const admitted = original.call(api, spawn);
    if (attempts === 1) firstTrial = admitted;
    return admitted;
  });
  tickUntil(core, () => npcDeaths.includes(boss), boss.getCurrentDefinition().getDeathTicks() + 10,
    "actual boss death reached the registered hook");
  assert.equal(tentacles[0].isDyingFunction(), true, "already-dying actor is present at boss cleanup");
  for (let i = 0; i < delay + 1; i++) core.World.process();
  assert.equal(attempts, 0, "joint batch waits while prior actors are still dying or registered");
  tickUntil(core, () => attempts >= 2, longDeath + delay * 3 + 10, "joint batch reached injected admission failure");
  assert.ok(failed);
  assert.ok(firstTrial);
  assert.equal(tentacles.every(npc => !npc.isDyingFunction() && !npc.isRegistered()), true,
    "all original unhit tentacles retired before the replacement batch");
  assert.equal(tentacles.some(npc => npcDeaths.includes(npc)), false,
    "killer-null tentacle deaths never emitted an NPC death event");
  assert.equal(firstTrial.isRegistered(), false);
  assert.equal([...core.World.getNpcs()].includes(firstTrial), false);
  assert.equal(queue.includes(firstTrial), false);
  assert.ok(!failed.isRegistered());
  assert.equal(queue.includes(failed), false);
  assert.equal(room.getNpcs().filter(npc => npc.isRegistered()).length, 0, "partial batch was rolled back");
  tickUntil(core, () => attempts >= 7, delay + 5, "the complete private batch retries");
  assert.equal(room.getNpcs().length, 5);
  assert.equal(room.getNpcs().every(npc => npc.isRegistered() && npc.getPrivateArea() === room), true);
  assert.equal(room.owned.size, 5);
  assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.COINS), 0, "no second fee is taken");
});

for (const leaveBeforeWake of [false, true]) {
  test(`delayed private explosive ${leaveBeforeWake ? "is not consumed after exit" : "wakes the boss in the room"}`, async t => {
    const { core, PluginManager } = await nativeBootstrap(), actor = nativeActor(t, core);
    actor.player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
    actor.player.getInventory().adds(core.ItemIdentifiers.FISHING_EXPLOSIVE, 1);
    assert.equal(nativeObject(PluginManager, actor, 2), true);
    await nativeChoice(actor, 1);
    const room = actor.player.getPrivateArea();
    actor.rooms.push(room);
    const boss = room.getNpcs().find(npc => npc.getRealId() === core.NpcIdentifiers.WHIRLPOOL_2);
    const item = actor.player.getInventory().getItems().find(entry => entry.getId() === core.ItemIdentifiers.FISHING_EXPLOSIVE);
    assert.ok(boss?.isRegistered() && item);
    PluginManager.emitItemOnNpc({ player: actor.player, target: boss, item,
      itemId: item.getId(), npcId: boss.getId(), handled: false });
    if (leaveBeforeWake) {
      const exit = core.World.findCacheObject(actor.player, core.ObjectIdentifiers.CREVICE_5, new core.Location(2280, 10021, 0));
      assert.ok(exit);
      assert.equal(nativeObject(PluginManager, { ...actor, object: exit }, 1), true);
      assert.equal(room.isDestroyed(), true);
    }
    const delay = require("../plugins/bosses/kraken/Disturb.Kraken").THROW_DELAY_TICKS;
    for (let i = 0; i < delay + 2; i++) core.TaskManager.process();
    assert.equal(actor.player.getInventory().getAmount(core.ItemIdentifiers.FISHING_EXPLOSIVE), leaveBeforeWake ? 1 : 0);
    if (!leaveBeforeWake) assert.equal(boss.getId(), core.NpcIdentifiers.KRAKEN);
  });
}
