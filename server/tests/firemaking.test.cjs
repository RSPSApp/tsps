// Run after `yarn build`: node --test tests/firemaking.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

test("firemaking logs, success chance, pyromancer bonus and campfire timers follow OSRS", () => {
  const { Equipment } = require("../dist/game/model/container/impl/Equipment");
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  const {
    LIGHTABLE_LOGS_BY_ID,
    lightingSuccessChance,
    firemakingXpMultiplier,
    rollFireLifetimeTicks,
    createCampfireTicks,
    extendCampfireTicks,
    campfireCheckMessage,
    FIRE_MIN_LIFETIME_TICKS,
    FIRE_MAX_LIFETIME_TICKS,
    CAMPFIRE_MAX_LIFETIME_TICKS,
  } = Firemaking;

  // OSRS Wiki making-fires table: level and exact XP for every combustible log.
  const expected = [
    [I.LOGS, 1, 40],
    [I.ACHEY_TREE_LOGS, 1, 40],
    [I.OAK_LOGS, 15, 60],
    [I.WILLOW_LOGS, 30, 90],
    [I.TEAK_LOGS, 35, 105],
    [I.JATOBA_LOGS, 40, 120],
    [I.ARCTIC_PINE_LOGS, 42, 125],
    [I.MAPLE_LOGS, 45, 135],
    [I.MAHOGANY_LOGS, 50, 157.5],
    [I.YEW_LOGS, 60, 202.5],
    [I.BLISTERWOOD_LOGS, 62, 96],
    [I.CAMPHOR_LOGS, 66, 180],
    [I.MAGIC_LOGS, 75, 303.8],
    [I.IRONWOOD_LOGS, 80, 220.5],
    [I.REDWOOD_LOGS, 90, 350],
    [I.ROSEWOOD_LOGS, 92, 268],
  ];
  assert.equal(LIGHTABLE_LOGS_BY_ID.size, expected.length);
  for (const [itemId, level, xp] of expected) {
    const log = LIGHTABLE_LOGS_BY_ID.get(itemId);
    assert.ok(log, `missing log ${itemId}`);
    assert.equal(log.requiredLevel, level);
    assert.equal(log.xpReward, xp);
  }

  // Wiki success chart: 65/256 at level 1, 129/256 at 15, 252/256 at 42, certain from 43.
  assert.equal(lightingSuccessChance(1), 65 / 256);
  assert.equal(lightingSuccessChance(15), 129 / 256);
  assert.equal(lightingSuccessChance(42), 252 / 256);
  assert.equal(lightingSuccessChance(43), 1);
  assert.equal(lightingSuccessChance(99), 1);

  // Fires burn 60-119 seconds (100-198 ticks), independent of the log.
  for (let i = 0; i < 1000; i++) {
    const ticks = rollFireLifetimeTicks();
    assert.ok(ticks >= FIRE_MIN_LIFETIME_TICKS && ticks <= FIRE_MAX_LIFETIME_TICKS);
  }

  // Pyromancer: hood alone 0.4%, full set 2.5%.
  const playerWearing = (items) => ({
    getEquipment: () => ({ getItems: () => items }),
  });
  const slots = [];
  slots[Equipment.HEAD_SLOT] = { getId: () => I.PYROMANCER_HOOD };
  assert.equal(firemakingXpMultiplier(playerWearing(slots)), 1.004);
  slots[Equipment.BODY_SLOT] = { getId: () => I.PYROMANCER_GARB };
  slots[Equipment.LEG_SLOT] = { getId: () => I.PYROMANCER_ROBE };
  slots[Equipment.FEET_SLOT] = { getId: () => I.PYROMANCER_BOOTS };
  assert.equal(firemakingXpMultiplier(playerWearing(slots)), 1.025);
  assert.equal(firemakingXpMultiplier(playerWearing([])), 1);

  // Campfire: first log sets the burn timer, later logs extend it up to 300 ticks.
  const logs = LIGHTABLE_LOGS_BY_ID.get(I.LOGS);
  const redwood = LIGHTABLE_LOGS_BY_ID.get(I.REDWOOD_LOGS);
  assert.equal(createCampfireTicks(logs), 102);
  assert.equal(createCampfireTicks(redwood), 144);
  assert.equal(extendCampfireTicks(102, logs), 105);
  assert.equal(extendCampfireTicks(298, redwood), CAMPFIRE_MAX_LIFETIME_TICKS);

  // Wiki Check tiers.
  assert.equal(campfireCheckMessage(10), "The embers glow softly.");
  assert.equal(campfireCheckMessage(60), "The flames flicker gently.");
  assert.equal(campfireCheckMessage(299), "The roaring fire crackles invitingly.");

  // Walkable floor decorations (Tutorial Island's grass, shape 22 without a
  // clip) must not refuse a fire tile; scenery still does.
  const { blocksFireTile } = Firemaking;
  const object = (type, clipped) => ({
    getType: () => type,
    getDefinition: () => ({ isClippedDecoration: () => clipped }),
  });
  assert.equal(blocksFireTile(object(22, false)), false);
  assert.equal(blocksFireTile(object(22, true)), true);
  assert.equal(blocksFireTile(object(10, false)), true, "scenery blocks");
  assert.equal(blocksFireTile(null), false);
});

test("lighting, tending and expiry move a log from inventory to fire to ashes", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { Location } = require("../dist/game/model/Location");
  const { World } = require("../dist/game/World");
  const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
  const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
  const { ItemIds: I, ObjectIds: O } = require("../dist/util/IdEnums");

  const hooks = {};
  let task = null;
  const api = {
    getTaskManager: () => ({ submit: (submitted) => { task = submitted; } }),
    getObjectManager: () => ObjectManager,
    getItemOnGroundManager: () => ItemOnGroundManager,
    getWorld: () => World,
    onCustomEvent: () => {},
    emitCustomEvent: () => {},
    emitFiremakingBlocked: () => false,
    onPlayerDisconnect: (handler) => { hooks.disconnect = handler; },
    onPlayerLevelUp: (handler) => { hooks.levelUp = handler; },
    onItemOnItem: (handler) => { hooks.itemOnItem = handler; },
    onItemOnGroundItem: (handler) => { hooks.itemOnGroundItem = handler; },
    onGroundItemSecondClick: (ids, handler) => { hooks.groundItemSecondClick = handler; },
    onItemOnObject: (handler) => { hooks.itemOnObject = handler; },
    onObjectInteraction: (name, actions) => { hooks.objectInteraction = { name, actions }; },
    log: () => {},
  };
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  Firemaking.register(api);

  const location = new Location(3200, 3200, 0);
  const inventory = new Map([[I.LOGS, 5]]);
  let xp = 0;
  const messages = [];
  const player = {
    getSkillManager: () => ({
      getCurrentLevel: () => 99,
      getMaxLevel: () => 99,
      addExperiences: (skill, amount) => { xp += amount; },
      stopSkillable: () => {},
    }),
    getInventory: () => ({
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      getItems: () => [],
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getLocation: () => location,
    getPrivateArea: () => null,
    getForceMovement: () => null,
    getMovementQueue: () => ({ size: () => 0, canWalk: () => false, walkStep: () => {}, reset: () => {} }),
    performAnimation: () => {},
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getHitpoints: () => 99,
    getUsername: () => "tester",
    isPlayerBot: () => true,
  };

  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    Firemaking.startBotInventoryFiremaking(player, I.LOGS);
    for (let i = 0; i < 4; i++) task.execute();
    const fire = World.getObjects().find((object) => object.getId() === O.FIRE_5);
    assert.ok(fire, "fire spawned");
    assert.equal(xp, 40, "one log of XP");
    assert.equal(inventory.get(I.LOGS), 4, "log consumed on success");

    hooks.itemOnObject({ player, object: fire, objectId: fire.getId(), itemId: I.LOGS, handled: false });
    for (let i = 0; i < 9; i++) task.execute();
    const campfire = World.getObjects().find((object) => object.getId() === O.FORESTERS_CAMPFIRE);
    assert.ok(campfire, "fire became a forester's campfire");
    assert.equal(xp, 80, "tending grants full XP");
    assert.equal(inventory.get(I.LOGS), 3, "tended log consumed");

    hooks.objectInteraction.actions.Check({ player, object: campfire, handled: false });
    assert.ok(messages.some((message) => message.endsWith(".") && message.startsWith("The ")), "Check reports the burn state");

    for (let i = 0; i < 400; i++) task.execute();
    assert.ok(
      !World.getObjects().some((object) => object.getId() === O.FIRE_5 || object.getId() === O.FORESTERS_CAMPFIRE),
      "campfire expired"
    );
    assert.ok(
      World.getItems().some((item) => item.getItem().getId() === I.ASHES),
      "ashes left where the fire expired"
    );
  } finally {
    Math.random = realRandom;
  }
});
