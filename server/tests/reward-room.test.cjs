// Run after `yarn build`: node --test tests/reward-room.test.cjs
//
// Rewards that move into a stack near its cap keep what doesn't fit, and a logout during a reward's
// delay pays nothing and keeps what is owed.
//
// Evidence level: native fixture. Buttons go through ClientConnection.dispatch. Loot is seeded in the
// attribute or run that holds it, since the raids themselves aren't under test.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");

const GauntletRewards = require("../plugins/minigames/gauntlet/Rewards.Gauntlet");
const ColosseumRun = require("../plugins/minigames/colosseum/Run.Colosseum");
const CoxRaid = require("../plugins/minigames/cox/RaidState.ChambersOfXeric");
const { VaultRoom } = require("../plugins/minigames/tfa/Vault.FracturedArchive");
const TemporossRecords = require("../plugins/minigames/tempoross/Records.Tempoross");
const TemporossShared = require("../plugins/minigames/tempoross/Shared.Tempoross");
const WintertodtRound = require("../plugins/minigames/wintertodt/Round.Wintertodt");
const WintertodtCart = require("../plugins/minigames/wintertodt/Cart.Wintertodt");

const HOME = [3222, 3218];
const MAX_STACK = 2147483647;
const NEAR = MAX_STACK - 100;
const REWARD_POOL = 41356;
const SKIP_SAVE = "bot-skip-persistence";

let core;
let I;
let codec;
let next = 6100;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("roomqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.setAttribute(SKIP_SAVE, true);
  for (const skill of core.Skill.values()) {
    p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  }
  p.getBank(0);
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory() };
}

function reload(t, f) {
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const g = actor(t);
  codec.hydratePlayerSave(raw).applyToPlayer(g.p);
  g.p.setRegistered(true);
  g.p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  g.p.needsPlacement = false;
  g.p.setAttribute(SKIP_SAVE, true);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  return g;
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const item = (id, amount = 1) => new core.Item(id, amount);
const button = (f, group, child, slot) => send(f, {
  type: "widget_action", widgetId: (group << 16) | child, groupId: group, childId: child, buttonNum: 1, slot,
});

function onGround(f, id) {
  const found = ItemOnGroundManager.getGroundItem(f.p.getUsername(), id, f.p.getLocation(), f.p.getPrivateArea?.());
  return found ? found.getItem().getAmount() : 0;
}

// ---------------------------------------------------------------------------- near the stack cap

/** Each path: where its loot sits, and its buttons. */
const PATHS = [
  {
    name: "Lunar Chest",
    seed: (t, f, amount) => f.p.setAttribute("moons-of-peril:chest", [{ id: I.COINS, amount }]),
    left: (f) => f.p.getAttribute("moons-of-peril:chest")?.[0]?.amount ?? 0,
    takeAll: (f) => button(f, 868, 4),
    bankAll: (f) => button(f, 868, 20),
  },
  {
    name: "Doom pile",
    seed: (t, f, amount) => f.p.setAttribute("doom:unclaimed", [{ id: I.COINS, amount }]),
    left: (f) => f.p.getAttribute("doom:unclaimed")?.[0]?.amount ?? 0,
    takeAll: (f) => button(f, 919, 17),
    bankAll: (f) => button(f, 919, 26),
  },
  {
    name: "Theatre chest",
    seed: (t, f, amount) => f.p.setAttribute("tob:loot", [{ id: I.COINS, amount }]),
    left: (f) => f.p.getAttribute("tob:loot")?.[0]?.amount ?? 0,
    takeAll: (f) => button(f, 23, 8),
    bankAll: (f) => button(f, 23, 6),
  },
  {
    name: "Tombs chest",
    seed: (t, f, amount) => {
      f.p.setAttribute("toa:loot", [{ id: I.COINS, amount }]);
      t.mock.method(f.p.getPacketSender(), "isSubInterfaceOpen", () => true);
    },
    left: (f) => f.p.getAttribute("toa:loot")?.[0]?.amount ?? 0,
    takeAll: (f) => button(f, 771, 6),
    bankAll: (f) => button(f, 771, 4),
  },
  {
    name: "Colosseum chest",
    seed: (t, f, amount) => {
      f.run = { chest: {}, loot: { rewards: [{ id: I.COINS, amount }], future: [], previous: [] } };
      const real = ColosseumRun.runOf;
      t.mock.method(ColosseumRun, "runOf", (player) => (player === f.p ? f.run : real(player)));
    },
    left: (f) => f.run.loot.rewards[0]?.amount ?? 0,
    takeAll: (f) => button(f, 246, 7),
    bankAll: (f) => button(f, 246, 5),
  },
  {
    name: "Chambers chest",
    seed: (t, f, amount) => {
      f.raid = { rewards: new Map([[f.p.getUsername(), [{ id: I.COINS, amount }]]]) };
      const real = CoxRaid.raidOf;
      t.mock.method(CoxRaid, "raidOf", (player) => (player === f.p ? f.raid : real(player)));
    },
    left: (f) => f.raid.rewards.get(f.p.getUsername())[0]?.amount ?? 0,
    takeAll: (f) => button(f, 539, 8),
    bankAll: (f) => button(f, 539, 6),
  },
  {
    // The room's own methods, which its chest clicks call; a room needs no raid for these.
    name: "Fractured Archive chest",
    seed: (t, f, amount) => {
      f.room = Object.create(VaultRoom.prototype);
      f.room.loot = new Map([[f.p.getUsername(), { entries: [{ id: I.COINS, amount }] }]]);
    },
    // The room drops a player's loot once it's empty.
    left: (f) => f.room.loot.get(f.p.getUsername())?.entries[0]?.amount ?? 0,
    takeAll: async (f) => f.room.takeAll(f.p, "inventory"),
    bankAll: async (f) => f.room.takeAll(f.p, "bank"),
  },
];

for (const route of PATHS) {
  test(`${route.name}: Take-all near the cap keeps what doesn't fit`, async (t) => {
    const control = actor(t);
    route.seed(t, control, 500);
    await route.takeAll(control);
    assert.equal(control.inv.getAmount(I.COINS), 500, "control: an empty inventory takes it all");
    assert.equal(route.left(control), 0, "control: and the chest is empty");

    const f = actor(t);
    f.inv.add(item(I.COINS, NEAR), false);
    route.seed(t, f, 500);
    await route.takeAll(f);
    assert.equal(f.inv.getAmount(I.COINS), MAX_STACK, "the stack fills");
    assert.equal(route.left(f), 400, "the other 400 stay in the chest");
  });

  test(`${route.name}: Bank-all near the cap keeps what doesn't fit`, async (t) => {
    const control = actor(t);
    route.seed(t, control, 500);
    await route.bankAll(control);
    assert.equal(control.p.getBank(0).getAmount(I.COINS), 500, "control: an empty bank takes it all");
    assert.equal(route.left(control), 0, "control: and the chest is empty");

    const f = actor(t);
    f.p.getBank(0).add(item(I.COINS, NEAR), false);
    route.seed(t, f, 500);
    await route.bankAll(f);
    assert.equal(f.p.getBank(0).getAmount(I.COINS), MAX_STACK, "the stack fills");
    assert.equal(route.left(f), 400, "the other 400 stay in the chest");
  });
}

test("Gauntlet chest: shards past the cap land on the floor, not nowhere", (t) => {
  const shard = GauntletRewards.ID.CRYSTAL_SHARD;
  const low = () => 0;
  const control = actor(t);
  GauntletRewards.setReward(control.p, "regular", "completed");
  GauntletRewards.openChest(control.p, low);
  const paid = control.inv.getAmount(shard);
  assert.ok(paid > 0, "control: the chest pays shards");

  const f = actor(t);
  f.inv.add(item(shard, MAX_STACK - 1), false);
  GauntletRewards.setReward(f.p, "regular", "completed");
  GauntletRewards.openChest(f.p, low);
  assert.equal(f.inv.getAmount(shard), MAX_STACK, "the stack fills");
  assert.equal(onGround(f, shard), paid - 1, "the rest is on the floor");
});

// ---------------------------------------------------------------------------- logout during a delay

test("Tempoross reward pool: a logout during the search pays nothing and keeps the permits", async (t) => {
  const search = async (f) => {
    TemporossRecords.setPermits(f.p, 3);
    f.inv.add(item(I.SMALL_FISHING_NET), false);
    const [x, y] = [HOME[0] + 1, HOME[1]];
    const object = new core.GameObject(REWARD_POOL, new core.Location(x, y, 0), 10, 0, null);
    core.ObjectManager.register(object, true);
    t.after(() => core.ObjectManager.deregister(object, true));
    await send(f, { type: "object_option", id: REWARD_POOL, x, y, clickType: 1, action: "Net" });
    // The click runs once the player has arrived, on a tick.
    for (let i = 0; i < 5 && !TemporossShared.actionOf(f.p); i++) ticks(f, 1);
    assert.ok(TemporossShared.actionOf(f.p), "the search has started");
    assert.equal(TemporossRecords.permits(f.p), 3, "and hasn't paid yet");
  };
  const control = actor(t);
  await search(control);
  ticks(control, 12);
  assert.ok(TemporossRecords.permits(control.p) < 3, "control: searching spends permits");

  const f = actor(t);
  await search(f);
  const items = () => f.inv.getValidItems().length;
  const held = items();
  f.p.onLogout();
  ticks(f, 12);
  assert.equal(TemporossRecords.permits(f.p), 3, "the permits are kept");
  assert.equal(items(), held, "and nothing arrived after the logout");
  const g = reload(t, f);
  assert.equal(TemporossRecords.permits(g.p), 3, "the save agrees");
});

test("Wintertodt reward cart: a logout during the search pays nothing and keeps what is owed", (t) => {
  const search = (f) => {
    WintertodtRound.setRewardsOwed(f.p, 3);
    WintertodtCart.search({ player: f.p });
  };
  const control = actor(t);
  search(control);
  ticks(control, 12);
  assert.ok(WintertodtRound.rewardsOwed(control.p) < 3, "control: searching takes rewards");

  const f = actor(t);
  search(f);
  const items = () => f.inv.getValidItems().length;
  const held = items();
  f.p.onLogout();
  ticks(f, 12);
  assert.equal(WintertodtRound.rewardsOwed(f.p), 3, "what is owed is kept");
  assert.equal(items(), held, "and nothing arrived after the logout");
  const g = reload(t, f);
  assert.equal(WintertodtRound.rewardsOwed(g.p), 3, "the save agrees");
});
