// Run after `yarn build`: node --test tests/firemaking.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const core = PluginManager.getCoreApi();
function emptyApi() {
  return { core, getTaskManager: () => ({ submit() {} }),
    getObjectManager: () => ({ register() {}, deregister() {} }),
    getItemOnGroundManager: () => ({ registerLocation() {}, getGroundItem() {}, deregister() {} }),
    getWorld: () => ({ getObjects: () => [] }),
    onCanUseItem() {}, onCustomEvent() {}, onPlayerDisconnect() {}, onItemOnItem() {}, onItemOnGroundItem() {},
    onGroundItemClick() {}, onItemOnObject() {}, onObjectInteraction() {}, log() {} };
}

test("firemaking logs, success chance, pyromancer bonus and campfire timers follow OSRS", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require('../plugins/skills/Firemaking.plugin').register(emptyApi());
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
    [I.KINDLING_2, 1, 48],
    [I.LOGS, 1, 40],
    [I.RED_LOGS, 1, 50], [I.GREEN_LOGS, 1, 50], [I.BLUE_LOGS, 1, 50],
    [I.WHITE_LOGS, 1, 50], [I.PURPLE_LOGS, 1, 50],
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
    core,
    getTaskManager: () => ({ submit: (submitted) => { task = submitted; } }),
    getObjectManager: () => ObjectManager,
    getItemOnGroundManager: () => ItemOnGroundManager,
    getWorld: () => World,
    onCanUseItem: () => {},
    onCustomEvent: () => {},
    emitCustomEvent: () => {},
    emitFiremakingBlocked: () => false,
    onPlayerDisconnect: (handler) => { hooks.disconnect = handler; },
    onItemOnItem: (handler) => { hooks.itemOnItem = handler; },
    onItemOnGroundItem: (handler) => { hooks.itemOnGroundItem = handler; },
    onGroundItemClick: (ids, clickType, handler) => { hooks.groundItemClick = { ids, clickType, handler }; },
    onItemOnObject: (item, _object, handler) => { hooks.itemOnObject = handler ?? item; },
    onObjectInteraction: (name, actions) => { hooks.objectInteraction = { name, actions }; },
    log: () => {},
  };
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  Firemaking.register(api);
  // Ground logs are "Take" (op3) and "Light" (op4) in the cache.
  assert.equal(hooks.groundItemClick.clickType, 4);
  assert.ok(hooks.groundItemClick.ids.includes(I.LOGS));

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
    getDialogueManager: () => ({ startDialogues: () => {} }),
    getLocation: () => location,
    getPrivateArea: () => null,
    getForceMovement: () => null,
    getMovementQueue: () => ({ size: () => 0, canWalk: () => false, walkStep: () => {}, reset: () => {} }),
    performAnimation: () => {},
    setPositionToFace: () => {},
    getPacketSender: () => ({ sendGlobalGraphic() {}, sendTypedMessage: (_type, message) => messages.push(message) }),
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
    // rsprox captures, recording 1035: the log goes underfoot on the click and the fire catches 4 ticks later.
    assert.equal(inventory.get(I.LOGS), 4, "log leaves the inventory on the click");
    assert.ok(ItemOnGroundManager.getGroundItem("tester", I.LOGS, location, null), "and lies on the ground");
    assert.deepEqual(messages, ["You attempt to light the logs."]);
    for (let i = 0; i < 3; i++) task.execute();
    assert.ok(!World.getObjects().some((object) => object.getId() === O.FIRE_23), "no fire on the roll tick");
    task.execute();
    const fire = World.getObjects().find((object) => object.getId() === O.FIRE_23);
    assert.ok(fire, "fire spawned");
    assert.equal(xp, 40, "one log of XP");
    assert.equal(messages.at(-1), "The fire catches and the logs begin to burn.");
    assert.equal(ItemOnGroundManager.getGroundItem("tester", I.LOGS, location, null), null, "ground log burnt");

    hooks.itemOnObject({ player, object: fire, objectId: fire.getId(), itemId: I.LOGS, handled: false });
    for (let i = 0; i < 9; i++) task.execute();
    const campfire = World.getObjects().find((object) => object.getId() === O.FORESTERS_CAMPFIRE);
    assert.ok(campfire, "fire became a forester's campfire");
    assert.equal(xp, 80, "tending grants full XP");
    assert.equal(inventory.get(I.LOGS), 3, "tended log consumed");

    hooks.objectInteraction.actions.Check({ player, object: campfire, handled: false });

    for (let i = 0; i < 400; i++) task.execute();
    assert.ok(
      !World.getObjects().some((object) => object.getId() === O.FIRE_23 || object.getId() === O.FORESTERS_CAMPFIRE),
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

async function campfireHarness(t) {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const { ItemIdentifiers: I, ObjectIdentifiers: O, Location } = core;
  const hooks = {};
  const tasks = [];
  const objects = new Set();
  const ashes = [];
  const ground = [];
  const api = {
    core,
    getTaskManager: () => ({ submit: t => tasks.push(t) }),
    getObjectManager: () => ({
      register: o => objects.add(o), deregister: o => objects.delete(o),
      objectsAt: () => [],
    }),
    getItemOnGroundManager: () => ({
      getGroundItem: (_owner, id, loc) => ground.find(g => g.item.getId() === id && g.loc.equals(loc)) ?? null,
      registerLocation: (p, item, loc) => (item.getId() === core.ItemIdentifiers.ASHES ? ashes : ground).push({ item, loc }),
      deregister: g => ground.splice(ground.indexOf(g), 1),
    }),
    getWorld: () => ({ getObjects: () => [...objects] }),
    onCanUseItem() {}, onCustomEvent() {}, emitCustomEvent() {}, emitFiremakingBlocked: () => false,
    onPlayerDisconnect: h => hooks.disconnect = h, onItemOnGroundItem() {},
    onGroundItemClick: (_ids, _type, h) => hooks.groundLight = h,
    onItemOnItem: h => hooks.combine = h,
    onItemOnObject: (item, _object, h) => hooks.use = h ?? item,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    log() {},
  };
  const Firemaking = require('../plugins/skills/Firemaking.plugin');
  Firemaking.register(api);
  const inventory = new Map([[I.LOGS, 3], [I.TINDERBOX, 1]]);
  let menu, xp = 0, chain;
  const messages = [];
  const graphics = [];
  const animations = [];
  const loc = new Location(3200, 3200);
  const player = {
    getSkillManager: () => ({ getCurrentLevel: () => 99, stopSkillable() {}, addExperiences: (_, n) => xp += n }),
    getInventory: () => ({
      contains: id => (inventory.get(id) ?? 0) > 0,
      getAmount: id => inventory.get(id) ?? 0,
      deleteNumber: (id, n) => inventory.set(id, inventory.get(id) - n),
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getDialogueManager: () => ({ startDialogues: c => chain = c }),
    getLocation: () => loc, getPrivateArea: () => null, getForceMovement: () => null,
    getMovementQueue: () => ({ size: () => 0, canWalk: () => false }),
    performAnimation: a => animations.push(a.getId()), sendMessage: text => messages.push(text),
    setPositionToFace() {},
    getPacketSender: () => ({ sendCreationMenu: m => menu = m, sendInterfaceRemoval() {}, sendTypedMessage: (_type, text) => messages.push(text), sendGlobalGraphic: (graphic, tile) => graphics.push({ graphic, tile }) }),
    isRegistered: () => true, isPlayerBot: () => true, getHitpoints: () => 99, getUsername: () => 'campfiretest',
  };
  const tick = n => { for (let i=0; i<n; i++) tasks[0].execute(); };
  const useLog = (object, itemId = I.LOGS) => {
    const e = { player, object, objectId: object.getId(), itemId, handled: false };
    hooks.use(e); return e;
  };
  const oldExists = core.MapObjects.exists;
  const oldRandom = Math.random;
  const oldMapObjects = core.MapObjects.mapObjects;
  core.MapObjects.exists = o => objects.has(o);
  core.MapObjects.mapObjects = new Map();
  Math.random = () => 0.999;
  t.after(() => {
    core.MapObjects.exists = oldExists;
    core.MapObjects.mapObjects = oldMapObjects;
    Math.random = oldRandom;
  });
  return { core, I, O, inventory, loc, player, hooks, objects, ground, ashes, animations, messages, graphics,
    tick, useLog, menu: () => menu, xp: () => xp, chain: () => chain,
    light() {
      hooks.combine({ player, usedItemId: I.TINDERBOX, usedWithItemId: I.LOGS });
      tick(4);
      const fire = [...objects][0];
      assert.ok(fire, 'normal fire was lit');
      return fire;
    },
  };
}

test("first campfire log sets its duration independently of the original fire", async t => {
  const h = await campfireHarness(t);
  h.useLog(h.light()); h.tick(9);
  const campfire = [...h.objects][0];
  assert.equal(campfire.getId(), h.O.FORESTERS_CAMPFIRE);
  h.hooks.disconnect({ player: h.player });
  h.tick(101);
  assert.ok(h.objects.has(campfire), 'fire lasts until the full 102 ticks elapse');
  h.tick(1);
  assert.ok(!h.objects.has(campfire), 'a long-lived original fire does not extend the timer');
  assert.equal(h.ashes.length, 1);
});

test("permanent normal and coloured fires convert, restore, and leave ashes", async t => {
  const pairs = [
    [core.ObjectIdentifiers.FIRE_23, core.ObjectIdentifiers.FORESTERS_CAMPFIRE],
    [core.ObjectIdentifiers.FIRE_24, core.ObjectIdentifiers.FORESTERS_CAMPFIRE_2],
    [core.ObjectIdentifiers.FIRE_25, core.ObjectIdentifiers.FORESTERS_CAMPFIRE_3],
    [core.ObjectIdentifiers.FIRE_26, core.ObjectIdentifiers.FORESTERS_CAMPFIRE_4],
    [core.ObjectIdentifiers.FIRE_16, core.ObjectIdentifiers.FORESTERS_CAMPFIRE_5],
    [core.ObjectIdentifiers.FIRE_17, core.ObjectIdentifiers.FORESTERS_CAMPFIRE_6],
  ];
  for (const [fireId, campfireId] of pairs) await t.test(`fire ${fireId}`, async t => {
    const h = await campfireHarness(t);
    const permanent = new core.GameObject(fireId, h.loc, 10, 0);
    h.objects.add(permanent);
    assert.equal(h.useLog(permanent).handled, true);
    h.tick(9);
    assert.ok(!h.objects.has(permanent));
    const campfire = [...h.objects][0];
    assert.equal(campfire.getId(), campfireId);
    h.hooks.disconnect({ player: h.player });
    h.tick(102);
    assert.ok(h.objects.has(permanent), 'permanent fire returns');
    assert.equal(h.ashes.length, 1, 'expiry also leaves ashes');
    assert.equal(h.ashes[0].item.getId(), h.I.ASHES);
    assert.ok(h.ashes[0].loc.equals(h.loc));
  });
});

test("mixed logs offer a choice, make-one stops, and the selected log controls XP and timer", async t => {
  const h = await campfireHarness(t);
  const fire = h.light();
  h.inventory.set(h.I.OAK_LOGS, 2);
  h.useLog(fire);
  assert.ok(h.menu(), 'multiple log types offer a selection');
  assert.equal(h.menu().getTitle(), 'What would you like to burn?');
  assert.equal(h.menu().getOptions().mode, 27);
  assert.deepEqual(h.menu().getItems(), [h.I.LOGS, h.I.OAK_LOGS]);
  h.menu().execute(h.I.OAK_LOGS, 1);
  h.tick(8);
  assert.equal(h.inventory.get(h.I.OAK_LOGS), 2, 'no reward before nine ticks');
  h.tick(1);
  assert.equal(h.inventory.get(h.I.OAK_LOGS), 1);
  assert.equal(h.inventory.get(h.I.LOGS), 2);
  assert.equal(h.xp(), 100, '40 for lighting plus 60 for oak tending');
  h.tick(18);
  assert.equal(h.xp(), 100, 'selected amount is honoured');
  assert.equal(h.animations.at(-1), core.Animation.DEFAULT_RESET_ANIMATION.getId());
});

test("tending uses the captured willow animation and tile graphic without extra chat", async t => {
  const h = await campfireHarness(t);
  const fire = h.light();
  h.inventory.delete(h.I.LOGS);
  h.inventory.set(h.I.WILLOW_LOGS, 1);
  h.messages.length = 0;
  h.useLog(fire, h.I.WILLOW_LOGS);
  assert.equal(h.menu(), undefined, 'a single type starts directly');
  assert.equal(h.animations.at(-1), 10572, 'forestry_campfire_burning_willow_logs');
  h.tick(9);
  assert.ok(h.animations.includes(10572));
  assert.equal(h.animations.at(-1), core.Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.equal(h.graphics.length, 1);
  assert.equal(h.graphics[0].graphic.id, 2582);
  assert.ok(h.graphics[0].tile.equals(fire.getLocation()));
  assert.deepEqual(h.messages, []);
  assert.equal(h.xp(), 130, 'full willow XP is granted');
});

test("Check reports remaining burn time through the captured message box", async t => {
  const h = await campfireHarness(t);
  h.useLog(h.light()); h.tick(9);
  const campfire = [...h.objects][0];
  h.messages.length = 0;
  h.hooks["Forester's Campfire"].Check({ player: h.player, object: campfire });
  assert.ok(h.chain(), 'a dialogue is opened');
  assert.equal(h.chain().getDialogues().get(0).getText(), 'The flames flicker gently.');
  assert.deepEqual(h.messages, [], 'no replacement chat message');
  assert.equal(require('../plugins/skills/Firemaking.plugin').isFiremakingActive(h.player), false);
});

test("tending rejects unrelated Cook fires and low levels without consuming logs", async t => {
  const h = await campfireHarness(t);
  const cookFire = new core.GameObject(core.ObjectIdentifiers.FIRE_44, h.loc, 10, 0);
  assert.equal(h.useLog(cookFire).handled, false);
  assert.equal(h.inventory.get(h.I.LOGS), 3);
  const fire = h.light();
  h.player.getSkillManager = () => ({ getCurrentLevel: () => 1 });
  h.inventory.delete(h.I.LOGS);
  h.inventory.set(h.I.OAK_LOGS, 1);
  h.useLog(fire, h.I.OAK_LOGS);
  h.tick(9);
  assert.equal(h.inventory.get(h.I.OAK_LOGS), 1);
  assert.ok(h.messages.includes('You need a Firemaking level of at least 15 to light those logs.'));
});

test("a hit stops the lighting animation a tick before the fire catches (rsprox captures, recording 1035)", async t => {
  const h = await campfireHarness(t);
  h.hooks.combine({ player: h.player, usedItemId: h.I.TINDERBOX, usedWithItemId: h.I.LOGS });
  assert.deepEqual(h.animations, [733]);
  assert.equal(h.inventory.get(h.I.LOGS), 2, 'the log goes on the ground at once');
  h.tick(3);
  assert.equal(h.animations.at(-1), core.Animation.DEFAULT_RESET_ANIMATION.getId());
  assert.equal(h.objects.size, 0);
  h.tick(1);
  assert.equal(h.objects.size, 1, 'the fire on tick 4');
  assert.deepEqual(h.messages, ['You attempt to light the logs.', 'The fire catches and the logs begin to burn.']);
});

test("the player steps off the log with the animation reset, and the fire catches a tick later behind them (rsprox 1035, 1098, 1108)", async t => {
  const h = await campfireHarness(t);
  const steps = [];
  const faces = [];
  let pending = 0;
  // The step stays queued, as for a bot skipped by the process stride; it must not cancel the fire.
  h.player.getMovementQueue = () => ({
    size: () => pending,
    canWalk: (dx, dy) => dx === -1 && dy === 0,
    walkStep: (dx, dy) => { pending++; steps.push({ dx, dy, fires: h.objects.size, anim: h.animations.at(-1) }); },
  });
  h.player.setPositionToFace = target => faces.push({ target, fires: h.objects.size });
  h.hooks.combine({ player: h.player, usedItemId: h.I.TINDERBOX, usedWithItemId: h.I.LOGS });
  h.tick(3);
  assert.deepEqual(steps, [{ dx: -1, dy: 0, fires: 0, anim: core.Animation.DEFAULT_RESET_ANIMATION.getId() }],
    'one step west on the roll tick, with the reset and before the fire');
  assert.deepEqual(faces, [], 'no turn yet');
  h.tick(1);
  assert.equal(h.objects.size, 1, 'the fire catches on the next tick');
  assert.equal(steps.length, 1, 'no second step');
  assert.equal(faces.length, 1, 'the player turns back to the fire with it');
  assert.ok(faces[0].target.equals(h.loc));
  assert.equal(h.messages.at(-1), 'The fire catches and the logs begin to burn.');
});

test("lighting an adjacent ground log uses the player's admitted position", async t => {
  const h = await campfireHarness(t);
  const tile = h.loc.clone().addX(1);
  h.ground.push({ item: new core.Item(h.I.LOGS, 1), loc: tile });
  const event = { player: h.player, groundItemId: h.I.LOGS,
    location: { x: tile.getX(), y: tile.getY(), z: tile.getZ() }, handled: false };
  h.hooks.groundLight(event);
  assert.equal(event.handled, true, "adjacent ground log admitted");
  h.tick(4);
  assert.equal(h.ground.length, 0, "ground log consumed");
  assert.equal(h.objects.size, 1, "fire catches");
  assert.equal(h.xp(), 40);
});

test("Barbarian Firemaking accepts ordinary bows and rejects the Wiki's excluded bows", async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require('../plugins/skills/Firemaking.plugin').register(emptyApi());
  const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
  const { isFiremakingBow } = require("../plugins/skills/Firemaking.plugin");
  assert.equal(isFiremakingBow(I.MAGIC_SHORTBOW), true);
  assert.equal(isFiremakingBow(I.YEW_LONGBOW), true);
  assert.equal(isFiremakingBow(I.TWISTED_BOW), false);
  assert.equal(isFiremakingBow(I.DARK_BOW), false);
  assert.equal(isFiremakingBow(I.CROSSBOW), false);
});


test("bow lighting requires 65 Firemaking for maple logs and retains the bow through completion", async t => {
  const h = await campfireHarness(t);
  let level = 64;
  const skills = h.player.getSkillManager();
  h.player.getSkillManager = () => ({ ...skills, getCurrentLevel: () => level });
  h.inventory.set(h.I.MAPLE_LOGS, 2);
  h.inventory.set(h.I.MAGIC_SHORTBOW, 1);
  const use = () => h.hooks.combine({ player: h.player, usedItemId: h.I.MAGIC_SHORTBOW, usedWithItemId: h.I.MAPLE_LOGS });
  use();
  assert.equal(h.inventory.get(h.I.MAPLE_LOGS), 2, "ordinary maple level is insufficient with a bow");
  assert.match(h.messages.at(-1), /at least 65/);
  level = 65;
  use();
  assert.equal(h.inventory.get(h.I.MAPLE_LOGS), 1);
  h.tick(4);
  assert.equal(h.xp(), 135);
});

test("dropping the bow or losing the boosted bow level cancels a pending fire", async t => {
  const h = await campfireHarness(t);
  let level = 65;
  const skills = h.player.getSkillManager();
  h.player.getSkillManager = () => ({ ...skills, getCurrentLevel: () => level });
  h.inventory.set(h.I.MAPLE_LOGS, 2);
  h.inventory.set(h.I.MAGIC_SHORTBOW, 1);
  h.hooks.combine({ player: h.player, usedItemId: h.I.MAGIC_SHORTBOW, usedWithItemId: h.I.MAPLE_LOGS });
  h.inventory.delete(h.I.MAGIC_SHORTBOW);
  h.tick(4);
  assert.equal(h.xp(), 0);
  assert.equal(h.objects.size, 0);
  h.inventory.set(h.I.MAGIC_SHORTBOW, 1);
  h.hooks.combine({ player: h.player, usedItemId: h.I.MAGIC_SHORTBOW, usedWithItemId: h.I.MAPLE_LOGS });
  level = 64;
  h.tick(4);
  assert.equal(h.xp(), 0);
  assert.equal(h.objects.size, 0);
});


test("bow firemaking stays members-only while ordinary firemaking works on free worlds", async t => {
  const h = await campfireHarness(t);
  t.mock.method(h.core.WorldDefinition, "isMembersWorld", () => false);
  h.inventory.set(h.I.MAGIC_SHORTBOW, 1);
  h.hooks.combine({ player: h.player, usedItemId: h.I.MAGIC_SHORTBOW, usedWithItemId: h.I.LOGS });
  assert.equal(h.inventory.get(h.I.LOGS), 3);
  assert.match(h.messages.at(-1), /members' world/);
  h.light();
  assert.equal(h.xp(), 40);
});

// Real inventory combination and lighting for every firelighter colour.
test("native firelighters coat ordinary logs and light the matching fire on the first attempt", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
  const originalCycle = core.World.getProcessCycle();
  let startupAttempted = false;
  t.after(() => {
    try { if (startupAttempted) PluginManager.emitServerShutdown({}); }
    finally { core.World.processCycle = originalCycle; }
  });
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3226, 3218);
  startupAttempted = true;
  PluginManager.emitServerStartup({});
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "native colour baseline is a members world");
  const I = core.ItemIdentifiers, O = core.ObjectIdentifiers;
  const colours = [
    ["red", I.RED_FIRELIGHTER, I.RED_LOGS, O.FIRE_24, "red_fire"],
    ["green", I.GREEN_FIRELIGHTER, I.GREEN_LOGS, O.FIRE_25, "green_fire"],
    ["blue", I.BLUE_FIRELIGHTER, I.BLUE_LOGS, O.FIRE_26, "blue_fire"],
    ["white", I.WHITE_FIRELIGHTER, I.WHITE_LOGS, O.FIRE_16, "trail_white_fire"],
    ["purple", I.PURPLE_FIRELIGHTER, I.PURPLE_LOGS, O.FIRE_17, "trail_purple_fire"],
  ];
  const locNames = new Gamevals().namesOf(GamevalKind.LOC);
  let index = 1900;
  for (const [colour, lighter, logs, fireId, fireName] of colours) await t.test(colour, async t => {
    assert.equal(core.CacheDefinitions.getItem(lighter).name, `${colour[0].toUpperCase()}${colour.slice(1)} firelighter`);
    assert.equal(core.CacheDefinitions.getItem(logs).name, `${colour[0].toUpperCase()}${colour.slice(1)} logs`);
    assert.equal(core.CacheDefinitions.getItem(I.LOGS).name, "Logs");
    assert.equal(locNames.get(fireId), fireName, "active cache fire colour");
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    let anchor = null, baselineFires = null, ownerName = null, privateArea = null, actorIndex = null;
    const ground = () => ownerName == null ? [] : core.World.getItems().filter(g => !g.isPendingRemoval() &&
      g.getOwner() === ownerName && g.getPrivateArea() === privateArea);
    const fires = () => anchor == null || baselineFires == null ? [] : core.ObjectManager.objectsAt(anchor).filter(o =>
      o.getId() === fireId && o.getPrivateArea() === privateArea && !baselineFires.has(o));
    t.after(() => {
      const errors = [];
      const clean = fn => { try { fn(); } catch (error) { errors.push(error); } };
      if (ownerName != null) {
        clean(() => PluginManager.emitPlayerDisconnect({ player: p, username: ownerName }));
        clean(() => PluginManager.emitPlayerLogout({ player: p, username: ownerName }));
      }
      clean(() => p.setRegistered(false));
      if (actorIndex != null) clean(() => core.TaskManager.cancelTasks(actorIndex));
      clean(() => core.TaskManager.cancelTasks(p));
      clean(() => core.GameConstants.PLAYER_PERSISTENCE?.cancelRequestedSave(p));
      clean(() => core.World.unregisterPlayerPosition(p));
      if (anchor) clean(() => core.World.unregisterPlayerPosition(p, anchor));
      let ownedGround = [], ownedFires = [];
      clean(() => { ownedGround = ground(); });
      clean(() => { ownedFires = fires(); });
      for (const g of ownedGround) clean(() => core.ItemOnGroundManager.deregister(g));
      for (const o of ownedFires) clean(() => core.ObjectManager.deregister(o, true));
      clean(() => assert.equal(ground().length, 0, "owned ground items removed"));
      clean(() => assert.equal(fires().length, 0, "owned fire removed"));
      clean(() => assert.equal(core.TaskManager.hasActiveTask(p), false));
      if (actorIndex != null) clean(() => assert.equal(core.TaskManager.hasActiveTask(actorIndex), false));
      if (errors.length) throw new AggregateError(errors, "colour fixture cleanup failed");
    });
    actorIndex = index++; p.setIndex(actorIndex); const name = `colour${index}`;
    p.setUsername(name); ownerName = name; p.setLongUsername(core.Misc.stringToLongBigInt(name));
    p.setAttribute("bot-skip-persistence", true); p.setRegistered(true);
    p.setLocation(new core.Location(3226, 3218, 0)); p.needsPlacement = false;
    p.getSkillManager().setExperience(core.Skill.FIREMAKING, 0);
    p.getSkillManager().setMaxLevel(core.Skill.FIREMAKING, 1);
    p.getSkillManager().setCurrentLevel(core.Skill.FIREMAKING, 1, false);
    p.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 10); p.setHitpoints(10);
    assert.ok(p.getLongUsername() > 0n); assert.equal(p.getHitpoints(), 10);
    assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.FIREMAKING), 1);
    const c = new ClientConnection(channel); c.player = p;
    anchor = p.getLocation().clone(); privateArea = p.getPrivateArea();
    baselineFires = new Set(core.ObjectManager.objectsAt(anchor));
    for (const id of [I.LOGS, I.OAK_LOGS, lighter, I.TINDERBOX]) p.getInventory().add(new core.Item(id, 1), false);
    const gains = [], skills = p.getSkillManager(), add = skills.addExperiences.bind(skills);
    t.mock.method(skills, "addExperiences", (skill, xp) => {
      if (skill === core.Skill.FIREMAKING) gains.push(xp);
      return add(skill, xp);
    });
    const use = async (a, b) => c.dispatch([{ type: "inventory_use_on", itemId: a,
      slot: p.getInventory().getSlotForItemId(a), target: { kind: "inventory", id: b,
        slot: p.getInventory().getSlotForItemId(b) } }]);
    const turn = () => {
      p.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); c.processTurnPackets();
      const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
      if (q.hasPendingWork()) q.process(); core.TaskManager.processWalkTo(p.getIndex());
    };
    assert.equal(p.getInventory().getAmount(I.LOGS), 1);
    assert.equal(p.getInventory().getAmount(lighter), 1);
    assert.equal(p.getInventory().getAmount(logs), 0);
    assert.equal(fires().length, 0);
    if (colour === "red") {
      const freeWorld = t.mock.method(core.WorldDefinition, "isMembersWorld", () => false);
      await use(lighter, I.LOGS); turn();
      assert.equal(p.getInventory().getAmount(I.LOGS), 1);
      assert.equal(p.getInventory().getAmount(lighter), 1);
      assert.equal(p.getInventory().getAmount(logs), 0);
      freeWorld.mock.restore();
      // Seeded metadata boundary: a clicked restricted copy must not consume an earlier plain copy.
      const restricted = new core.Item(I.LOGS, 1).setMetaValue(core.Item.UNTRADEABLE_META, true);
      const restrictedSlot = p.getInventory().getItems().findIndex(item => item.getId() < 0);
      p.getInventory().setItem(restrictedSlot, restricted);
      await c.dispatch([{ type: "inventory_use_on", itemId: lighter,
        slot: p.getInventory().getSlotForItemId(lighter), target: { kind: "inventory", id: I.LOGS, slot: restrictedSlot } }]);
      turn();
      assert.equal(p.getInventory().getAmount(I.LOGS), 2);
      assert.equal(p.getInventory().getItems()[restrictedSlot], restricted);
      assert.equal(p.getInventory().getAmount(lighter), 1);
      assert.equal(p.getInventory().getAmount(logs), 0);
      p.getInventory().deleteAtSlot(restrictedSlot, 1);
    }
    await use(lighter, I.OAK_LOGS); turn();
    assert.equal(p.getInventory().getAmount(I.OAK_LOGS), 1);
    assert.equal(p.getInventory().getAmount(lighter), 1);
    assert.equal(p.getInventory().getAmount(logs), 0);
    await (colour === "green" ? use(I.LOGS, lighter) : use(lighter, I.LOGS)); turn();
    assert.equal(p.getInventory().getAmount(I.LOGS), 0);
    assert.equal(p.getInventory().getAmount(lighter), 0);
    assert.equal(p.getInventory().getAmount(logs), 1);
    assert.deepEqual(gains, []);
    await use(I.TINDERBOX, logs); turn();
    assert.equal(p.getInventory().getAmount(logs), 0);
    assert.equal(ground().filter(g => g.getItem().getId() === logs).length, 1);
    // A normal level-1 roll would fail at this value; coloured logs must catch first time.
    const originalRandom = Math.random;
    t.mock.method(Math, "random", () => new Error().stack.includes("rollLightingSuccess") ? 0.99 : originalRandom());
    for (let n = 0; n < 5; n++) turn();
    assert.equal(ground().filter(g => g.getItem().getId() === logs).length, 0);
    assert.equal(fires().length, 1);
    assert.equal(p.getInventory().getAmount(I.TINDERBOX), 1);
    assert.deepEqual(gains, [50]);
  });
});

// Exercise a native manual walk and the automatic step after a successful roll.
test("native manual walk cancels lighting before the roll while automatic success step still commits", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3226, 3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  const I = core.ItemIdentifiers;
  const fireId = core.ObjectIdentifiers.FIRE_23;
  let index = 1840;
  for (const mode of ["normal-auto-step", "manual-before-roll"]) await t.test(mode, async t => {
    const channel = {
      kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
      close() {}, onData() {}, onError() {}, onClose() {},
    };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index++);
    p.setUsername("firewalk" + index);
    p.setRegistered(true);
    p.setLocation(new core.Location(3226, 3218, 0));
    p.needsPlacement = false;
    p.getSkillManager().setCurrentLevel(core.Skill.FIREMAKING, 99, false);
    const c = new ClientConnection(channel);
    c.player = p;
    const anchor = p.getLocation().clone();
    const gains = [];
    const animations = [];
    const ownedGround = () => core.World.getItems().filter(g =>
      !g.isPendingRemoval() && g.getOwner() === p.getUsername() && g.getPrivateArea() === p.getPrivateArea());
    const total = id => p.getInventory().getAmount(id) + ownedGround()
      .filter(g => g.getItem().getId() === id).reduce((n, g) => n + g.getItem().getAmount(), 0);
    const fires = () => core.ObjectManager.objectsAt(anchor)
      .filter(o => o.getId() === fireId && o.getPrivateArea() === p.getPrivateArea());
    t.after(() => {
      PluginManager.emitPlayerDisconnect({ player: p, username: p.getUsername() });
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      p.setRegistered(false);
      core.TaskManager.cancelTasks(p.getIndex());
      core.TaskManager.cancelTasks(p);
      for (const g of ownedGround()) core.ItemOnGroundManager.deregister(g);
      for (const o of fires()) core.ObjectManager.deregister(o, true);
    });
    for (const id of [I.LOGS, I.TINDERBOX]) p.getInventory().add(new core.Item(id, 1), false);
    const skills = p.getSkillManager();
    const add = skills.addExperiences.bind(skills);
    t.mock.method(skills, "addExperiences", (skill, xp) => {
      if (skill === core.Skill.FIREMAKING) gains.push(xp);
      return add(skill, xp);
    });
    const animate = p.performAnimation.bind(p);
    t.mock.method(p, "performAnimation", animation => {
      const result = animate(animation);
      animations.push({ id: animation?.getId(), accepted: p.getAnimation() === animation });
      return result;
    });
    let turns = 0;
    const snapshot = label => {
      const q = p.getMovementQueue();
      return {
        mode, label, turns, epoch: core.World.getProcessCycle(),
        position: [p.getLocation().getX(), p.getLocation().getY()],
        queue: q.size(), didMove: q.didMoveThisCycle(), stall: p.getCombat().getAnimationStallTicks(),
        active: Firemaking.isFiremakingActive(p), inventoryLogs: p.getInventory().getAmount(I.LOGS),
        allLogs: total(I.LOGS), tinderbox: total(I.TINDERBOX), fires: fires().length, gains: [...gains],
      };
    };
    const turn = () => {
      assert.ok(++turns <= 16, "bounded phase budget");
      p.resetUpdating();
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process();
      c.processTurnPackets();
      const q = p.getMovementQueue();
      q.beginCycle();
      q.processEntityPursuit();
      if (q.hasPendingWork()) q.process();
      core.TaskManager.processWalkTo(p.getIndex());
    };
    assert.equal(fires().length, 0);
    assert.equal(total(I.LOGS), 1);
    await c.dispatch([{
      type: "inventory_use_on", itemId: I.TINDERBOX, slot: p.getInventory().getSlotForItemId(I.TINDERBOX),
      target: { kind: "inventory", id: I.LOGS, slot: p.getInventory().getSlotForItemId(I.LOGS) },
    }]);
    turn();
    assert.equal(Firemaking.isFiremakingActive(p), true, "native item combination admitted lighting");
    assert.ok(animations.some(a => a.id === 733 && a.accepted), "actual opening animation accepted");
    assert.equal(p.getInventory().getAmount(I.LOGS), 0);
    assert.equal(total(I.LOGS), 1, "owned ground intermediate");
    assert.equal(fires().length, 0);
    assert.deepEqual(gains, []);
    assert.equal(p.getCombat().isAnimationStalled(), false);
    if (mode === "manual-before-roll") {
      await c.dispatch([{ type: "move", worldX: 3225, worldY: 3217, modifierFlags: 0, run: false }]);
      turn();
      assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3225, 3217]);
      assert.equal(p.getMovementQueue().size(), 0);
      assert.equal(p.getMovementQueue().didMoveThisCycle(), true);
      assert.equal(fires().length, 0);
      assert.deepEqual(gains, []);
      assert.equal(total(I.LOGS), 1);
    }
    for (let n = 0; n < 6; n++) turn();
    const end = snapshot("completion-window");
    const cancelled = mode === "manual-before-roll";
    assert.deepEqual(gains, cancelled ? [] : [40], "pending firemaking XP after manual walk: " + JSON.stringify(end));
    assert.equal(total(I.LOGS), cancelled ? 1 : 0);
    assert.equal(total(I.TINDERBOX), 1);
    assert.equal(fires().length, cancelled ? 0 : 1);
    assert.equal(Firemaking.isFiremakingActive(p), false);
    if (!cancelled) assert.equal(p.getLocation().equals(anchor), false, "genuine automatic step must remain a successful control");
  });
});

// Otto's first Firemaking lesson. Registered NPC options, native dialogue and inventory
// packets, real Logs tasks/events and the production save codec; no direct lesson hook.
// Skills/items are seeded and Otto is owner-only at his source spawn. The same player
// is placed at the existing native fire-test scene for each exercise and returned for
// dialogue; this is a scene adapter, not natural travel or a retail distance assertion.
// Fires are removed between exercises. The codec round-trip is not a socket login.
test("Otto teaches bow firemaking and remembers an owned oak exercise through save and return", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { SkillManager } = require("../dist/game/content/skill/SkillManager");
  const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
  const { ATTR_SKIP_PERSISTENCE } = require("../plugins/bots/runtime/PersistenceConstants.PlayerBots");
  const I = core.ItemIdentifiers, K = core.Skill, KEY = "barbarian-training";
  const LESSON = "I'm ready for your firemaking wisdom. Please instruct me.";
  const RETURN = "I've set fire to logs with a bow!";
  const MORE = "I seek more knowledge.";
  const actors = [], ownedTasks = new Set(), createdFires = new Set(), fireSites = [], observed = [];
  const oldCycle = core.World.processCycle, submit = core.TaskManager.submit;
  const source = require("../data/definitions/npc-spawns.json").find(row =>
    row.name === "Otto Godblessed" && row.id === core.NpcIdentifiers.OTTO_GODBLESSED);
  const level = f => f.player.getAttribute(KEY)?.firemaking ?? 0;
  const ground = f => !f.player?.getUsername() ? [] : core.World.getItems().filter(g => !g.isPendingRemoval()
    && g.getOwner() === f.player.getUsername() && g.getPrivateArea() === f.player.getPrivateArea());
  const collectFires = () => {
    for (const site of fireSites) for (const object of core.ObjectManager.objectsAt(site.location)) {
      if (!site.before.has(object) && object.getId() === core.ObjectIdentifiers.FIRE_23
        && object.getPrivateArea() === site.area) createdFires.add(object);
    }
  };
  const observer = event => observed.push({ player: event.player, itemId: event.itemId,
    bow: event.bow, lesson: level({ player: event.player }) });
  let observerRegistered = false, submitOverridden = false;
  t.after(() => {
    let failure;
    const clean = fn => { try { fn(); } catch (error) { failure ??= error; } };
    try {
      for (const f of actors) {
        if (!f.player) continue;
        clean(() => f.player.closeInterruptibleInterfaces());
        clean(() => PluginManager.emitPlayerDisconnect({ player: f.player, username: f.player.getUsername() }));
        clean(() => PluginManager.emitPlayerLogout({ player: f.player, username: f.player.getUsername() }));
        clean(() => core.GameConstants.PLAYER_PERSISTENCE.cancelRequestedSave(f.player));
        clean(() => {
          core.TaskManager.cancelTasks(f.player);
          if (f.player.getIndex() > 0) core.TaskManager.cancelTasks(f.player.getIndex());
        });
        clean(() => { for (const g of ground(f)) core.ItemOnGroundManager.deregister(g); });
        clean(() => {
          if (!f.npc) return;
          core.TaskManager.cancelTasks(f.npc);
          const local = f.player.getLocalNpcs(), index = local.indexOf(f.npc);
          if (index >= 0) local.splice(index, 1);
          PluginManager.removeNpc(f.npc);
        });
        clean(() => core.World.unregisterPlayerPosition(f.player));
        for (const location of [f.anchor, f.fireAnchor]) {
          if (location) clean(() => core.World.unregisterPlayerPosition(f.player, location));
        }
        clean(() => f.player.setRegistered(false));
      }
      for (const task of ownedTasks) clean(() => { if (task.isRunning()) core.Task.prototype.stop.call(task); });
      clean(collectFires);
      for (const fire of createdFires) clean(() => core.ObjectManager.deregister(fire, true));
      if (observerRegistered) clean(() => {
        const hooks = PluginManager.customEventHooks.get("firemaking:success");
        const index = hooks?.findIndex(hook => hook.handler === observer) ?? -1;
        assert.ok(index >= 0, "the fixture observer is registered before its cleanup");
        hooks.splice(index, 1);
        assert.ok(!hooks.some(hook => hook.handler === observer), "the fixture observer is removed");
      });
      for (const f of actors) {
        if (!f.player) continue;
        clean(() => assert.equal(f.player.isRegistered(), false));
        if (f.npc) {
          clean(() => assert.equal(f.npc.isRegistered(), false));
          clean(() => assert.ok(!core.World.getAddNPCQueue().includes(f.npc)));
          clean(() => assert.ok(!f.player.getLocalNpcs().includes(f.npc)));
        }
        clean(() => assert.equal(ground(f).length, 0, "no fixture-owned ground item remains"));
        clean(() => assert.equal(core.TaskManager.hasActiveTask(f.player), false));
        if (f.player.getIndex() > 0) clean(() => assert.equal(core.TaskManager.hasActiveTask(f.player.getIndex()), false));
      }
      clean(() => assert.ok([...ownedTasks].every(task => !task.isRunning()), "fixture-owned tasks stopped"));
      for (const fire of createdFires) clean(() => assert.ok(!core.ObjectManager.objectsAt(fire.getLocation()).includes(fire)));
    } finally {
      if (submitOverridden) core.TaskManager.submit = submit;
      core.World.processCycle = oldCycle;
      clean(() => PluginManager.emitServerShutdown({}));
    }
    if (failure) throw failure;
  });
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init();
  PluginManager.emitServerStartup({});
  PluginManager.createApi("OttoFiremakingFixture").onCustomEvent("firemaking:success", observer);
  observerRegistered = true;
  core.TaskManager.submit = function(task) {
    if (actors.some(f => f.player && (task.key === f.player || task.key === f.player.getIndex()
      || task.key?.getOwner?.() === f.player || task.npc?.getOwner?.() === f.player))
      || String(new Error().stack).includes("Logs.Firemaking.js")) ownedTasks.add(task);
    return submit.call(this, task);
  };
  submitOverridden = true;
  assert.ok(source, "Otto's named spawn agrees with the active NPC identifier");
  assert.equal(core.WorldDefinition.isMembersWorld(), true, "the lesson exercise uses a members world");
  function actor() {
    const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const player = new Player(new PlayerSession(channel));
    const f = { player, npc: null, connection: null, anchor: null, fireAnchor: null, messages: [] };
    actors.push(f); // Own the player before registration, map loading or any assertion can fail.
    player.setIndex(1799 + actors.length);
    const username = `ottofm${player.getIndex()}`;
    player.setUsername(username); player.setLongUsername(core.Misc.stringToLongBigInt(username));
    const sendMessage = player.sendMessage.bind(player);
    t.mock.method(player, "sendMessage", message => {
      f.messages.push(String(message));
      return sendMessage(message);
    });
    assert.ok(player.getLongUsername() !== 0n && player.getIndex() < core.World.MAX_PLAYERS);
    player.setAttribute(ATTR_SKIP_PERSISTENCE, true); player.setRegistered(true);
    const skills = player.getSkillManager();
    for (const [skill, value] of [[K.FIREMAKING, 99], [K.HITPOINTS, 10]]) {
      const xp = SkillManager.getExperienceForLevel(value);
      skills.setExperiences(skill, xp, false).setMaxLevels(skill, value, false).setCurrentLevel(skill, value, false);
      assert.equal(skills.getExperience(skill), xp); assert.equal(skills.getMaxLevel(skill), value);
      assert.equal(skills.getCurrentLevel(skill), value);
    }
    core.RegionManager.loadMapFiles(source.x, source.y);
    // This anchor qualifies Talk-to placement, not firemaking inside Otto's hut.
    const offset = [[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy]) =>
      core.RegionManager.canMove(source.x, source.y, source.x+dx, source.y+dy, 0, 1, 1, null)
      && core.RegionManager.canMove(source.x+dx, source.y+dy, source.x, source.y, 0, 1, 1, null));
    assert.ok(offset, "canonical Otto tile has a reachable adjacent dialogue tile");
    player.setLocation(new core.Location(source.x+offset[0], source.y+offset[1], source.level ?? 0));
    f.anchor = player.getLocation().clone();
    // Reuse the scene exercised by the existing native manual-walk test above.
    f.fireAnchor = new core.Location(3226, 3218, 0);
    player.setNeedsPlacement(false);
    const connection = new ClientConnection(channel); connection.player = player;
    f.npc = PluginManager.spawnNpc({ id: source.id, x: source.x, y: source.y, z: source.level ?? 0,
      wanderRadius: 0, owner: player, ownerOnly: true }, "OttoFiremakingFixture");
    const npc = f.npc;
    assert.ok(npc && npc.isRegistered()); assert.equal(npc.getOwner(), player);
    npc.setNeedsPlacement(false); player.getLocalNpcs().push(npc);
    assert.equal(npc.getCurrentDefinition(player).getName(), "Otto Godblessed");
    f.connection = connection; return f;
  }
  function turn(f) {
    f.player.resetUpdating(); core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
    core.TaskManager.process(); f.connection.processTurnPackets();
    const queue = f.player.getMovementQueue(); queue.beginCycle(); queue.processEntityPursuit();
    if (queue.hasPendingWork()) queue.process(); core.TaskManager.processWalkTo(f.player.getIndex());
  }
  async function menu(f) {
    const manager = f.player.getDialogueManager();
    for (let n = 0; n < 40; n++) {
      const current = manager.getCurrent();
      if (!current || current instanceof core.OptionDialogue) return current;
      const group = f.player.getPacketSender().getChatboxGroupId();
      await f.connection.dispatch([{ type: "dialogue_continue", widgetId: (group << 16) | 5, childIndex: -1 }]);
      f.connection.processTurnPackets();
    }
    assert.fail("bounded Otto dialogue did not reach a native choice or close");
  }
  async function choose(f, shown, text) {
    assert.equal(f.player.getDialogueManager().getCurrent(), shown, "the observed native choice still owns the selection");
    assert.ok(shown instanceof core.OptionDialogue);
    assert.equal(f.player.getPacketSender().isChatboxInterface(219), true);
    const childIndex = shown.getOptions().indexOf(text) + 1;
    assert.ok(childIndex > 0, `native Otto menu contains ${text}`);
    await f.connection.dispatch([{ type: "dialogue_continue", widgetId: core.OptionDialogue.OPTIONS_WIDGET_ID, childIndex }]);
    f.connection.processTurnPackets();
  }
  async function talk(f) {
    f.player.closeInterruptibleInterfaces();
    f.player.getMovementQueue().reset(); f.player.setLocation(f.anchor.clone());
    const clickType = f.npc.getCurrentDefinition(f.player).getActions().indexOf("Talk-to") + 1;
    assert.ok(clickType > 0, "the active Otto definition offers Talk-to");
    await f.connection.dispatch([{ type: "npc_option", index: f.npc.getIndex(), clickType }]);
    for (let n=0; n<4; n++) turn(f);
    const shown = await menu(f);
    assert.ok(shown instanceof core.OptionDialogue, "registered Otto Talk-to reaches its actual native menu");
    return shown;
  }
  async function learn(f) {
    const shown = await talk(f);
    assert.ok(shown.getOptions().includes(LESSON), "ordinary Otto entry offers the missing Firemaking instruction");
    await choose(f, shown, LESSON);
    const after = await menu(f);
    assert.ok(after?.getOptions().includes(MORE), "actual instruction finishes at the supported continuation menu");
    assert.equal(level(f), 1);
    f.player.closeInterruptibleInterfaces();
  }
  async function fire(f, logId, bow) {
    f.player.closeInterruptibleInterfaces();
    assert.equal(Firemaking.isFiremakingActive(f.player), false, "the previous exercise has settled before scene placement");
    f.player.getMovementQueue().reset();
    core.RegionManager.loadMapFiles(f.fireAnchor.getX(), f.fireAnchor.getY());
    f.player.setLocation(f.fireAnchor.clone());
    const inv = f.player.getInventory(), tool = bow ? I.SHORTBOW : I.TINDERBOX;
    for (const id of [I.LOGS, I.OAK_LOGS, I.SHORTBOW, I.TINDERBOX]) inv.deleteNumber(id, inv.getAmount(id));
    for (const id of [tool, logId]) {
      assert.ok(id > 0); assert.equal(core.ItemDefinition.forId(id).isNoted(), false);
      assert.equal(core.CacheDefinitions.getItem(id).placeholderTemplate, -1);
      inv.add(new core.Item(id, 1), false);
    }
    const anchor = f.player.getLocation().clone();
    assert.equal(Firemaking.isFireTileBlocked(anchor, f.player.getPrivateArea()), false,
      "the exercise starts on a fire-clear tile without bypassing production admission");
    fireSites.push({ location: anchor, area: f.player.getPrivateArea(),
      before: new Set(core.ObjectManager.objectsAt(anchor)) });
    assert.equal(core.ObjectManager.objectsAt(anchor).filter(o => o.getId() === core.ObjectIdentifiers.FIRE_23).length, 0);
    const first = observed.length, messageStart = f.messages.length;
    const snapshot = phase => ({
      phase, logId, bow, cycle: core.World.getProcessCycle(),
      position: [f.player.getLocation().getX(), f.player.getLocation().getY(), f.player.getLocation().getZ()],
      active: Firemaking.isFiremakingActive(f.player), queue: f.player.getMovementQueue().size(),
      stall: f.player.getCombat().getAnimationStallTicks(),
      currentLevel: f.player.getSkillManager().getCurrentLevel(K.FIREMAKING),
      inventoryLogs: inv.getAmount(logId), inventoryTool: inv.getAmount(tool),
      groundLogs: ground(f).filter(g => g.getItem().getId() === logId).length,
      messages: f.messages.slice(messageStart).slice(-8),
      tasks: [...ownedTasks].map(task => ({ name: task.constructor.name, running: task.isRunning() })),
    });
    if (bow) assert.equal(Firemaking.isFiremakingBow(tool), true, "the active item definition is a supported bow");
    assert.ok(Firemaking.LIGHTABLE_LOGS_BY_ID.has(logId), "the active registered log table contains this input");
    await f.connection.dispatch([{ type: "inventory_use_on", itemId: tool, slot: inv.getSlotForItemId(tool),
      target: { kind: "inventory", id: logId, slot: inv.getSlotForItemId(logId) } }]);
    turn(f);
    assert.equal(Firemaking.isFiremakingActive(f.player), true,
      "native item combination admits lighting: " + JSON.stringify(snapshot("admission")));
    for (let n=1; n<30; n++) {
      turn(f);
      if (observed.length > first && !Firemaking.isFiremakingActive(f.player)) break;
    }
    collectFires(); // Also collected unconditionally in teardown if an earlier turn/assertion fails.
    const event = observed.slice(first).find(e => e.player === f.player);
    assert.ok(event, "the real registered Logs task emits a successful fire event: " + JSON.stringify(snapshot("completion")));
    assert.equal(event.itemId, logId); assert.equal(event.bow, bow);
    const fires = core.ObjectManager.objectsAt(anchor).filter(o => o.getId() === core.ObjectIdentifiers.FIRE_23
      && o.getPrivateArea() === f.player.getPrivateArea());
    assert.equal(fires.length, 1, "the actual skill action creates its fire");
    for (const o of fires) { createdFires.add(o); core.ObjectManager.deregister(o, true); }
    // Keep production tasks alive across exercises; the guaranteed teardown owns their cleanup.
    for (const g of ground(f)) core.ItemOnGroundManager.deregister(g);
    return event;
  }
  function saveAndRestore(f, expected) {
    const codec = new Json.JsonPlayerPersistence();
    const old = f.player.getAttribute(KEY);
    const record = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
    assert.equal(record.attributes[KEY].firemaking, expected, "production save includes earned lesson progress");
    f.player.setAttribute(KEY, { fishingRod: 0, herblore: 0, firemaking: 0 });
    codec.hydratePlayerSave(record).applyToPlayer(f.player);
    f.player.setAttribute(ATTR_SKIP_PERSISTENCE, true); f.player.setNeedsPlacement(false);
    assert.notEqual(f.player.getAttribute(KEY), old, "load reconstructs state rather than retaining the live object");
    assert.equal(level(f), expected);
  }

  const f = actor();
  assert.equal((await fire(f, I.LOGS, false)).lesson, 0, "ordinary tinderbox control works before the new lesson");
  assert.equal((await fire(f, I.OAK_LOGS, true)).lesson, 0, "an untrained bow fire stays allowed but does not credit training");
  const ordinary = await talk(f);
  assert.ok(ordinary.getOptions().includes("What can I learn about the use of a fishing rod?"));
  assert.ok(ordinary.getOptions().includes("How can I use my strength in the ways of agriculture?"));
  await choose(f, ordinary, "I'd better get going."); await menu(f);
  await learn(f); // Missing-content BEFORE stops here; later acceptance is explicitly unreached.
  await learn(f); // Repeating instruction does not reset or grant additional progress.
  saveAndRestore(f, 1);
  assert.equal((await fire(f, I.LOGS, true)).lesson, 1, "a non-oak bow fire cannot complete the oak exercise");
  assert.equal((await fire(f, I.OAK_LOGS, false)).lesson, 1, "a tinderbox oak fire cannot complete the bow exercise");
  assert.ok(!(await talk(f)).getOptions().includes(RETURN), "return acknowledgement is unavailable before the exercise");
  const other = actor(); await learn(other);
  assert.equal((await fire(other, I.OAK_LOGS, true)).lesson, 2);
  assert.equal(level(f), 1, "another taught player's real oak exercise is not this player's progress");
  assert.equal((await fire(f, I.OAK_LOGS, true)).lesson, 2);
  assert.equal((await fire(f, I.OAK_LOGS, true)).lesson, 2, "repeated success does not acknowledge the lesson");
  saveAndRestore(f, 2);
  const returning = await talk(f); await choose(f, returning, RETURN); await menu(f);
  assert.equal(level(f), 3);
  assert.ok(!(await talk(f)).getOptions().includes(RETURN), "acknowledgement is not offered a second time");
  saveAndRestore(f, 3);
  assert.equal(f.player.getAttribute(KEY).fishingRod, 0);
  assert.equal(f.player.getAttribute(KEY).herblore, 0, "the Firemaking lesson does not require or complete either older section");
  const cancelled = actor(), initial = await talk(cancelled);
  await choose(cancelled, initial, LESSON); cancelled.player.closeInterruptibleInterfaces();
  assert.equal(level(cancelled), 0, "closing the instruction before its spoken end does not mark it taught");
});

// Inventory actions hard-interrupt interactions (osrs-docs Entity Interactions).
// The ordinary item-use/Food consumers and task/movement phases are real; skills,
// supplies and placement are seeded, the socket is inert, and world
// phases are driven manually. This is neither acquisition nor a full World run.
test("ordinary inventory Eat cancels pending lighting without stopping another player's fire", async t => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  const { Player } = require("../dist/game/entity/impl/player/Player");
  const { PlayerSession } = require("../dist/net/PlayerSession");
  const { ClientConnection } = require("../dist/net/NetworkBuilder");
  const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3226, 3218);
  PluginManager.emitServerStartup({});
  t.after(() => PluginManager.emitServerShutdown({}));
  const Firemaking = require("../plugins/skills/Firemaking.plugin");
  const I = core.ItemIdentifiers, fireId = core.ObjectIdentifiers.FIRE_23;
  let nextIndex = 1920;
  for (const route of ["uninterrupted", "inventory Eat", "widget Eat", "Examine"]) {
    await t.test(route, async t => {
      const accounts = [];
      t.after(() => {
        for (const f of accounts) {
          if (f.p.isRegistered()) {
            PluginManager.emitPlayerDisconnect({ player: f.p, username: f.p.getUsername() });
            PluginManager.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
          }
          core.World.unregisterPlayerPosition(f.p);
          f.p.setRegistered(false); core.TaskManager.cancelTasks(f.p); core.TaskManager.cancelTasks(f.p.getIndex());
          for (const g of f.ground?.() ?? []) core.ItemOnGroundManager.deregister(g);
          for (const o of f.fires?.() ?? []) core.ObjectManager.deregister(o, true);
        }
      });
      function account(x, y) {
        const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
          send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
        const p = new Player(new PlayerSession(channel));
        p.setIndex(nextIndex++); p.setUsername("fmitem" + p.getIndex());
        const f = { p }; accounts.push(f);
        p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
        p.setAttribute("bot-skip-persistence", true); p.setRegistered(true);
        p.setLocation(new core.Location(x, y, 0)); p.needsPlacement = false;
        const anchor = p.getLocation().clone(), skills = p.getSkillManager();
        skills.setExperience(core.Skill.FIREMAKING, 13034431);
        skills.setMaxLevel(core.Skill.FIREMAKING, 99);
        skills.setCurrentLevel(core.Skill.FIREMAKING, 99, false);
        skills.setMaxLevel(core.Skill.HITPOINTS, 10); p.setHitpoints(5);
        assert.ok(p.getLongUsername() > 0n);
        assert.equal(p.getHitpoints(), 5);
        assert.equal(p.getPrivateArea(), null);
        assert.equal(Firemaking.isFireTileBlocked(anchor, null), false, "setup: ordinary tile admits a fire");
        const c = new ClientConnection(channel); c.player = p;
        const gains = [], messages = [];
        const add = skills.addExperiences.bind(skills), message = p.sendMessage.bind(p);
        t.mock.method(skills, "addExperiences", (skill, xp) => {
          if (skill === core.Skill.FIREMAKING) gains.push(xp);
          return add(skill, xp);
        });
        t.mock.method(p, "sendMessage", text => { messages.push(text); return message(text); });
        for (const id of [I.TINDERBOX, I.LOGS, I.SHARK]) p.getInventory().add(new core.Item(id, 1), false);
        const ground = () => core.World.getItems().filter(g => !g.isPendingRemoval()
          && g.getOwner() === p.getUsername() && g.getPrivateArea() === null);
        const fires = () => core.ObjectManager.objectsAt(anchor)
          .filter(o => o.getId() === fireId && o.getPrivateArea() === null);
        assert.equal(fires().length, 0);
        Object.assign(f, { c, anchor, gains, messages, ground, fires }); return f;
      }
      const actor = account(3226, 3218), other = account(3225, 3217);
      assert.notEqual(actor.p.getLongUsername(), other.p.getLongUsername());
      let turns = 0;
      const turn = () => {
        assert.ok(++turns <= 32, "bounded actual task/movement phases");
        for (const { p } of accounts) p.resetUpdating();
        core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
        core.TaskManager.process();
        for (const { p, c } of accounts) {
          c.processTurnPackets();
          const q = p.getMovementQueue(); q.beginCycle(); q.processEntityPursuit();
          if (q.hasPendingWork()) q.process();
          core.TaskManager.processWalkTo(p.getIndex());
        }
      };
      const send = async (f, packet) => { await f.c.dispatch([packet]); turn(); };
      const decodeAndSend = async (f, bytes, expected) => {
        const packets = decodeClientPackets(bytes); assert.deepEqual(packets, [expected]);
        await send(f, packets[0]);
      };
      async function start(f) {
        const slot = f.p.getInventory().getSlotForItemId(I.TINDERBOX);
        const logSlot = f.p.getInventory().getSlotForItemId(I.LOGS);
        const body = Buffer.alloc(13); body.writeUInt16BE(slot, 0); body.writeUInt16BE(I.TINDERBOX, 2);
        body[4] = 4; body.writeUInt16BE(logSlot, 9); body.writeUInt16BE(I.LOGS, 11);
        await decodeAndSend(f, Buffer.concat([Buffer.from([241, body.length]), body]), {
          type: "inventory_use_on", slot, itemId: I.TINDERBOX,
          target: { kind: "inventory", slot: logSlot, itemId: I.LOGS },
        });
        assert.equal(Firemaking.isFiremakingActive(f.p), true, "real registered ordinary admission");
        assert.equal(f.p.getInventory().getAmount(I.LOGS), 0);
        assert.equal(f.ground().filter(g => g.getItem().getId() === I.LOGS).length, 1);
        assert.equal(f.fires().length, 0); assert.deepEqual(f.gains, []);
      }
      await start(actor); await start(other);
      const pile = actor.ground().find(g => g.getItem().getId() === I.LOGS);
      assert.equal(pile.getItem().getAmount(), 1);
      assert.equal(actor.p.getLocation().equals(actor.anchor), true, "still before successful step/commit");
      assert.equal(actor.p.getCombat().isAnimationStalled(), false, "ordinary Eat is not animation-stalled");
      const interrupted = route === "inventory Eat" || route === "widget Eat";
      if (interrupted) {
        const slot = actor.p.getInventory().getSlotForItemId(I.SHARK), hp = actor.p.getHitpoints();
        if (route === "inventory Eat") {
          await send(actor, { type: "inventory_action", widgetId: 3214, itemId: I.SHARK, slot, option: "Eat" });
        } else {
          const frame = Buffer.alloc(9); frame[0] = 25;
          frame.writeInt32BE(149 << 16, 1); frame.writeUInt16BE(slot, 5); frame.writeUInt16BE(I.SHARK, 7);
          await decodeAndSend(actor, frame, { type: "widget_action", widgetId: 149 << 16,
            groupId: 149, childId: 0, buttonNum: 2, slot, itemId: I.SHARK });
        }
        assert.equal(actor.p.getInventory().getAmount(I.SHARK), 0, "real Food accepts the inventory action");
        assert.ok(actor.p.getHitpoints() > hp, "accepted Eat heals this actor");
        assert.ok(actor.messages.includes("You eat the shark."));
      } else if (route === "Examine") {
        await send(actor, { type: "inventory_action", widgetId: 3214, itemId: I.TINDERBOX,
          slot: actor.p.getInventory().getSlotForItemId(I.TINDERBOX), option: "Examine" });
        assert.ok(actor.messages.length > 0, "ordinary Examine returns a description");
      } else turn();
      for (let tick = 0; tick < 8; tick++) turn();
      assert.deepEqual(other.gains, [40], "other actor's ordinary fire commits despite this actor's action");
      assert.equal(other.fires().length, 1);
      assert.equal(other.ground().filter(g => g.getItem().getId() === I.LOGS).length, 0);
      assert.equal(other.p.getInventory().getAmount(I.TINDERBOX), 1);
      assert.equal(other.p.getInventory().getAmount(I.SHARK), 1);
      assert.equal(Firemaking.isFiremakingActive(other.p), false);
      assert.deepEqual(actor.gains, interrupted ? [] : [40], "pending lighting respects the accepted inventory interruption");
      assert.equal(actor.fires().length, interrupted ? 0 : 1);
      assert.equal(pile.isPendingRemoval(), !interrupted, "interrupted log remains the exact owned ground intermediate");
      assert.equal(pile.getItem().getAmount(), 1);
      assert.equal(actor.p.getInventory().getAmount(I.TINDERBOX), 1);
      assert.equal(Firemaking.isFiremakingActive(actor.p), false);
      if (interrupted) {
        assert.equal(actor.p.getLocation().equals(actor.anchor), true, "cancelled attempt never queued its automatic step");
        await send(actor, { type: "ground_item_action", itemId: I.LOGS, stackId: pile.getId(),
          x: actor.anchor.getX(), y: actor.anchor.getY(), option: "Light", optionIndex: 4 });
        assert.equal(Firemaking.isFiremakingActive(actor.p), true, "same actor starts the next ordinary Light");
        assert.equal(pile.isPendingRemoval(), false); assert.deepEqual(actor.gains, []);
        for (let tick = 0; tick < 8; tick++) turn();
        assert.deepEqual(actor.gains, [40]); assert.equal(actor.fires().length, 1);
        assert.equal(pile.isPendingRemoval(), true, "next ordinary Light burns the preserved log once");
        assert.equal(actor.p.getInventory().getAmount(I.TINDERBOX), 1);
        assert.equal(Firemaking.isFiremakingActive(actor.p), false);
        assert.deepEqual(other.gains, [40], "repeated actor action does not duplicate bystander's reward");
      }
    });
  }
});
