// Run after `yarn build`: node --test tests/wyvern-cave.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");

const WyvernCave = require("../plugins/areas/WyvernCave.plugin");
const SPAWNS = require("../data/definitions/npc-spawns.json");

const T = WyvernCave._test;
let core;
let events;
let area;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  events = [];
  const api = {
    core,
    emitCustomEvent: (name, payload) => {
      events.push(name);
      if (name === "slayer:on-task") payload.onTask = payload.player.onTask === true;
    },
    registerArea: (registered) => { area = registered; },
  };
  WyvernCave.register(api);
});

function fakePlayer({ onTask = false, retaliating = false } = {}) {
  const player = {
    onTask,
    messages: [],
    chains: [],
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => player,
    sendMessage: (text) => player.messages.push(text),
    getCombat: () => ({ isAutoRetaliating: () => retaliating }),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain) }),
  };
  return player;
}

function fakeNpc(name) {
  return { isPlayer: () => false, isNpc: () => true, getDefinition: () => ({ getName: () => name }) };
}

test("the northern cave is an Area that covers its wyverns and none of the southern cave's", () => {
  const spawns = (SPAWNS.spawns ?? SPAWNS).filter((spawn) => /Wyvern$/.test(spawn.name ?? "") && spawn.x > 3500 && spawn.level === 0);
  assert.equal(spawns.length, 29, "the Fossil Island wyverns in the cache's spawns");
  const inside = (spawn) => area.getBoundaries().some((b) => b.inside(new core.Location(spawn.x, spawn.y, spawn.level)));
  // Live: the southern cave's entrance lands at (3604, 10231); every wyvern north of y 10240 is Weve's.
  for (const spawn of spawns) assert.equal(inside(spawn), spawn.y >= 10240, `${spawn.name} at ${spawn.x},${spawn.y}`);
  assert.ok(inside({ x: 3597, y: 10293, level: 0 }), "Weve's own tile is inside");
});

test("an attack on a wyvern without a task is refused with Weve's message and line (captured)", () => {
  const player = fakePlayer();
  for (const name of ["Spitting Wyvern", "Taloned Wyvern", "Long-tailed Wyvern", "Ancient Wyvern"]) {
    player.messages.length = 0;
    player.chains.length = 0;
    assert.equal(area.canAttack(player, fakeNpc(name)), false, name);
    assert.deepEqual(player.messages, [T.WEVE_MESSAGE]);
    assert.equal(player.chains.length, 1, "one dialogue chain");
  }
});

test("Weve's chat head is his, with the captured anger and line", () => {
  const player = fakePlayer();
  area.canAttack(player, fakeNpc("Spitting Wyvern"));
  const first = player.chains[0].getDialogues().get(0);
  assert.equal(first.getNpcId(), core.NpcIdentifiers.WEVE);
  assert.equal(first.getText(), T.WEVE_LINE);
});

test("a player whose Slayer task covers the wyverns, or any other target, is left alone", () => {
  assert.equal(area.canAttack(fakePlayer({ onTask: true }), fakeNpc("Ancient Wyvern")), null);
  assert.equal(area.canAttack(fakePlayer(), fakeNpc("Ice spider")), null);
  assert.equal(area.canAttack(fakePlayer(), fakeNpc("Skeletal Wyvern")), null, "skeletal wyverns have their own task and cave");
});

test("auto-retaliation against an attacking wyvern is refused without repeating the lines", () => {
  const player = fakePlayer({ retaliating: true });
  assert.equal(area.canAttack(player, fakeNpc("Spitting Wyvern")), false);
  assert.deepEqual(player.messages, []);
  assert.equal(player.chains.length, 0);
});
