// Run after `yarn build`: node --test tests/kraken-combat-achievements.test.cjs
// The Kraken's Combat Achievements its fight decides (plugins/bosses/kraken/CombatAchievements.Kraken.js):
// Unnecessary Optimisation (all four tentacles killed before the Kraken) and the private-room
// streaks Krakan't Hurt Me, Ten-tacles and One Hundred Tentacles (25 / 50 / 100 kills without
// leaving the room).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const Shared = require("../plugins/bosses/kraken/Shared.Kraken");
const Tasks = require("../plugins/bosses/kraken/CombatAchievements.Kraken");

const IDS = { WHIRLPOOL: 493, CAVE_KRAKEN: 492, WHIRLPOOL_2: 496, KRAKEN: 494, WHIRLPOOL_3: 5534, ENORMOUS_TENTACLE: 5535 };
const TENTACLE_TILES = [[2275, 10034], [2275, 10038], [2284, 10038], [2284, 10034]];

let npcs = [];
let completed = [];

Shared.bind({
  core: { NpcIdentifiers: IDS, World: { getNpcs: () => npcs } },
  emitCustomEvent: (name, request) => {
    assert.equal(name, "combat-achievements:complete");
    completed.push([request.player.name, request.task]);
  },
});

function player(name, room = null) {
  const self = { name, isPlayer: () => true, getAsPlayer: () => self, getPrivateArea: () => room };
  return self;
}

function room() {
  return { isKrakenInstance: true, isDestroyed: () => false };
}

/** A surfaced Kraken or tentacle; `hp` 0 once it dies. */
function npc(id, area, [x, y] = [2278, 10034]) {
  const tile = { getX: () => x, getY: () => y, getZ: () => 0 };
  const self = {
    hp: 100,
    isNpc: () => true,
    isRegistered: () => true,
    getId: () => id,
    getHitpoints: () => self.hp,
    getPrivateArea: () => area,
    getSpawnPosition: () => tile,
  };
  npcs.push(self);
  return self;
}

function kill(target, killer) {
  target.hp = 0;
  const event = { npc: target, killer };
  Tasks.tentacleDied(event);
  Tasks.bossDied(event);
  // Its death has finished: the engine takes it out of the world.
  npcs = npcs.filter((other) => other !== target);
}

/** A Kraken up in `area` with its four tentacles. */
function fight(area = null) {
  return { boss: npc(IDS.KRAKEN, area), tentacles: TENTACLE_TILES.map((tile) => npc(IDS.ENORMOUS_TENTACLE, area, tile)) };
}

/** The four tentacles surfaced while the Kraken is still a whirlpool. */
function tentaclesBeforeWaking(area = null) {
  return TENTACLE_TILES.map((tile) => npc(IDS.ENORMOUS_TENTACLE, area, tile));
}

before(async () => {
  // The task names are the cache's.
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const Data = require("../plugins/achievements/combatachievements/Data.CombatAchievements");
  Data(new Proxy({ core: PluginManager.getCoreApi() }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const kraken = Data.monsterNamed("Kraken").tasks.map((task) => task.name);
  for (const name of [Tasks._test.UNNECESSARY_OPTIMISATION, ...Tasks._test.STREAKS.map(([name]) => name)]) {
    assert.ok(kraken.includes(name), `the cache has a Kraken task called ${name}`);
  }
});

beforeEach(() => {
  npcs = [];
  completed = [];
});

test("Unnecessary Optimisation: all four tentacles, then the Kraken", () => {
  const qunai = player("Qunai");
  const { boss, tentacles } = fight();
  for (const tentacle of tentacles) kill(tentacle, qunai);
  kill(boss, qunai);
  assert.deepEqual(completed, [["Qunai", "Unnecessary Optimisation"]]);
});

test("three tentacles, or one killed twice, is not all four", () => {
  const qunai = player("Qunai");
  let { boss, tentacles } = fight();
  for (const tentacle of tentacles.slice(0, 3)) kill(tentacle, qunai);
  kill(boss, qunai);
  ({ boss, tentacles } = fight());
  kill(tentacles[0], qunai);
  kill(npc(IDS.ENORMOUS_TENTACLE, null, TENTACLE_TILES[0]), qunai);
  for (const tentacle of tentacles.slice(1, 3)) kill(tentacle, qunai);
  kill(boss, qunai);
  assert.deepEqual(completed, []);
});

test("Unnecessary Optimisation: all four tentacles before waking the Kraken, then the Kraken", () => {
  // Wiki (Unnecessary Optimisation): the tentacles may be killed before the Kraken is woken.
  const qunai = player("Qunai");
  for (const tentacle of tentaclesBeforeWaking()) kill(tentacle, qunai);
  kill(npc(IDS.KRAKEN, null), qunai);
  assert.deepEqual(completed, [["Qunai", "Unnecessary Optimisation"]]);
});

test("a tentacle killed before waking stops counting once it respawns", () => {
  const qunai = player("Qunai");
  const early = tentaclesBeforeWaking();
  for (const tentacle of early) kill(tentacle, qunai);
  // The first one's respawn timer runs out before the Kraken dies: its whirlpool is back.
  npc(IDS.WHIRLPOOL_3, null, TENTACLE_TILES[0]);
  kill(npc(IDS.KRAKEN, null), qunai);
  assert.deepEqual(completed, []);
});

test("killing the respawned tentacle counts again; the last to kill a tentacle has it", () => {
  const qunai = player("Qunai");
  const other = player("Other");
  for (const tentacle of tentaclesBeforeWaking()) kill(tentacle, qunai);
  const back = npc(IDS.ENORMOUS_TENTACLE, null, TENTACLE_TILES[0]);
  kill(back, other);
  kill(npc(IDS.KRAKEN, null), qunai);
  assert.deepEqual(completed, [], "Other killed the first tentacle last");
  for (const tentacle of tentaclesBeforeWaking()) kill(tentacle, qunai);
  kill(npc(IDS.KRAKEN, null), qunai);
  assert.deepEqual(completed, [["Qunai", "Unnecessary Optimisation"]]);
});

test("the tentacles that die with the Kraken do not carry into the next fight", () => {
  const qunai = player("Qunai");
  let { boss, tentacles } = fight();
  kill(boss, qunai);
  for (const tentacle of tentacles) kill(tentacle, qunai);
  ({ boss } = fight());
  kill(boss, qunai);
  assert.deepEqual(completed, []);
});

test("another player's tentacle kills are theirs", () => {
  const qunai = player("Qunai");
  const other = player("Other");
  const { boss, tentacles } = fight();
  kill(tentacles[0], other);
  for (const tentacle of tentacles.slice(1)) kill(tentacle, qunai);
  kill(boss, qunai);
  assert.deepEqual(completed, []);
});

test("the streaks count Kraken kills in one private room, and leaving starts over", () => {
  const first = room();
  const qunai = player("Qunai", first);
  const streak = () => completed.filter(([, task]) => task !== "Unnecessary Optimisation").map(([, task]) => task);
  for (let kills = 1; kills <= 24; kills++) kill(fight(first).boss, qunai);
  assert.deepEqual(streak(), []);
  kill(fight(first).boss, qunai);
  assert.deepEqual(streak(), ["Krakan't Hurt Me"]);
  for (let kills = 26; kills <= 50; kills++) kill(fight(first).boss, qunai);
  assert.ok(streak().includes("Ten-tacles"));
  assert.ok(!streak().includes("One Hundred Tentacles"));

  // Renting again is a new room: 99 there is not 100.
  completed = [];
  const second = room();
  const again = player("Qunai", second);
  for (let kills = 1; kills <= 24; kills++) kill(fight(second).boss, again);
  assert.deepEqual(streak(), []);
  for (let kills = 25; kills <= 100; kills++) kill(fight(second).boss, again);
  assert.ok(streak().includes("One Hundred Tentacles"));
});

test("kills in the open cove, or from outside the room, are not a private-room streak", () => {
  const qunai = player("Qunai");
  for (let kills = 0; kills < 25; kills++) kill(fight().boss, qunai);
  const elsewhere = player("Qunai", null);
  for (let kills = 0; kills < 25; kills++) kill(fight(room()).boss, elsewhere);
  const closed = { isKrakenInstance: true, isDestroyed: () => true };
  const inClosed = player("Qunai", closed);
  for (let kills = 0; kills < 25; kills++) kill(fight(closed).boss, inClosed);
  assert.deepEqual(completed, []);
});

test("a Kraken with no player killer finishes nothing", () => {
  const { boss, tentacles } = fight();
  const qunai = player("Qunai");
  for (const tentacle of tentacles) kill(tentacle, qunai);
  kill(boss, null);
  assert.deepEqual(completed, []);
});

// The real fight: the registered Kraken plugin (Respawn before CombatAchievements), a rented
// private room, real NPC deaths and the standalone respawns that bring back new tentacles.
// Last in the file: registering the plugin binds Shared to the real core.
let native = null;
async function nativeBootstrap() {
  if (native) return native;
  const { RegionManager } = require("../dist/game/collision/RegionManager");
  const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
  const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
  RegionManager.init();
  ObjectDefinition.init();
  new NpcDefinitionLoader().load();
  RegionManager.loadMapFiles(2280, 10017);
  const core = PluginManager.getCoreApi();
  const api = PluginManager.createApi("KrakenCombatAchievementsNativeTest");
  require("../plugins/items/ItemDefinitionLoader.plugin").register(api);
  require("../plugins/interface/BankPin.plugin").register(api);
  require("../plugins/bosses/Kraken.plugin").register(api);
  const npcDeaths = [];
  const awards = [];
  api.onNpcDeath((event) => npcDeaths.push(event.npc));
  api.onCustomEvent("combat-achievements:complete", (event) => awards.push([event.player, event.task]));
  native = { core, npcDeaths, awards };
  return native;
}

let nextName = 0;

/** A logged-in player at the crevice who rents a private room. */
async function nativeRoom(t, core) {
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { AreaManager } = require("../dist/game/model/areas/AreaManager");
  const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const connection = new ClientConnection(channel);
  const errors = [];
  const dying = [];
  let room = null;
  t.mock.method(console, "error", (...args) => errors.push(args));
  t.after(() => {
    try {
      for (const npc of dying) for (let i = 0; i < 200 && npc.isDyingFunction(); i++) core.World.process();
      core.World.process();
      if (room?.hasMember(player)) room.leave(player, false);
      core.TaskManager.cancelTasks(player);
      core.TaskManager.cancelTasks(player.getIndex());
    } finally {
      if (player.isRegistered()) core.World.getPlayers().remove(player);
    }
    assert.equal(room.isDestroyed(), true);
    assert.equal(core.TaskManager.hasActiveTask(room), false);
    assert.equal([...core.World.getNpcs()].some((npc) => npc.getPrivateArea() === room), false);
    assert.deepEqual(errors, [], "no caught native or cleanup errors");
  });
  const name = `krakenca${++nextName}`;
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute("bot-skip-persistence", true);
  connection.player = player;
  assert.equal(core.World.getPlayers().add(player), true);
  player.moveTo(new core.Location(2280, 10016, 0));
  AreaManager.process(player);
  player.setNeedsPlacement(false);
  player.getInventory().adds(core.ItemIdentifiers.COINS, 25000);
  const object = core.World.findCacheObject(player, core.ObjectIdentifiers.CREVICE_4, new core.Location(2280, 10017, 0));
  assert.ok(object, "the entrance crevice is on the map");
  assert.equal(PluginManager.emitObjectInteraction({ player, object, objectId: object.getId(),
    location: object.getLocation(), clickType: 2, handled: false }), true, "Private is the registered crevice's");
  await connection.dispatch([{ type: "dialogue_continue", widgetId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, childIndex: 1 }]);
  connection.processTurnPackets();
  room = player.getPrivateArea();
  assert.equal(room?.isKrakenInstance, true, "the rental opened a private room");
  return { player, room, dying };
}

function tickUntil(core, predicate, limit, message) {
  for (let tick = 0; tick < limit && !predicate(); tick++) core.World.process();
  assert.equal(predicate(), true, message);
}

/** Lethal damage from `player`, through the real death task. */
function nativeKill(t, player, npc, surfacedId, dying) {
  dying.push(npc);
  npc.setNpcTransformationId(surfacedId);
  t.mock.method(npc.getCombat(), "getKiller", () => player);
  t.mock.method(npc.getCombat(), "getRecentDamagers", () => [player]);
  npc.setHitpoints(0);
}

for (const route of ["no tentacle back yet", "back but not killed again", "back and killed again"]) {
  test(`Unnecessary Optimisation in a real private fight, tentacles killed before waking: ${route}`, async (t) => {
    const { core, npcDeaths, awards } = await nativeBootstrap();
    const { NpcIdentifiers: N } = core;
    const { player, room, dying } = await nativeRoom(t, core);
    const tentacles = room.getNpcs().filter((npc) => npc.getRealId() === N.WHIRLPOOL_3);
    const boss = room.getNpcs().find((npc) => npc.getRealId() === N.WHIRLPOOL_2);
    assert.equal(tentacles.length, 4);
    assert.ok(boss);
    const tiles = tentacles.map((npc) => npc.getSpawnPosition().toString()).sort();
    const delay = Math.max(1, tentacles[0].getDefinition().getRespawn());
    const back = () => room.getNpcs().filter((npc) => npc.isRegistered() && !tentacles.includes(npc)
      && npc.getRealId() === N.WHIRLPOOL_3);
    const deathTicks = (npc) => npc.getCurrentDefinition().getDeathTicks() + 10;

    for (const tentacle of tentacles) nativeKill(t, player, tentacle, N.ENORMOUS_TENTACLE, dying);
    tickUntil(core, () => tentacles.every((npc) => npcDeaths.includes(npc)), deathTicks(tentacles[0]),
      "the four tentacle deaths reached the registered hooks while the Kraken is down");

    if (route !== "no tentacle back yet") {
      tickUntil(core, () => back().length === 4, delay + 10, "each tentacle's own timer brought a new one back");
      const replacements = back();
      assert.deepEqual(replacements.map((npc) => npc.getSpawnPosition().toString()).sort(), tiles,
        "the new tentacles are on the old ones' tiles");
      for (const replacement of replacements) {
        if (route === "back and killed again") nativeKill(t, player, replacement, N.ENORMOUS_TENTACLE, dying);
        else {
          replacement.setNpcTransformationId(N.ENORMOUS_TENTACLE); // Surfaced, left alive.
          dying.push(replacement);
        }
      }
      if (route === "back and killed again") {
        tickUntil(core, () => replacements.every((npc) => npcDeaths.includes(npc)), deathTicks(replacements[0]),
          "the new tentacles' deaths reached the registered hooks");
      }
    }

    // Wake the Kraken and kill it.
    nativeKill(t, player, boss, N.KRAKEN, dying);
    tickUntil(core, () => npcDeaths.includes(boss), deathTicks(boss), "the Kraken's death reached the registered hooks");
    if (route === "no tentacle back yet") assert.equal(back().length, 0, "no tentacle came back before the Kraken died");
    const tasks = awards.filter(([who]) => who === player).map(([, task]) => task);
    assert.deepEqual(tasks, route === "back but not killed again" ? [] : ["Unnecessary Optimisation"]);
  });
}
