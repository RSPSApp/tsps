// Run after `yarn build`: node --test tests/combat-ring-burns.test.cjs
// Wiki (Burn): leaving a POH combat ring removes burns, both by climbing out and by losing the fight inside it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
let House, Ids;

let core;
let next = 7600;
const ROPE = () => Ids.loc("poh_combat_ringwall");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  House = require("../plugins/skills/construction/House.Construction");
  Ids = require("../plugins/skills/construction/Ids.Construction");
});
after(() => PM.emitServerShutdown({}));

function actor(t, x, y) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("ringburn" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, 0));
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); core.TaskManager.cancelTasks(p); });
  return p;
}

/** A house whose combat ring covers 3000-3002 x 3000-3002, with its rope along x 2999. */
function withRing(t) {
  const loc = (id, x, y) => ({ getId: () => id, getLocation: () => new core.Location(x, y, 0) });
  const furnitureObjects = [];
  for (let x = 3000; x <= 3002; x++) for (let y = 3000; y <= 3002; y++) {
    furnitureObjects.push(loc(Ids.loc(x === 3001 && y === 3001 ? "poh_combat_mat_middle" : "poh_combat_mat_side"), x, y));
  }
  const house = { furnitureObjects, getRoomPositionAt: () => ({ x: 0, y: 0, plane: 0 }) };
  t.mock.method(House, "houseFor", () => house);
}

function burn(target, attacker, stacks) {
  for (let i = 0; i < stacks; i++) PM.emitCustomEvent("combat:burn", { attacker, target, damage: 10 });
}

function remaining(target) {
  const query = { target, remaining: 0 };
  PM.emitCustomEvent("combat:burn-remaining", query);
  return query.remaining;
}

test("climbing out over the ropes clears the burns", (t) => {
  withRing(t);
  const player = actor(t, 3000, 3001), attacker = actor(t, 3001, 3001);
  burn(player, attacker, 1);
  assert.ok(remaining(player) > 0, "burned in the ring");
  const rope = { getId: ROPE, getLocation: () => new core.Location(2999, 3001, 0) };
  const handled = PM.emitObjectInteraction({ player, object: rope, objectId: ROPE(), clickType: 1, option: "Climb-over",
    definition: { getName: () => "Combat ring", getInteractions: () => ["Climb-over"] },
    location: { x: 2999, y: 3001, z: 0 }, handled: false });
  assert.equal(handled, true);
  assert.equal(player.getLocation().getX(), 2999, "climbed out");
  assert.equal(remaining(player), 0);
});

test("losing a ring fight moves the loser out without the burns", (t) => {
  withRing(t);
  const player = actor(t, 3001, 3001), attacker = actor(t, 3002, 3001);
  burn(player, attacker, 3);
  const event = { player, preventDeath: false };
  PM.emitPlayerBeforeDeath(event);
  assert.equal(event.preventDeath, true, "the ring's own defeat runs");
  assert.notEqual(player.getLocation().getX(), 3001, "moved outside");
  assert.equal(remaining(player), 0);
});

test("climbing into the ring keeps the burns", (t) => {
  withRing(t);
  const player = actor(t, 2998, 3001), attacker = actor(t, 3001, 3001);
  burn(player, attacker, 1);
  const rope = { getId: ROPE, getLocation: () => new core.Location(2999, 3001, 0) };
  PM.emitObjectInteraction({ player, object: rope, objectId: ROPE(), clickType: 1, option: "Climb-over",
    definition: { getName: () => "Combat ring", getInteractions: () => ["Climb-over"] },
    location: { x: 2999, y: 3001, z: 0 }, handled: false });
  assert.equal(player.getLocation().getX(), 3000, "climbed in");
  assert.ok(remaining(player) > 0);
});
