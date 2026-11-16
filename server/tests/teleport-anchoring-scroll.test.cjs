// Run after `yarn build`: node --test tests/teleport-anchoring-scroll.test.cjs
// Native captures 4099, 4093 and 1143 (rev 237): an accurate player hit (including zero) first
// rolls an Abyssal demon self-teleport at 1/6, then the player teleport at 1/3. Item dialogue,
// quantity and relog are exercised through the live server's agent MCP for this change.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const anchoring = require("../plugins/items/TeleportAnchoringScroll.plugin");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
});

function mobile(id, player = false) {
  let location = new core.Location(3222, 3218, 0);
  const graphics = [], animations = [];
  let resets = 0;
  const value = {
    isPlayer: () => player,
    isNpc: () => !player,
    getAsNpc: () => value,
    getId: () => id,
    getSize: () => 1,
    getPrivateArea: () => null,
    getLocation: () => location,
    moveTo: (next) => { location = next.clone(); },
    performGraphic: (graphic) => graphics.push(graphic.getId()),
    performAnimation: (animation) => animations.push(animation.getId()),
    getCombat: () => ({ reset: () => { resets++; } }),
    getAttribute: () => false,
    graphics,
    animations,
    resets: () => resets,
    position: () => [location.getX(), location.getY(), location.getZ()],
  };
  return value;
}

test("an accurate hit rolls the demon self-teleport before the player teleport", (t) => {
  const player = mobile(0, true), demon = mobile(415);
  const rolls = [1, 0, 0];
  const bounds = [];
  t.mock.method(core.Misc, "getRandom", (max) => { bounds.push(max); return rolls.shift(); });

  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => true } });

  assert.deepEqual(bounds.slice(0, 2), [5, 2], "1/6 demon roll precedes 1/3 player roll");
  assert.equal(player.graphics[0], 409);
  assert.equal(demon.animations.at(-1), 2309);
  assert.equal(player.resets(), 1, "the displaced player's combat ends");
  assert.ok(new core.Location(...player.position()).getDistance(new core.Location(3222, 3218, 0)) <= 3);
  assert.equal(player.position()[2], 0, "the landing stays on the same plane");
});

test("a successful demon roll teleports it and suppresses the later player roll", (t) => {
  const player = mobile(0, true), demon = mobile(415);
  const rolls = [0, 0];
  const bounds = [];
  t.mock.method(core.Misc, "getRandom", (max) => { bounds.push(max); return rolls.shift(); });

  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => true } });

  assert.deepEqual(bounds, [5, 41], "only the demon roll and its landing choice are drawn");
  assert.equal(demon.graphics[0], 409);
  assert.equal(demon.animations[0], 2309);
  assert.deepEqual(player.position(), [3222, 3218, 0]);
});

test("an unlocked player remains in place but the demon self-teleport roll still happens", (t) => {
  const player = mobile(0, true), demon = mobile(415);
  player.getAttribute = () => true;
  const rolls = [1, 0];
  const bounds = [];
  t.mock.method(core.Misc, "getRandom", (max) => { bounds.push(max); return rolls.shift(); });

  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => true } });

  assert.deepEqual(bounds, [5, 2], "anchoring does not bypass the roll sequence");
  assert.deepEqual(player.position(), [3222, 3218, 0]);
  assert.deepEqual(player.graphics, []);
});

test("inaccurate hits and non-player attackers do not trigger a teleport", (t) => {
  const player = mobile(0, true), demon = mobile(415);
  t.mock.method(core.Misc, "getRandom", () => assert.fail("no teleport roll expected"));

  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => false } });
  anchoring._test.onHitResolved({ attacker: demon, target: player, hit: { isAccurate: () => true } });

  assert.deepEqual(player.graphics, []);
  assert.deepEqual(demon.animations, []);
});
