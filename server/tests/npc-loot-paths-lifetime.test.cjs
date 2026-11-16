// Run after `yarn build`: node --test tests/npc-loot-paths-lifetime.test.cjs
// The boss and minigame loot that its own plugin puts on the floor asks NpcDrops for the monster-drop ground
// options ("npc-drops:ground-options"). Wiki (Drops): "Tradeable drops will remain on the ground for 200 game
// ticks"; untradeable ones 300. Each path below is driven through its own drop code with the real NpcDrops answer
// and the real ItemOnGroundManager; only the table roll is stubbed, so each kill drops the same three items.
// Yama has its own test (yama-loot-lifetime.test.cjs).
//
// "Tradeable" is the Wiki's (between players). A ring of dueling(3) trades but is not on the Grand Exchange
// (Wiki infobox: tradeable Yes, exchange No), so the cache gives it neither `tradeable=yes` (opcode 65) nor
// `tradeable=no` (opcode 15); it lasts 200 like any tradeable drop. Burnt meat, another such item, is recorded as
// a monster drop at despawn=200 (rsprox_transcripts/224/01463.txt tick 2092).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, afterEach } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { World } = require("../dist/game/World");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

// The revenant table roll is stubbed before the loot modules take their own reference to it.
const RevenantDrops = require("../plugins/npcs/revenants/Drops.Revenants");
const realRollDrops = RevenantDrops.rollDrops;
let revenantRoll = null;
RevenantDrops.rollDrops = (options) => (revenantRoll ? revenantRoll(options) : realRollDrops(options));

const SHARK = 385;            // tradeable, on the Grand Exchange
const DUELING_3 = 2562;       // ring of dueling(3): tradeable, not on the Grand Exchange
const ECUMENICAL_KEY = 11942; // untradeable
const LOOT = () => [
  { itemId: SHARK, amount: 1 },
  { itemId: DUELING_3, amount: 1 },
  { itemId: ECUMENICAL_KEY, amount: 1 },
];
const EXPECTED = { [SHARK]: 200, [DUELING_3]: 200, [ECUMENICAL_KEY]: 300 };
const FILLER = 1511; // logs, to fill a pack

let core;
let groundOptions;
const listeners = new Map();
const hooks = new Map();
const tasks = [];

/** The plugin api the loot modules see: the real core, the real floor, NpcDrops' real ground options. */
const api = new Proxy({
  get core() { return core; },
  getItemOnGroundManager: () => ItemOnGroundManager,
  onCustomEvent: (name, handler) => { listeners.set(name, [...(listeners.get(name) ?? []), handler]); },
  emitCustomEvent(name, payload) {
    if (name === "npc-drops:ground-options") return groundOptions(payload);
    if (name === "npc-drops:roll-table") {
      const main = { section: "Main" };
      if (!payload.entryFilter || payload.entryFilter(main)) payload.drops.push(...LOOT());
      return undefined;
    }
    for (const handler of listeners.get(name) ?? []) handler(payload);
    return undefined;
  },
}, {
  get: (target, key) => (key in target ? target[key] : (...args) => {
    const handler = args.at(-1);
    if (typeof handler === "function") hooks.set(key, handler);
    return undefined;
  }),
});

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  const own = new Map();
  NpcDrops.register(new Proxy({
    core,
    getItemOnGroundManager: () => ItemOnGroundManager,
    onCustomEvent: (name, handler) => { own.set(name, handler); },
  }, { get: (target, key) => (key in target ? target[key] : () => undefined) }));
  groundOptions = own.get("npc-drops:ground-options");
  assert.equal(typeof groundOptions, "function");
  // Tasks wait for runTasks() instead of the game loop (as TaskManager.submit starts them).
  core.TaskManager.submit = (task) => {
    if (task.isRunning()) return;
    task.setRunning(true);
    if (task.isImmediate()) task.execute();
    tasks.push(task);
  };
});

afterEach(() => {
  for (const item of [...World.getItems()]) ItemOnGroundManager.deregister(item);
  tasks.length = 0;
  revenantRoll = null;
});

/** Runs the tasks the code under test submitted, and the ones they submit, as their ticks come. */
function runTasks(limit = 200) {
  for (let tick = 0; tick < limit && tasks.length > 0; tick++) {
    for (const task of [...tasks]) {
      if (!task.isRunning?.()) { tasks.splice(tasks.indexOf(task), 1); continue; }
      task.tick();
    }
  }
}

function player(name, at = new core.Location(3222, 3218, 0)) {
  const p = new Player(null);
  p.setUsername(name);
  p.getPacketSender = () => new Proxy({}, { get: () => () => undefined });
  p.setLocation(at.clone());
  return p;
}

function fillPack(p) {
  for (let slot = 0; slot < 28; slot++) p.getInventory().add(new Item(FILLER, 1));
  assert.equal(p.getInventory().getFreeSlots(), 0);
}

const floor = (id) => World.getItems().filter((item) => item.getItem().getId() === id && !item.isPendingRemoval());

/** Every placed stack of the three items lasts its Wiki lifetime; each lands at least once. */
function assertLifetimes(label, ids = [SHARK, DUELING_3, ECUMENICAL_KEY], expected = EXPECTED) {
  for (const id of ids) {
    const placed = floor(id);
    assert.ok(placed.length > 0, `${label}: ${ItemDefinition.forId(id).getName()} is on the floor`);
    assert.deepEqual(placed.map((item) => item.getDespawnDelay()), placed.map(() => expected[id]),
      `${label}: ${ItemDefinition.forId(id).getName()} lasts ${expected[id]} ticks`);
  }
}

const npcAt = (id, at, extra = {}) => ({
  getId: () => id,
  getLocation: () => at.clone(),
  getSize: () => 1,
  isRegistered: () => true,
  getPrivateArea: () => null,
  ...extra,
});

const paths = [
  {
    name: "Araxxor: harvested loot that does not fit the pack",
    run() {
      const Corpse = require("../plugins/bosses/araxxor/Corpse.Araxxor");
      Corpse.attach(api);
      const p = player("araxxor-loot");
      fillPack(p);
      const at = new core.Location(3633, 9816, 0);
      Corpse.spawnDrops(p, { corpse: npcAt(13669, at) }, LOOT());
    },
  },
  {
    name: "Nex: each player's share under her",
    run(t) {
      const Common = require("../plugins/bosses/nex/Common.Nex");
      const Loot = require("../plugins/bosses/nex/Loot.Nex");
      Common.init(api);
      t.mock.method(Math, "random", () => 0.99);
      const p = player("nex-loot");
      const fight = { arena: { area: null }, contribution: new Map([[p, 1000]]), boss: {} };
      Loot.reward(fight, [p], new core.Location(2924, 5203, 0));
    },
  },
  {
    name: "Royal Titans: claimed loot that does not fit the pack",
    run() {
      const Corpse = require("../plugins/bosses/royaltitans/Corpse.RoyalTitans");
      Corpse.attach(api);
      const p = player("titans-loot");
      fillPack(p);
      const at = new core.Location(2952, 9573, 0);
      Corpse._test.spawnDrops(p, { area: null }, npcAt(14150, at), LOOT());
    },
  },
  {
    name: "The Nightmare: each eligible player's roll on the loot tile",
    run(t) {
      const Common = require("../plugins/bosses/nightmare/Common.Nightmare");
      const Loot = require("../plugins/bosses/nightmare/Loot.Nightmare");
      Common.init(api);
      t.mock.method(Math, "random", () => 0.99);
      const p = player("nightmare-loot");
      const tile = new core.Location(3870, 9949, 3);
      const fight = {
        phosani: false, boss: {}, teamSize: 1,
        dream: { area: null, tile: () => tile.clone() },
        contribution: new Map([[p, { shield: 100, totems: 100 }]]),
      };
      Loot.reward(fight, [p]);
    },
  },
  {
    name: "Scurrius: a helper's non-MVP share in the public lair",
    run() {
      const Common = require("../plugins/bosses/scurrius/Common.Scurrius");
      const Kills = require("../plugins/bosses/scurrius/Kills.Scurrius");
      Common.init(api);
      Kills.attach(api);
      const killer = player("scurrius-mvp");
      const helper = player("scurrius-helper");
      const npc = npcAt(Common.PUBLIC_ID, new core.Location(3299, 9867, 0));
      Kills._test.onRoll({ player: killer, npc, npcId: Common.PUBLIC_ID, drops: [], damagers: [killer, helper] });
      // The killer's own roll goes back to NpcDrops' placeDrops; only the helper's is placed here.
    },
  },
  {
    name: "The Hueycoatl: each qualifying fighter's share on the loot tile",
    run(t) {
      const Kills = require("../plugins/bosses/hueycoatl/Kills.Hueycoatl");
      require("../plugins/bosses/hueycoatl/CombatAchievements.Hueycoatl").attach(api);
      Kills.attach(api);
      t.mock.method(Math, "random", () => 0.99);
      const p = player("hueycoatl-loot");
      const tile = new core.Location(1520, 3290, 0);
      const fight = { head: {}, spawnedAt: 0, joinedAt: new Map(), damage: new Map([[p, { body: 400, head: 400, tail: 0 }]]) };
      Kills.killed({ fight, area: null, arenaPlayers: () => [p], tile: () => tile.clone(), graphic() {} });
    },
  },
  {
    name: "Bryophyta's and Obor's lairs: the chest's loot",
    run() {
      const Common = require("../plugins/bosses/giantlairs/Common.GiantLairs");
      const Lair = require("../plugins/bosses/giantlairs/Lair.GiantLairs");
      Common.init(api);
      require("../plugins/bosses/giantlairs/CombatAchievements.GiantLairs")(api);
      Lair(api);
      for (const lair of Common.lairs) {
        const p = player(`${lair.slug}-loot`);
        p.getInventory().add(new Item(lair.key, 1));
        Lair.enter(p, lair, false);
        runTasks();
        const session = Lair.sessionOf(p);
        assert.ok(session, `${lair.name}: in the lair`);
        session.killed = true;
        Lair.openChest({ player: p, objectId: lair.chest.closed });
        runTasks(3);
        assertLifetimes(lair.name);
        session.end();
        for (const item of [...World.getItems()]) ItemOnGroundManager.deregister(item);
      }
    },
    checked: true,
  },
  {
    name: "Revenants: a kill's loot under the revenant",
    run() {
      const Revenants = require("../plugins/npcs/revenants/Common.Revenants");
      const Loot = require("../plugins/npcs/revenants/Loot.Revenants");
      Revenants.init(api);
      revenantRoll = () => LOOT();
      const p = player("revenant-loot");
      p.isSkulled = () => false;
      const npc = npcAt(7881, new core.Location(3160, 10114, 0), {
        getDefinition: () => ({ getCombatLevel: () => 7, getName: () => "Revenant imp" }),
      });
      Loot.dropLoot({ killer: p, npc, npcId: 7881 });
    },
  },
  {
    name: "Revenant maledictus: the top damager's rolls",
    run() {
      const Revenants = require("../plugins/npcs/revenants/Common.Revenants");
      const Maledictus = require("../plugins/npcs/revenants/Maledictus.Revenants");
      Revenants.init(api);
      // Its loop drops the first of each roll (the table's always-drop).
      revenantRoll = () => [{ itemId: SHARK, amount: 1 }, ...LOOT()];
      const boss = Maledictus.createMaledictus(api, core, { inCaves: () => false, surge: { grant() {} } });
      const p = player("maledictus-loot");
      const npc = npcAt(Maledictus.ID, p.getLocation(), {
        getCombat: () => ({ getRecentDamagerEntries: () => [{ player: p, damage: 50 }] }),
      });
      boss.rememberDamagers({ npc });
      boss.dropLoot({ npc });
    },
  },
];

for (const entry of paths) {
  test(`${entry.name}: tradeable loot lasts 200 ticks, an untradeable drop 300`, (t) => {
    entry.run(t);
    if (!entry.checked) assertLifetimes(entry.name);
  });
}

test("Temple Trekking: a nail beast's drops (big bones and nails 200; the untradeable long and curved bones 300)", (t) => {
  const Common = require("../plugins/minigames/templetrekking/Common.TempleTrekking");
  const Combat = require("../plugins/minigames/templetrekking/Combat.TempleTrekking");
  Common.init(api);
  Combat.attachCombat(api);
  const nailBeastDrops = hooks.get("onNpcDeath");
  assert.equal(typeof nailBeastDrops, "function");
  t.mock.method(Math, "random", () => 0); // the long and curved bones' rolls hit
  const killer = player("trek-loot");
  const npc = npcAt(Common.data.events.nailBeasts.npcs[0], killer.getLocation(), { __templeTrek: {} });
  nailBeastDrops({ killer, npc });
  const BIG_BONES = 532, NAILS = 10937, LONG_BONE = 10976, CURVED_BONE = 10977;
  assert.equal(ItemDefinition.forId(LONG_BONE).isPlayerTradeable(), false);
  assertLifetimes("Temple Trekking", [BIG_BONES, NAILS, LONG_BONE, CURVED_BONE],
    { [BIG_BONES]: 200, [NAILS]: 200, [LONG_BONE]: 300, [CURVED_BONE]: 300 });
});

test("Temple Trekking: a swamp snake the follower hurt leaves bones for 200 ticks", () => {
  const Common = require("../plugins/minigames/templetrekking/Common.TempleTrekking");
  const Combat = require("../plugins/minigames/templetrekking/Combat.TempleTrekking");
  Common.init(api);
  listeners.delete("npc-drops:generated");
  Combat.attachCombat(api);
  const [snakeRemains] = listeners.get("npc-drops:generated");
  const p = player("trek-snake");
  const npc = npcAt(Common.data.events.snakes.npcs[0], p.getLocation(), { __templeTrek: {}, __trekHurtByFollower: true });
  const event = { player: p, npc };
  snakeRemains(event);
  assert.equal(event.handled, true);
  assertLifetimes("Temple Trekking snake", [Common.data.items.bones], { [Common.data.items.bones]: 200 });
});

test("the Wiki's tradeable, not the Grand Exchange flag: ring of dueling(3) and burnt meat trade, an ecumenical key does not", () => {
  const DUELING_8 = 2552, BURNT_MEAT = 2146;
  assert.equal(ItemDefinition.forId(DUELING_8).isTradeable(), true, "on the Exchange");
  for (const id of [DUELING_3, BURNT_MEAT]) {
    assert.equal(ItemDefinition.forId(id).isTradeable(), false, "not on the Exchange (Wiki: exchange No)");
    assert.equal(ItemDefinition.forId(id).isPlayerTradeable(), true, "Wiki: tradeable Yes");
  }
  assert.equal(ItemDefinition.forId(DUELING_3 + 1).isPlayerTradeable(), true, "its note too");
  assert.equal(ItemDefinition.forId(ECUMENICAL_KEY).isPlayerTradeable(), false);
  assert.equal(ItemDefinition.forId(-1).isPlayerTradeable(), false, "an unknown item is not");
});
