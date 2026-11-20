process.env.DISABLE_PLAYER_BOTS = "1";
// Run after `yarn build`: node --test tests/thieving-locked-doors.test.cjs
//
// The lock-picking doors of issue #5744 - the magic axe hut, Pirates' Hideout, the East Ardougne house and the
// Chaos Druid Tower - through real object clicks on the doors the cache places: `Door` with Open and Pick-lock,
// which nothing answered. The charts, levels and XP are the Wiki's; no capture touches these doors.
const assert = require("node:assert/strict");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const Doors = require("../plugins/objects/Doors.plugin");
const Thieving = require("../plugins/skills/Thieving.plugin");
const LockedDoors = require("../plugins/skills/thieving/LockedDoors.Thieving")._test;

const core = PluginManager.getCoreApi();
const savedHooks = {
  before: PluginManager.beforeObjectInteractionHooks,
  named: PluginManager.objectHooksByName,
  byId: PluginManager.objectHooksById,
  generic: PluginManager.objectInteractionHooks,
  custom: PluginManager.customEventHooks,
};
const placed = new Map();

/** Every placement in the table: where the door stands and the tiles either side of its wall. */
const PLACEMENTS = [...LockedDoors.DOORS].map(([key, row]) => {
  const [id, x, y, z] = key.split(",").map(Number);
  return { key, id, x, y, z, ...row };
});
/** The hinged doors stay open once unlocked; the Ardougne Sewers gate lets the opener through and shuts (below). */
const HINGED = PLACEMENTS.filter(({ door }) => door !== LockedDoors.SEWER_GATE);
const SEWER_GATE = PLACEMENTS.filter(({ door }) => door === LockedDoors.SEWER_GATE);

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core.ObjectDefinition.init();
  core.RegionManager.init();
  for (const door of PLACEMENTS) {
    core.RegionManager.loadMapFiles(door.x, door.y);
    const object = core.MapObjects.get(door.id, new core.Location(door.x, door.y, door.z), null);
    assert.ok(object, `the map cache places door ${door.id} at ${door.x},${door.y},${door.z}`);
    placed.set(door.key, object);
  }
  PluginManager.beforeObjectInteractionHooks = [];
  PluginManager.objectHooksByName = new Map();
  PluginManager.objectHooksById = new Map();
  PluginManager.objectInteractionHooks = [];
  PluginManager.customEventHooks = new Map();
  Doors.register({ ...PluginManager.createApi("Doors"), onServerStartup() {}, onRegionLoaded() {} });
  Thieving.register(PluginManager.createApi("Thieving"));
});

after(() => {
  PluginManager.beforeObjectInteractionHooks = savedHooks.before;
  PluginManager.objectHooksByName = savedHooks.named;
  PluginManager.objectHooksById = savedHooks.byId;
  PluginManager.objectInteractionHooks = savedHooks.generic;
  PluginManager.customEventHooks = savedHooks.custom;
  LockedDoors.setRandom(null);
});

function actor(tile, { thieving = 99, lockpick = true, hitpoints = 10 } = {}) {
  const player = new Player(null, new core.Location(tile[0], tile[1], 0));
  player.setIndex(82000 + Math.floor(Math.random() * 10000));
  player.setUsername("locked-door-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.packets = [];
  player.getPacketSender = () => new Proxy({}, { get: (_, name) => (...args) => { player.packets.push([name, ...args]); } });
  const skills = player.getSkillManager();
  skills.setMaxLevels(core.Skill.THIEVING, thieving, false);
  skills.setCurrentLevel(core.Skill.THIEVING, thieving, false);
  skills.setMaxLevels(core.Skill.HITPOINTS, hitpoints, false);
  skills.addExperiences = (skill, amount) => { (player.xp ??= []).push([skill, amount]); };
  player.damagePackets = [];
  player.getCombat().getHitQueue = () => ({ addPendingDamage: (hits) => player.damagePackets.push(hits) });
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  if (lockpick) player.getInventory().add(new core.Item(core.ItemIdentifiers.LOCKPICK, 1), false);
  return player;
}

function click(player, door, option) {
  const object = placed.get(door.key);
  const clickType = core.ObjectDefinition.forId(door.id).getInteractions().indexOf(option) + 1;
  assert.ok(clickType > 0, `the cache definition offers ${option}`);
  const location = object.getLocation();
  new ObjectActionPacketListener().executeAction(player, object.getId(), location.getX(), location.getY(), clickType);
  for (let tick = 0; tick < 6; tick++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
    player.getMovementQueue().beginCycle();
    player.getMovementQueue().process();
    core.TaskManager.processWalkTo(player.getIndex());
  }
}

/** Whether the wall between the door's two sides lets a player through right now. */
const passable = (door) => core.RegionManager.canMove(door.outside[0], door.outside[1], door.inside[0], door.inside[1], door.z, 1, 1, null);
/** The cycles after a click run the door's own close timer; let any open door shut before the next test. */
const settle = () => {
  for (let i = 0; i < 600; i++) {
    core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process();
  }
};

describe("the lock-picking doors", { concurrency: false }, () => {
  test("the cache doors are the Wiki's: Door with Open and Pick-lock, shut at the start", () => {
    for (const door of PLACEMENTS) {
      assert.deepEqual(core.ObjectDefinition.forId(door.id).getInteractions().slice(0, 2), ["Open", "Pick-lock"], door.key);
      assert.equal(passable(door), false, `${door.key} is shut`);
    }
  });

  test("Open from outside says the door is locked, and the door stays shut", () => {
    for (const door of PLACEMENTS) {
      const player = actor(door.outside);
      click(player, door, "Open");
      assert.equal(player.messages.at(-1), "The door is locked.", door.key);
      assert.equal(passable(door), false, door.key);
      settle();
    }
  });

  test("a good roll unlocks it: the Wiki's XP, the door open for travel, no second XP from the inside", () => {
    for (const door of HINGED) {
      LockedDoors.setRandom(() => 0);
      const player = actor(door.outside);
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.deepEqual(player.xp, [[core.Skill.THIEVING, door.door.xp]], door.key);
      assert.ok(player.messages.includes("You manage to pick the lock."), door.key);
      assert.equal(passable(door), true, `${door.key} lets a player through once unlocked`);
      settle();
    }
  });

  test("a bad roll fails, pays nothing and leaves the door shut; clicking again is allowed", () => {
    for (const door of PLACEMENTS) {
      LockedDoors.setRandom(() => 0.9999);
      const player = actor(door.outside);
      click(player, door, "Pick-lock");
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.equal(player.messages.filter((m) => m === "You fail to pick the lock.").length >= 1, true, door.key);
      assert.equal(player.xp, undefined, door.key);
      assert.equal(passable(door), false, door.key);
      settle();
    }
  });

  test("from the inside the door just opens, with the Wiki's already-unlocked line and no XP", () => {
    for (const door of HINGED) {
      LockedDoors.setRandom(() => 0.9999);
      const player = actor(door.inside);
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.equal(player.xp, undefined, door.key);
      assert.ok(player.messages.includes("The door is already unlocked."), door.key);
      assert.equal(passable(door), true, door.key);
      settle();
      const opener = actor(door.inside);
      click(opener, door, "Open");
      assert.equal(opener.messages.includes("The door is locked."), false, door.key);
      assert.equal(passable(door), true, door.key);
      settle();
    }
  });

  test("below the door's Thieving level nothing is picked, however good the roll", () => {
    for (const door of PLACEMENTS.filter(({ door: { level } }) => level > 1)) {
      LockedDoors.setRandom(() => 0);
      const player = actor(door.outside, { thieving: door.door.level - 1 });
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.ok(player.messages.includes(`You need a Thieving level of ${door.door.level} to pick this lock.`), door.key);
      assert.equal(player.xp, undefined, door.key);
      assert.equal(passable(door), false, door.key);
      settle();
    }
  });

  test("the hut and the hideout need a lockpick; the Ardougne house and the Chaos Druid Tower do not (Wiki)", () => {
    for (const door of HINGED) {
      LockedDoors.setRandom(() => 0);
      const player = actor(door.outside, { lockpick: false });
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      if (door.door.lockpick) {
        assert.ok(player.messages.includes("You need a lockpick to pick this lock."), door.key);
        assert.equal(passable(door), false, door.key);
      } else {
        assert.equal(passable(door), true, `${door.key} opens without a lockpick`);
      }
      settle();
    }
  });

  test("the success charts reproduce the Wiki's percentages, to a tenth of a roll out of 256", () => {
    const pct = (door, level) => LockedDoors.successChance(door, level) * 100;
    const wiki = [
      [LockedDoors.HUT, 1, 9.77], [LockedDoors.HUT, 32, 28.52], [LockedDoors.HUT, 99, 68.75],
      [LockedDoors.HIDEOUT, 1, 5.08], [LockedDoors.HIDEOUT, 39, 16.41], [LockedDoors.HIDEOUT, 99, 34.38],
      [LockedDoors.ARDOUGNE_SOUTH, 16, 25.8], [LockedDoors.ARDOUGNE_SOUTH, 99, 98],
      [LockedDoors.DRUID_TOWER, 1, 3.5], [LockedDoors.DRUID_TOWER, 46, 15.6], [LockedDoors.DRUID_TOWER, 99, 29.7],
      [LockedDoors.SEWER_GATE, 31, 16.3], [LockedDoors.SEWER_GATE, 99, 39.1],
    ];
    for (const [door, level, expected] of wiki) {
      assert.ok(Math.abs(pct(door, level) - expected) < 0.25, `level ${level}: ${pct(door, level)} against the Wiki's ${expected}`);
    }
  });

  test("the Chaos Druid Tower's trap rolls first and deals 6% of maximum Hitpoints (Wiki)", () => {
    const door = PLACEMENTS.find(({ id }) => id === 11723);
    // The first roll fails the trap's disarm, the second passes the lock.
    const rolls = [0.999, 0];
    LockedDoors.setRandom(() => rolls.shift() ?? 0);
    const player = actor(door.outside, { hitpoints: 100, thieving: 46 });
    click(player, door, "Pick-lock");
    LockedDoors.setRandom(null);
    assert.equal(player.damagePackets.length, 1);
    assert.equal(player.damagePackets[0][0].getDamage(), 6, "6% of 100");
    assert.ok(player.messages.includes("You trigger a trap and take damage."));
    assert.equal(passable(door), true, "the lock roll still ran and passed");
    settle();

    LockedDoors.setRandom(() => 0);
    const careful = actor(door.outside, { hitpoints: 100, thieving: 46 });
    click(careful, door, "Pick-lock");
    LockedDoors.setRandom(null);
    assert.equal(careful.damagePackets.length, 0, "a disarmed trap deals nothing");
    settle();
  });
});

describe("the Ardougne Sewers gate (Wiki: Gate (Ardougne Sewers); rsprox capture 1625)", { concurrency: false }, () => {
  const spam = (player) => player.packets.filter(([name]) => name === "sendTypedMessage").map(([, , text]) => text);
  const sounds = (player) => player.packets.filter(([name]) => name === "sendSoundEffect").map(([, id]) => id);
  const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];

  test("both leaves are the cache's Gate with Open and Pick-lock, locked from the west", () => {
    assert.deepEqual(SEWER_GATE.map(({ id }) => id).sort(), [11721, 11722]);
    for (const door of SEWER_GATE) {
      assert.equal(core.ObjectDefinition.forId(door.id).getName(), "Gate");
      const player = actor(door.outside);
      click(player, door, "Open");
      assert.deepEqual(player.messages, ["The door is locked."], door.key);
      assert.ok(sounds(player).includes(2402), `${door.key}: the captured lock sound`);
      assert.deepEqual(at(player), door.outside, `${door.key}: nobody walks through a locked gate`);
      assert.equal(passable(door), false, door.key);
      settle();
    }
  });

  test("a good pick: the captured lines, 25 XP, no animation, carried east and the gate shut behind", () => {
    for (const door of SEWER_GATE) {
      LockedDoors.setRandom(() => 0);
      const player = actor(door.outside, { thieving: 31 });
      let animated = false;
      player.performAnimation = () => { animated = true; };
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.deepEqual(player.xp, [[core.Skill.THIEVING, 25]], door.key);
      assert.deepEqual(spam(player), ["You attempt to pick the lock."], door.key);
      assert.deepEqual(player.messages, ["You manage to pick the lock."], door.key);
      assert.deepEqual(sounds(player).slice(0, 2), [2402, 71], `${door.key}: the lock sound, then the gate's`);
      assert.equal(animated, false, `${door.key}: capture 1625 plays no animation`);
      assert.deepEqual(at(player), door.inside, `${door.key}: the opener ends east of the gate`);
      assert.equal(passable(door), false, `${door.key}: the gate is back two ticks later`);
      settle();
    }
  });

  test("below 31 Thieving the gate stays locked", () => {
    for (const door of SEWER_GATE) {
      LockedDoors.setRandom(() => 0);
      const player = actor(door.outside, { thieving: 30 });
      click(player, door, "Pick-lock");
      LockedDoors.setRandom(null);
      assert.ok(player.messages.includes("You need a Thieving level of 31 to pick this lock."), door.key);
      assert.deepEqual(at(player), door.outside, door.key);
      settle();
    }
  });

  test("from the east Open goes through with the captured line, no lock and no XP", () => {
    for (const door of SEWER_GATE) {
      const player = actor(door.inside, { thieving: 1 });
      click(player, door, "Open");
      assert.deepEqual(spam(player), ["You go through the door."], door.key);
      assert.deepEqual(player.messages, [], door.key);
      assert.equal(player.xp, undefined, door.key);
      assert.ok(sounds(player).includes(71), door.key);
      assert.deepEqual(at(player), door.outside, `${door.key}: the player ends west of the gate`);
      assert.equal(passable(door), false, door.key);
      settle();
    }
  });

  test("Pick-lock from the east needs no pick: the doors' already-unlocked line, no XP, through to the west", () => {
    for (const door of SEWER_GATE) {
      const player = actor(door.inside, { thieving: 1 });
      click(player, door, "Pick-lock");
      assert.deepEqual(player.messages, ["The door is already unlocked."], door.key);
      assert.equal(player.xp, undefined, door.key);
      assert.deepEqual(at(player), door.outside, door.key);
      settle();
      assert.equal(passable(door), false, door.key);
    }
  });
});
