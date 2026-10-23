// Run after `yarn build`: node --test tests/amoxliatl.test.cjs
// Amoxliatl (Wiki: Amoxliatl, Amoxliatl/Strategies; rsprox captures 1147 and 1695): her drop
// rolls, the platform her spikes and pools cover, where her unstable ice lands, and her
// Combat Achievements.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Location } = require("../dist/game/model/Location");
const { __internals } = require("../plugins/npcs/NpcDrops.plugin");
const Common = require("../plugins/bosses/amoxliatl/Common.Amoxliatl");
const { Fight, onFloor, floorTiles, key } = require("../plugins/bosses/amoxliatl/Fight.Amoxliatl");
const UnstableIce = require("../plugins/bosses/amoxliatl/UnstableIce.Amoxliatl");
const CombatAchievements = require("../plugins/bosses/amoxliatl/CombatAchievements.Amoxliatl");
const { ChatType, encodeChatMessage } = require("../dist/net/protocol/ClientProtocol");

const FROZEN_TEAR = 29895;
const emitted = [];

before(() => {
  __internals.loadDrops();
  Common.init({
    core: { Location, RegionManager: { blocked: () => false } },
    emitCustomEvent: (name, payload) => emitted.push({ name, payload }),
  });
});

function withRandom(values, action) {
  const random = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try {
    return action();
  } finally {
    Math.random = random;
  }
}

const table = () => __internals.tablesByNpc.get(13685)[0];
const player = () => ({ getAttribute: () => undefined, getInventory: () => ({ getAmount: () => 0 }), getBanks: () => [] });

test("two rolls on her table, and one frozen tear roll out of 10", () => {
  assert.equal(table().rolls, 2);
  for (const [roll, [min, max]] of [[0, [2, 4]], [0.65, [5, 10]], [0.95, [10, 20]]]) {
    const drops = withRandom([roll], () => __internals.rollTable(table(), player(), null));
    const tears = drops.filter((drop) => drop.itemId === FROZEN_TEAR);
    assert.equal(tears.length, 1, `roll ${roll}`);
    assert.ok(tears[0].amount >= min && tears[0].amount <= max, `roll ${roll}: ${tears[0].amount}`);
    const main = drops.filter((drop) => drop.itemId !== FROZEN_TEAR);
    assert.ok(main.length >= 2, `roll ${roll}: two main-table drops, got ${main.length}`);
  }
});

test("the platform is the captured octagon around (1365, 4511) and the path east", () => {
  assert.ok(onFloor(1365, 4511));
  assert.ok(onFloor(1359, 4511) && onFloor(1371, 4511));
  assert.ok(onFloor(1363, 4517) && !onFloor(1362, 4517));
  assert.ok(onFloor(1376, 4510) && onFloor(1376, 4512) && !onFloor(1376, 4513));
  assert.ok(!onFloor(1377, 4511), "the ice blockages stand off the floor");
  assert.equal(floorTiles().length, 144);
});

function fightAt(px, py, { blocks = [], path = false } = {}) {
  const session = {
    worldTile: (location) => [location.getX(), location.getY()],
    tile: ([x, y, z]) => new Location(x, y, z ?? 0),
    area: null,
  };
  return {
    session,
    blocks: new Set(blocks.map(([x, y]) => ({ getLocation: () => new Location(x, y, 0) }))),
    boss: { getLocation: () => new Location(1362, 4510, 0), getSize: () => 3 },
    playerTile: () => [px, py],
    onPath: ([x]) => path || x >= 1372,
  };
}

test("unstable ice lands on free floor near the player: not on them, her, the path or other ice", () => {
  const fight = fightAt(1366, 4511, { blocks: [[1367, 4511]] });
  const tiles = withRandom([0.5], () => UnstableIce.targets(fight, 200));
  assert.ok(tiles.length > 0);
  for (const [x, y] of tiles) {
    assert.ok(onFloor(x, y), `${x},${y} on the floor`);
    assert.ok(Math.max(Math.abs(x - 1366), Math.abs(y - 4511)) <= 4, `${x},${y} within 4`);
    assert.ok(!(x === 1366 && y === 4511), "not the player's tile");
    assert.ok(!(x >= 1362 && x <= 1364 && y >= 4510 && y <= 4512), `${x},${y} not under her`);
    assert.ok(x < 1372, `${x},${y} not on the path`);
    assert.ok(!(x === 1367 && y === 4511), "not on another block");
  }
  assert.equal(UnstableIce.targets(fightAt(1366, 4511), 3).length, 3);
});

test("the fight's tasks are judged from what it saw", () => {
  const judged = (stats, ticks, kills = 1) => {
    emitted.length = 0;
    CombatAchievements.judge({ player: {}, session: { kills }, stats }, ticks);
    return emitted.filter((event) => event.name === "combat-achievements:complete").map((event) => event.payload.task);
  };
  const clean = { damageTaken: 0, prayerLost: false, shattered: false, usedTemotli: false, otherWeapon: true };
  assert.deepEqual(judged(clean, 40), ["Amoxliatl Speed-Trialist", "Amoxliatl Speed-Chaser", "Nagua Negation", "Totally Shattered", "Without Ralos' Light"]);
  assert.deepEqual(judged({ ...clean, damageTaken: 3, prayerLost: true, shattered: true }, 60, 10), ["Amoxliatl Speed-Trialist", "Kemo Makti"]);
  assert.deepEqual(judged({ ...clean, damageTaken: 1, prayerLost: true, shattered: true, usedTemotli: true, otherWeapon: false }, 100), ["Temotli Triumph"]);
});

test("her line goes to the chatbox as npc_say with her name, the Unstable Ice line as spam", () => {
  // The chat packet's body: the text, the chat type, the sender's name, the prefix, the player id.
  const body = (packet) => packet.subarray(packet.length - (packet.readUInt16BE(1)));
  const line = body(encodeChatMessage("game", "Euat!", "Amoxliatl", "", -1, ChatType.NPC_SAY));
  assert.equal(line.toString("latin1", 0, 5), "Euat!");
  assert.equal(line[6], 116);
  assert.equal(line.toString("latin1", 7, 16), "Amoxliatl");
  assert.equal(body(encodeChatMessage("game", "x", "", "", -1, ChatType.SPAM))[2], 105);
  assert.equal(body(encodeChatMessage("game", "x"))[2], 0);
});

test("the spikes hurt a player still on one when they come up, not one who stepped off", () => {
  const hits = [];
  const fightOn = (x, y) => ({ over: false, player: { getHitpoints: () => 99 }, playerTile: () => [x, y], hurtPlayer: (damage) => hits.push(damage) });
  const spiked = new Set([key(1365, 4511), key(1366, 4511)]);
  Fight.prototype.spikesErupt.call(fightOn(1365, 4511), spiked);
  assert.equal(hits.length, 1);
  assert.ok(hits[0] >= 6 && hits[0] <= 10, `${hits[0]}`);
  Fight.prototype.spikesErupt.call(fightOn(1365, 4513), spiked);
  assert.equal(hits.length, 1, "stepped off: no damage");
});

test('the quest guardian ends its chamber without regular loot, kill counts, personal bests or achievements', () => {
  assert.deepEqual(require('../data/definitions/npc-drops.json').npcs['13686']?.tables ?? [], []);
  let death, ended = false, hidden = false;
  require('../plugins/bosses/amoxliatl/Kills.Amoxliatl')({
    persistAttribute() {}, onNpcBeforeDeath() {}, onNpcDeath(handler) { death = handler; },
    onCustomEvent() {}, onPlayerLogin() {},
  });
  emitted.length = 0;
  const actor = {};
  death({ npc: { __amoxliatlFight: { stopped: false, player: actor,
    session: { quest: true, end() { ended = true; } }, hideHud() { hidden = true; },
  } } });
  assert.ok(ended && hidden);
  assert.deepEqual(emitted, [{ name: 'amoxliatl:quest-defeated', payload: { player: actor } }]);
});
