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
    onCustomEvent() {}, onPlayerDisconnect() {}, onItemOnItem() {}, onItemOnGroundItem() {},
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
    onCustomEvent() {}, emitCustomEvent() {}, emitFiremakingBlocked: () => false,
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
