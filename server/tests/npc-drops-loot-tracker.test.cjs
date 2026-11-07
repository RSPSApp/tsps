// Run after `yarn build`: node --test tests/npc-drops-loot-tracker.test.cjs
// Live runs loottracker_add_loot (script 7192) once per item of a kill's loot, and RuneLite's loot
// tracker counts NPC kills only from it (#2265: kills never reached it through the gateway).
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Location } = require("../dist/game/model/Location");
const { Player } = require("../dist/game/entity/impl/player/Player");
const NpcDrops = require("../plugins/npcs/NpcDrops.plugin");

const { __internals } = NpcDrops;
const LOOT_TRACKER_SCRIPT = 7192;
const CHICKEN = 1174;
const BONES = 526;
const RAW_CHICKEN = 2138;

const placed = [];
const handlers = new Map();

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const noop = () => undefined;
  const api = new Proxy({
    core: {},
    getItemOnGroundManager: () => ({ registerLocation: (_player, item) => placed.push(item.getId()) }),
    emitCustomEvent: (name, payload) => handlers.get(name)?.(payload),
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  NpcDrops.register(api);
  __internals.loadDrops();
});

function killer() {
  const player = new Player(null);
  const scripts = [];
  player.getPacketSender = () => ({ sendClientScript: (id, ...args) => scripts.push({ id, args }) });
  return { player, scripts };
}

function chicken() {
  const definition = { getName: () => "Chicken" };
  return { getLocation: () => new Location(3229, 3297, 0), getDefinition: () => definition, getCurrentDefinition: () => definition };
}

function kill(player) {
  placed.length = 0;
  __internals.dropFor(player, chicken(), CHICKEN, new Location(3229, 3297, 0));
}

test("a kill runs the loot tracker script once per dropped item, under one key", () => {
  const { player, scripts } = killer();
  kill(player);
  assert.ok(placed.includes(BONES) && placed.includes(RAW_CHICKEN), `placed ${placed}`);
  assert.ok(scripts.length > 0 && scripts.every((script) => script.id === LOOT_TRACKER_SCRIPT));
  assert.deepEqual(scripts.map((script) => script.args[2]).sort(), [...new Set(placed)].sort());
  assert.ok(scripts.every((script) => script.args[0] === CHICKEN && script.args[1] === scripts[0].args[1]));
  assert.ok(scripts.every((script) => script.args[3] >= 1));
});

test("each kill gets a new key", () => {
  const { player, scripts } = killer();
  kill(player);
  const first = scripts[0].args[1];
  scripts.length = 0;
  kill(player);
  assert.ok(scripts[0].args[1] > first);
});

test("loot a plugin takes over (a corpse or chest to loot later) isn't reported at the kill", () => {
  const { player, scripts } = killer();
  handlers.set("npc-drops:generated", (event) => { event.handled = true; });
  try {
    kill(player);
  } finally {
    handlers.delete("npc-drops:generated");
  }
  assert.deepEqual(scripts, []);
});
