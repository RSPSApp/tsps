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
