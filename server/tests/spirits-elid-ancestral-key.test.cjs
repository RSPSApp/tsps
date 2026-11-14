// From server/ after `yarn build`: node --test tests/spirits-elid-ancestral-key.test.cjs
// RSPSApp/tsps#5275: a stage 20..54 player must be able to Telekinetic Grab the Elid ancestral key
// (6792, shrine table 3432,2928,0) and advance 20 -> 25. The key is a floor stack owned by the
// player; the real ItemOnGroundManager, World cycles and quest handler run here. Mocks are limited to:
// rune checks/consumption, the walk (movement queue), the pickup transfer into inventory, and the
// quest's inventory/skill/dialogue surface. Those are disclosed in the PR.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
const { MagicOnItemPacketListener } = require('../dist/net/packet/impl/MagicOnItemPacketListener');
const { MagicSpellbook } = require('../dist/game/model/MagicSpellbook');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');
const { Location } = require('../dist/game/model/Location');
const { Projectile } = require('../dist/game/model/Projectile');
const { Sounds } = require('../dist/game/Sounds');
const runtime = require('../plugins/quests/QuestRuntime');

runtime.startTranscript = () => true;

const KEY = 6792;
const KEY_TILE = new Location(3432, 2928, 0);
const GHASLOR = 4745;
const BALLAD_STEP = '4JXIDh';
const TELEKINETIC_GRAB = 1168;
const STAGE_BALLAD = 20;
const STAGE_KEY = 25;
// The ticks the key stays on the floor before it is removed. Mirrors ItemOnGroundManager.DESPAWN_DELAY.
const DEFAULT_DESPAWN = ItemOnGroundManager.DESPAWN_DELAY;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

// Same order as World.process: tasks (the grab's landing) before ground items age.
function cycle() {
  World.processCycle = World.getProcessCycle() + 1;
  TaskManager.process();
  ItemOnGroundManager.process();
}

function withWorld(fn) {
  const items = World.getItems(), previous = items.splice(0), cycleBefore = World.getProcessCycle();
  const finishedBefore = ItemOnGroundManager.finishedCycle;
  try { World.processCycle = 5000; cycle(); fn(); }
  finally {
    items.splice(0, items.length, ...previous);
    World.processCycle = cycleBefore; ItemOnGroundManager.finishedCycle = finishedBefore;
  }
}

function advance(ticks) { for (let i = 0; i < ticks; i++) cycle(); }

function setup(username = 'ancestral-key-test') {
  const hooks = { custom: new Map(), login: [] };
  const core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    persistAttribute() {},
    getWorld: () => ({ getNpcs: () => [] }),
    getItemOnGroundManager: () => ItemOnGroundManager,
    onPlayerLogin(fn) { hooks.login.push(fn); },
    onCustomEvent(name, fn) { const list = hooks.custom.get(name) ?? []; list.push(fn); hooks.custom.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of hooks.custom.get(name) ?? []) fn(event); },
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  require('../plugins/quests/quests/SpiritsOfTheElid.Quest')(api);
  const quest = runtime.getRegisteredQuests().at(-1);

  const attrs = new Map(), inventory = new Map(), varbits = new Map(), messages = [];
  const sender = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendConfig(id, value) { varbits.set(id, value); return sender; },
    getVarbit(id) { return varbits.get(id) ?? 0; },
  }, { get(target, key) { return target[key] ?? (() => sender); } });
  const walks = [];
  const player = {
    getUsername: () => username,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getIndex: () => 9,
    isPlayer: () => true,
    isRegistered: () => true,
    getHitpoints: () => 10,
    getSize: () => 1,
    getPacketSender: () => sender,
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      getItems: () => [],
      deleteNumber(id, count) { inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - count)); },
      adds(id, count) { inventory.set(id, (inventory.get(id) ?? 0) + count); },
      isFull: () => false,
      getFreeSlots: () => 28,
    }),
    getEquipment: () => ({ getItems: () => [], get: () => null }),
    getSkillManager: () => ({
      getCurrentLevel: () => 33, getMaxLevel: () => 33,
      setCurrentLevels() {}, updateSkill() {}, addExperiences() {}, stopSkillable() {},
    }),
    getSpellbook: () => MagicSpellbook.NORMAL,
    getClickDelay: () => ({ elapsedTime: () => true, reset() {} }),
    getLocation: () => location,
    setPositionToFace() {},
    performAnimation() {},
    performGraphic() {},
    moveTo(to) { location = to; },
    getPrivateArea: () => null,
    getDialogueManager: () => ({ isActive: () => false, reset() {}, startDialogues() {} }),
    getMovementQueue: () => ({
      reset() { return this; }, setBlockMovement() { return this; },
      walkToTile(tile, action, reached) { walks.push({ tile, action, reached }); },
    }),
    sendMessage: (message) => messages.push(message),
  };
  let location = new Location(3430, 2928, 0);
  const setLocation = (to) => { location = to; };
  const ballad = () => {
    const event = { player, npcId: GHASLOR, stepId: BALLAD_STEP, handled: false };
    hooks.custom.get('npc-dialogue:action')?.forEach((fn) => fn(event));
    return event;
  };
  const login = () => { for (const fn of hooks.login) fn({ player }); };
  return { quest, player, inventory, messages, walks, setLocation, ballad, login, custom: hooks.custom };
}

// The cast route: real findVisibleGroundItem and real ground-item lookup; runes and the pickup
// transfer are stubbed, and the quest's magic:telekinetic-grab listener is the real one.
function castRoute(t, h) {
  const listener = new MagicOnItemPacketListener();
  t.mock.method(Projectile.prototype, 'sendProjectile', () => {});
  t.mock.method(Sounds, 'sendSound', () => {});
  t.mock.method(listener, 'runeCosts', () => []);
  t.mock.method(listener, 'hasRunes', () => true);
  t.mock.method(listener, 'consumeRunes', () => {});
  t.mock.method(listener, 'canReceiveGroundItem', () => true);
  t.mock.method(ItemOnGroundManager, 'transferToInventory', (player, groundItem) => {
    World.getItems().splice(World.getItems().indexOf(groundItem), 1);
    h.player.getInventory().adds(groundItem.getItem().getId(), groundItem.getItem().getAmount());
    return groundItem.getItem().getAmount();
  });
  // The grab announces itself on the global plugin bus; route those names to the quest's real listeners.
  const realEmit = PluginManager.emitCustomEvent;
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    for (const fn of h.custom.get(name) ?? []) fn(event);
    return realEmit.call(PluginManager, name, event);
  });
  return { listener };
}

// Telegrab cast of the key from `from`; lands the projectile (3 ticks) before returning.
function grabKey(t, h, from) {
  const { listener } = castRoute(t, h);
  h.setLocation(from);
  listener.castGroundItem(h.player, KEY, KEY_TILE.getX(), KEY_TILE.getY(), TELEKINETIC_GRAB);
  advance(3);
}

test('precondition: a fresh key at stage 20 is telegrabbable in range (cast route works)', (t) => withWorld(() => {
  const h = setup('precondition-in-range');
  h.quest.setStage(h.player, STAGE_BALLAD);
  h.ballad();
  assert.ok(ItemOnGroundManager.getGroundItem(h.player.getUsername(), KEY, KEY_TILE, null), 'key is on the table');
  grabKey(t, h, new Location(3430, 2928, 0));
  assert.equal(h.quest.getStage(h.player), STAGE_KEY, 'in-range telegrab advances 20 -> 25');
  assert.equal(h.inventory.get(KEY), 1, 'the key is in the inventory');
}));

test('precondition: a fresh key is telegrabbable from out of range via the walk, then the grab resolves on arrival', (t) => withWorld(() => {
  const h = setup('precondition-out-of-range');
  h.quest.setStage(h.player, STAGE_BALLAD);
  h.ballad();
  const { listener } = castRoute(t, h);
  h.setLocation(new Location(3400, 2928, 0));
  listener.castGroundItem(h.player, KEY, KEY_TILE.getX(), KEY_TILE.getY(), TELEKINETIC_GRAB);
  assert.equal(h.walks.length, 1, 'out of range: the cast walks in first');
  assert.equal(h.quest.getStage(h.player), STAGE_BALLAD, 'no grab before arrival');
  // Mocked movement: the player arrives inside range and the arrival callback resolves the cast.
  h.setLocation(new Location(3426, 2928, 0));
  assert.equal(h.walks[0].reached(h.player), true, 'arrival is in range');
  h.walks[0].action();
  advance(3);
  assert.equal(h.quest.getStage(h.player), STAGE_KEY, 'the arrival grab advances 20 -> 25');
}));

test('defect (BEFORE fails here): the key still exists after the default 300-tick lifetime, so the telegrab advances the quest', (t) => withWorld(() => {
  const h = setup('lifetime-gap');
  h.quest.setStage(h.player, STAGE_BALLAD);
  h.ballad();
  advance(DEFAULT_DESPAWN + 1);
  // The key must not expire for a player who is still on the quest. Asserted at the grab, the point the report hits.
  grabKey(t, h, new Location(3430, 2928, 0));
  assert.equal(h.quest.getStage(h.player), STAGE_KEY, 'the key is still on the table and the grab advances 20 -> 25');
  assert.equal(h.inventory.get(KEY), 1);
}));

test('control: the key is owner-only and is never public to another player', (t) => withWorld(() => {
  const h = setup('owner-only-owner');
  const other = setup('owner-only-other');
  h.quest.setStage(h.player, STAGE_BALLAD);
  h.ballad();
  const pile = ItemOnGroundManager.getGroundItem(h.player.getUsername(), KEY, KEY_TILE, null);
  assert.ok(pile, 'the owner sees the key');
  assert.equal(pile.getState(), State.SEEN_BY_PLAYER, 'owner-only stack');
  advance(150);
  assert.equal(pile.getState(), State.SEEN_BY_PLAYER, 'the key stays owner-only past the public reveal tick');
  assert.equal(ItemOnGroundManager.canSee(other.player, pile), false, 'another player cannot see it');
  assert.equal(ItemOnGroundManager.canSee(h.player, pile), true, 'the owner still sees it');
}));

test('control: the stage gate is unchanged (no key below stage 20)', () => withWorld(() => {
  const h = setup('gate-below-ballad');
  h.quest.setStage(h.player, 10);
  h.ballad();
  assert.equal(ItemOnGroundManager.getGroundItem(h.player.getUsername(), KEY, KEY_TILE, null), null, 'no key at stage 10');
}));
