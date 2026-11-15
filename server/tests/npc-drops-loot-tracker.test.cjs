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
/** NpcDrops' own custom-event listeners (npc-drops:place, npc-drops:report, ...). */
const listeners = new Map();

before(async () => {
  await CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  const noop = () => undefined;
  const api = new Proxy({
    core: {},
    getItemOnGroundManager: () => ({ registerLocation: (_player, item) => placed.push(item.getId()) }),
    emitCustomEvent: (name, payload) => handlers.get(name)?.(payload),
    onCustomEvent: (name, handler) => { listeners.set(name, handler); },
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

// Loot rolled or handed over outside NpcDrops' own death roll: shared Wilderness boss loot, Dusk, Zalcano (npc-drops:place
// with the kill's npcId) and Araxxor's and the Royal Titans' corpses (npc-drops:report, as live at the harvest:
// rsprox_transcripts/237/01088.txt "araxxor (13668)").
test("npc-drops:place with the kill's npcId places the loot and reports it under one new key", () => {
  const { player, scripts } = killer();
  placed.length = 0;
  listeners.get("npc-drops:place")({ player, drops: [{ itemId: BONES, amount: 1 }, { itemId: RAW_CHICKEN, amount: 2 }],
    location: new Location(3229, 3297, 0), npcId: CHICKEN });
  assert.deepEqual(placed, [BONES, RAW_CHICKEN, RAW_CHICKEN]);
  assert.deepEqual(scripts.map((script) => [script.id, script.args[0], script.args[2], script.args[3]]),
    [[LOOT_TRACKER_SCRIPT, CHICKEN, BONES, 1], [LOOT_TRACKER_SCRIPT, CHICKEN, RAW_CHICKEN, 2]]);
  assert.equal(scripts[0].args[1], scripts[1].args[1]);
});

test("npc-drops:place without an npcId only places, and npc-drops:report only reports", () => {
  const { player, scripts } = killer();
  placed.length = 0;
  listeners.get("npc-drops:place")({ player, drops: [{ itemId: BONES, amount: 1 }], location: new Location(3229, 3297, 0) });
  assert.deepEqual(placed, [BONES]);
  assert.deepEqual(scripts, []);
  placed.length = 0;
  listeners.get("npc-drops:report")({ player, npcId: CHICKEN, drops: [{ itemId: BONES, amount: 1 }, { itemId: -1, amount: 1 }] });
  assert.deepEqual(placed, []);
  assert.deepEqual(scripts.map((script) => [script.args[0], script.args[2], script.args[3]]), [[CHICKEN, BONES, 1]], "invalid rows are skipped");
});
