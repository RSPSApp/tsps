// Captured Fallen From Grace auto-passage: the skiff crosses the south-west cave approach
// without an object click, moves to the recorded cavern mooring, and stays a real owned boat.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Location } = require('../dist/game/model/Location');
const { BoatManager } = require('../dist/game/content/sailing/BoatManager');
const { Sailing } = require('../dist/game/content/sailing/Sailing');
const { BoatMoveMode } = require('../dist/game/content/sailing/Boat');
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const runtime = require('../plugins/quests/QuestRuntime');
const sailingContent = require('../plugins/skills/sailing/SailingContent.Sailing');
const core = PluginManager.getCoreApi();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  sailingContent.content();
  Sailing.initialize();
});

function setup() {
  const hooks = { custom: new Map(), logins: [], logouts: [], objects: [] };
  let tasks = [];
  class CountdownTask {
    constructor(key, ticks, run) { this.key = key; this.ticks = ticks; this.run = run; }
  }
  const TaskManager = {
    submit(task) { tasks.push(task); },
    cancelTasks(key) { tasks = tasks.filter((task) => task.key !== key); },
  };
  const testCore = { ...core, CountdownTask, TaskManager };
  const api = new Proxy({
    core: testCore,
    persistAttribute() {},
    onNpcDialogueVariant() {}, onNpcDialogueCondition() {}, onNpcInteraction() {},
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    onObjectInteraction(fn) { hooks.objects.push(fn); },
    onItemOnItem() {}, onItemOnNpc() {}, onItemAction() {}, onGroundItemClick() {}, onGroundItemPickup() {},
    onNpcDeath() {}, onZoneEnter() {},
    onPlayerLogin(fn) { hooks.logins.push(fn); }, onPlayerLogout(fn) { hooks.logouts.push(fn); },
    spawnNpc() { return null; }, removeNpc() {},
    getItemOnGroundManager() { return { getGroundItem() {}, registerLocation() {} }; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/FallenFromGrace.Quest')(api);
  PluginManager.emitCustomEvent = (name, event) => {
    for (const fn of hooks.custom.get(name) ?? []) fn(event);
  };
  const quest = runtime.getRegisteredQuests().filter((entry) => entry.key === 'fallen_from_grace').at(-1);
  const varbits = new Map(), messages = [], attributes = new Map();
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendInterfaceRemoval() { return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  let area = null;
  let location = new Location(15940, 10053, 0);
  const sailing = { boats: [], activeBoatSlot: null, returnPoint: null, lastDock: null, lastStandardDock: null };
  const player = {
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return player; },
    getIndex: () => 7,
    getUsername: () => 'cavern-test',
    getLocation: () => location,
    moveTo(next) { location = next; },
    setLocation(next) { location = next; },
    getArea: () => area,
    setArea(next) { area = next; },
    getPrivateArea: () => area?.countsAsMainWorld?.() ? null : area ?? null,
    getSailing: () => sailing,
    getPacketSender: () => sender,
    sendMessage(text) { messages.push(text); },
    getInventory: () => ({ getAmount: () => 0, getFreeSlots: () => 28, isFull: () => false,
      adds() {}, deleteNumber() {} }),
    getSkillManager: () => ({ getMaxLevel: () => 99, addExperiences() {} }),
    getDialogueManager: () => null,
    getAttribute: (key) => attributes.get(key),
    setAttribute(key, value) { attributes.set(key, value); },
    getRights: () => 0,
    getEquipment: () => ({ get: () => null, getItems: () => [] }),
    setPositionToFace() {}, performAnimation() {},
  };
  return {
    api, hooks, quest, player, sailing, messages, attributes,
    tasks: () => tasks,
    clearTasks: () => { tasks = []; },
  };
}

function ownSkiffAtApproach(h) {
  h.player.setAttribute('fallen-from-grace:stage-version', 2);
  h.quest.setStage(h.player, 8);
  assert.equal(h.quest.getStage(h.player), 8, 'stage 8 before boarding');
  assert.equal(Sailing.giveBoat(h.player, 'skiff', 'wyrmscraig') !== undefined, true);
  assert.equal(Sailing.board(h.player, 'wyrmscraig'), null);
  const boat = Sailing.instanceAboard(h.player);
  assert.ok(boat, 'real owned skiff is aboard');
  // Capture P2 tick 10 root (2533.5,2188.25), heading east along the real open-sea approach.
  boat.fineX = 324288;
  boat.fineY = 280096;
  boat.level = 0;
  boat.angle = 1536;
  boat.heading = 1536;
  boat.moveMode = BoatMoveMode.Half;
  return boat;
}

test('real hull reaches the captured approach line and auto-enters without an object click', () => {
  const h = setup();
  const boat = ownSkiffAtApproach(h);
  const deckLocation = h.player.getLocation();
  const deckArea = h.player.getArea();
  assert.equal(BoatManager.isSailable(boat.tileX, boat.tileY, 0), true, 'approach starts in legal open sea');
  assert.equal(BoatManager.isSailable(2562, 2203, 0), false, 'the cache portal pool itself stays sealed');

  for (let tick = 0; tick < 40 && h.quest.getStage(h.player) !== 9; tick++) {
    BoatManager.tick();
    for (const task of h.tasks().splice(0)) task.run();
  }

  assert.equal(h.quest.getStage(h.player), 9, 'captured stage 8 -> 9 auto passage');
  assert.equal(h.quest.isComplete(h.player), false);
  assert.equal(h.messages.includes('You sail through the cave opening.'), true);
  assert.equal(boat.fineX, 329920, 'captured cavern mooring x (2577.5)');
  assert.equal(boat.fineY, 1101632, 'captured cavern mooring y (8606.5)');
  assert.equal(boat.angle, 1408, 'captured entry facing');
  assert.equal(boat.level, 0);
  assert.equal(boat.moveMode, 0, 'boat stops at the cavern mooring');
  assert.equal(boat.ownerPlayerId, h.player.getIndex(), 'same owned boat');
  assert.equal(BoatManager.getBoatAboard(h.player), boat, 'player stays on the private deck');
  assert.equal(h.player.getArea(), deckArea, 'private deck area is unchanged');
  assert.equal(h.player.getLocation(), deckLocation, 'deck projection is unchanged');
  assert.equal(h.sailing.boats[0].location.kind, 'at_sea');
  assert.equal(h.sailing.boats[0].location.dock, 'wyrmscraig_cave');
  assert.equal(h.tasks().length, 0, 'watch stops after entry');

  assert.equal(Sailing.disembark(h.player, 'wyrmscraig_cave'), null);
  assert.equal(h.player.getLocation().getX(), 2583);
  assert.equal(h.player.getLocation().getY(), 8605);
  assert.equal(BoatManager.getBoatAboard(h.player), undefined, 'normal gangplank landing is reachable');
  assert.equal(h.quest.getStage(h.player), 9);
});

test('logout before the portal cancels the quest watch and cannot auto-enter later', () => {
  const h = setup();
  const boat = ownSkiffAtApproach(h);
  assert.equal(h.tasks().length, 1, 'one quest-scoped watch is pending');
  for (const fn of h.hooks.logouts) fn({ player: h.player });
  assert.equal(h.tasks().length, 0, 'logout cancels the watch');

  boat.fineX = 2543 * 128 + 64;
  boat.fineY = 2188 * 128 + 32;
  BoatManager.tick();
  assert.equal(h.quest.getStage(h.player), 8, 'no auto-entry after logout');
});

test('canonical Sailing cavern landing has an exact moveNear:false route to Mortimer', () => {
  const route = new RsmodRouteFinding((x, y, z, area) => RegionManager.getClipping(x, y, z, area));
  RegionManager.loadMapFiles(2583, 8605, true);
  RegionManager.loadMapFiles(2601, 8608, true);
  const run = (srcX, srcY) => route.findRoute({
    level: 0, srcX, srcY, srcSize: 1, destX: 2601, destY: 8608,
    destWidth: 1, destLength: 1, moveNear: false, privateArea: null, maxWaypoints: 10000,
  });
  const canonical = run(2583, 8605);
  assert.equal(canonical.success, true, 'canonical port landing reaches the first quest NPC');
  assert.equal(canonical.alternative, false);
  assert.deepEqual([canonical.endX, canonical.endY], [2601, 8608]);
  const captured = run(2589, 8606);
  assert.equal(captured.success, true, 'captured landing is reachable too');
  assert.equal(captured.alternative, false);
  assert.deepEqual([captured.endX, captured.endY], [2601, 8608]);
});

test('stage 8 already aboard starts the watch on a normal login', () => {
  const h = setup();
  ownSkiffAtApproach(h);
  for (const fn of h.hooks.logouts) fn({ player: h.player });
  assert.equal(h.tasks().length, 0);
  for (const fn of h.hooks.logins) fn({ player: h.player });
  assert.equal(h.tasks().length, 1, 'login on the stage-8 boat re-arms the quest watch');
});
