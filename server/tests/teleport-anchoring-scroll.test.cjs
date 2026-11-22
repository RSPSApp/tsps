// Run after `yarn build`: node --test tests/teleport-anchoring-scroll.test.cjs
// Native captures 4099, 4093 and 1143 (rev 237): an accurate player hit (including zero) first
// rolls an Abyssal demon self-teleport at 1/6, then the player teleport at 1/3. Landing (#6496,
// rsprox captures 96, 97, 1885, 4099, local 1000230 and others): the teleported party lands next to
// the other, on any of the eight sides, never more than the Wiki's 20 tiles away. Item dialogue,
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

function mobile(id, player = false, at = [3222, 3218, 0]) {
  let location = new core.Location(...at);
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
  assert.equal(chebyshev(player.position(), demon.position()), 1, "the player lands next to the demon");
  assert.equal(player.position()[2], 0, "the landing stays on the same plane");
});

test("a successful demon roll teleports it and suppresses the later player roll", (t) => {
  const player = mobile(0, true), demon = mobile(415);
  const rolls = [0, 0];
  const bounds = [];
  t.mock.method(core.RegionManager, "canMove", () => true);
  t.mock.method(core.Misc, "getRandom", (max) => { bounds.push(max); return rolls.shift(); });

  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => true } });

  assert.deepEqual(bounds, [5, 7], "only the demon roll and its choice of the eight tiles are drawn");
  assert.equal(demon.graphics[0], 409);
  assert.equal(demon.animations[0], 2309);
  assert.equal(chebyshev(demon.position(), player.position()), 1, "the demon lands next to the player");
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

function chebyshev(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function teleportPlayer(t, player, demon, pick = () => 0) {
  t.mock.method(core.Misc, "getRandom", (max) => max === 5 ? 1 : max === 2 ? 0 : pick(max));
  anchoring._test.onHitResolved({ attacker: player, target: demon, hit: { isAccurate: () => true } });
}

test("a player attacking from range is pulled next to the demon, not up to twenty tiles away", (t) => {
  t.mock.method(core.RegionManager, "canMove", () => true);
  for (let pick = 0; pick < 8; pick++) {
    const player = mobile(0, true, [3222, 3218, 0]), demon = mobile(415, false, [3227, 3221, 0]);
    teleportPlayer(t, player, demon, () => pick);
    assert.equal(chebyshev(player.position(), demon.position()), 1, `choice ${pick} touches the demon`);
    assert.equal(player.resets(), 1);
  }
});

test("all eight sides are offered, except the tile the player already stands on", (t) => {
  t.mock.method(core.RegionManager, "canMove", () => true);
  const demon = mobile(415, false, [3227, 3221, 0]);
  const around = (at) => anchoring._test.landingTiles(mobile(0, true, at), demon).map((l) => [l.getX() - 3227, l.getY() - 3221]);

  assert.equal(new Set(around([3222, 3218, 0]).map(String)).size, 8);
  assert.deepEqual(around([3226, 3221, 0]).some(([x, y]) => x === -1 && y === 0), false, "the current tile is not a landing");
  assert.equal(around([3226, 3221, 0]).length, 7);
});

test("a demon more than twenty tiles away cannot pull the player, and a wall between keeps that side out", (t) => {
  const steps = [];
  t.mock.method(core.RegionManager, "canMove", (fromX, fromY, toX, toY) => {
    steps.push([fromX, fromY, toX, toY]);
    return toX !== 3226; // a wall along the demon's west side
  });
  const far = mobile(0, true, [3200, 3221, 0]), demon = mobile(415, false, [3227, 3221, 0]);
  assert.deepEqual(anchoring._test.landingTiles(far, demon), [], "every side is over 20 tiles from the player");

  teleportPlayer(t, far, demon);
  assert.deepEqual(far.position(), [3200, 3221, 0]);
  assert.equal(far.resets(), 0, "nothing moved, so combat carries on");

  const near = mobile(0, true, [3222, 3218, 0]);
  const tiles = anchoring._test.landingTiles(near, demon).map((l) => [l.getX(), l.getY()]);
  assert.equal(tiles.length, 5);
  assert.ok(tiles.every(([x]) => x !== 3226));
  assert.ok(steps.every(([fx, fy, tx, ty]) => chebyshev([fx, fy], [3227, 3221]) === 0 && chebyshev([tx, ty], [3227, 3221]) === 1),
    "each side is checked as a step out from the demon");
});

test("a different plane offers no landing", () => {
  const player = mobile(0, true, [3222, 3218, 1]), demon = mobile(415, false, [3227, 3221, 0]);
  assert.deepEqual(anchoring._test.landingTiles(player, demon), []);
});

test("the saved unlock vetoes only the two Elder Chaos druid pull variants", () => {
  const player = mobile(0, true);
  const { ELDER_CHAOS_DRUID, ELDER_CHAOS_DRUID_2, ABYSSAL_DEMON } = core.NpcIdentifiers;
  const pull = (id) => {
    const event = { npc: mobile(id), player, blocked: false };
    PM.emitCustomEvent("combat:npc-teleports-player", event);
    return event.blocked;
  };

  assert.equal(pull(ELDER_CHAOS_DRUID), false);
  player.getAttribute = () => true;
  assert.equal(pull(ELDER_CHAOS_DRUID), true);
  assert.equal(pull(ELDER_CHAOS_DRUID_2), true);
  assert.equal(pull(ABYSSAL_DEMON), false);
});

test("the confirmation closes on Cancel or a stale item and plays feedback only on success", () => {
  const item = new core.Item(29455, 1);
  for (const { option, carried, accepted } of [
    { option: 2, carried: true, accepted: false },
    { option: 1, carried: false, accepted: false },
    { option: 1, carried: true, accepted: true },
  ]) {
    let chain;
    const calls = [];
    const inventory = {
      getItems: () => carried ? [item] : [],
      deleteAtSlot: (...args) => calls.push(["consume", ...args]),
    };
    const sender = {
      closeInterface: (id) => calls.push(["close", id]),
      sendVarbit: (...args) => calls.push(["varbit", ...args]),
      sendSoundEffect: (...args) => calls.push(["sound", ...args]),
    };
    let unlocked = false;
    const player = {
      getInventory: () => inventory,
      getPacketSender: () => sender,
      getDialogueManager: () => ({
        reset() {},
        startDialogues: (value) => { chain = value; },
      }),
      getAttribute: () => unlocked,
      setAttribute: (_, value) => { unlocked = value; },
      performAnimation: (animation) => calls.push(["animation", animation.getId()]),
    };

    anchoring._test.read({ player, item });
    chain.getDialogues().get(1).execute(option);

    assert.equal(unlocked, accepted);
    assert.deepEqual(calls, accepted
      ? [["consume", 0, 1], ["varbit", 10672, 1], ["animation", 7403], ["sound", 2655, 1, 0]]
      : [["close", 219]]);
  }
});
