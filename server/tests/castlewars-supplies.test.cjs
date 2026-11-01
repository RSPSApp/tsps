// Run after `yarn build`: node --test tests/castlewars-supplies.test.cjs
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const core = PluginManager.getCoreApi();
const data = require('../plugins/minigames/castlewars/Data.CastleWars')(core);
const Potions = require('../plugins/items/Potions.plugin');
const playing = new WeakSet();
const listeners = new Map();
const events = new Map();
let choices;
const api = new Proxy({
  core,
  persistAttribute() {},
  emitCanDrink: () => true,
  emitCanEat: () => true,
  onCustomEvent(name, handler) {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(handler);
  },
  emitCustomEvent(name, event) { for (const handler of events.get(name) ?? []) handler(event); },
  sendMultiChatboxPrompt(_player, _title, ...pairs) { choices = pairs; },
}, {
  get(object, key) {
    return object[key] ?? ((handler) => {
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(handler);
    });
  },
});
const game = {
  data,
  inGameBounds: (location) => data.GAME_BOUNDS.some((bounds) => bounds.inside(location)),
  isPlaying: (player) => playing.has(player),
  requirePlaying(player) {
    if (playing.has(player)) return true;
    player.sendMessage('You can only do that during a game of Castle Wars.');
    return false;
  },
};

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core.CacheDefinitions.registerCustomItems(require('../data/definitions/custom-items.json'));
  Potions.register(api);
  require('../plugins/minigames/castlewars/Supplies.CastleWars')(api, game);
  for (const startup of listeners.get('onServerStartup')) startup();
});

function player(t, active = true) {
  const p = new Player(null, new core.Location(2426, 3076, 1));
  const messages = [];
  const sender = new Proxy({}, { get: () => () => sender });
  t.mock.method(p, 'getPacketSender', () => sender);
  t.mock.method(p, 'sendMessage', (message) => messages.push(message));
  const animations = t.mock.method(p, 'performAnimation', () => {});
  if (active) playing.add(p);
  return { p, messages, animations };
}

function table(p, id, clickType = 1) {
  const object = new core.GameObject(id, new core.Location(2423, 3078, 1), 10, 0, null);
  const event = { player: p, object, clickType, handled: false };
  for (const handler of listeners.get('onObjectInteraction')) handler(event);
  return event;
}

function drink(p, id, slot = 0) {
  return listeners.get('onItemFirstAction')[0]({ player: p, itemId: id, slot });
}

test('Take-from and Take-5 supplies are instant, repeatable and use the correct tables', (t) => {
  const { p, animations } = player(t);
  table(p, core.ObjectIdentifiers.TABLE_450, 2);
  table(p, core.ObjectIdentifiers.TABLE_450);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 6);
  for (const id of [core.ObjectIdentifiers.TABLE_452, core.ObjectIdentifiers.TABLE_453, core.ObjectIdentifiers.TABLE_349]) {
    assert.ok(core.CacheDefinitions.getObject(id).actions.includes('Take-from'));
    assert.equal(table(p, id).handled, true);
  }
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.CASTLEWARS_BREW_4_), 3);
  assert.equal(animations.mock.callCount(), 0);
  assert.equal(p.getTimers().has(core.TimerKey.CASTLEWARS_TAKE_ITEM), false);
});

test('supply withdrawal refuses inactive players and full inventories', (t) => {
  const outside = player(t, false);
  table(outside.p, core.ObjectIdentifiers.TABLE_450);
  assert.equal(outside.p.getInventory().getAmount(core.ItemIdentifiers.BANDAGES), 0);
  const full = player(t);
  for (let slot = 0; slot < 28; slot++) full.p.getInventory().setItem(slot, new core.Item(core.ItemIdentifiers.BANDAGES, 1));
  table(full.p, core.ObjectIdentifiers.TABLE_453);
  assert.match(full.messages.at(-1), /inventory space/);
  assert.equal(full.p.getInventory().getAmount(core.ItemIdentifiers.CASTLEWARS_BREW_4_), 0);
});

test('the starting and corner-table pouches are the unlimited Castle Wars variant', (t) => {
  const { p } = player(t);
  api.emitCustomEvent('castlewars:started-player', { player: p });
  table(p, core.ObjectIdentifiers.TABLE_455);
  table(p, core.ObjectIdentifiers.TABLE_456);
  assert.equal(p.getInventory().getAmount(data.RUNE_POUCH), 1);
  assert.equal(data.RUNE_POUCH, 30692);
  assert.match(core.CacheDefinitions.getItem(data.RUNE_POUCH).examine, /Unlimited charges/);
  assert.equal(data.CLEANUP_ITEM_IDS.has(data.RUNE_POUCH), true);
  assert.equal(data.DEATH_REMOVE_ITEM_IDS.has(data.RUNE_POUCH), false, 'the pouch lasts for the entire game');
});

test('the pouch supplies combat spells only during a match and prevents free Magic experience', (t) => {
  const { p } = player(t);
  p.getInventory().adds(data.RUNE_POUCH, 1);
  const spell = core.CombatSpells.ICE_BARRAGE;
  function bypass(book = spell.getSpellbook()) {
    const event = { player: p, spellbook: book, spellId: spell.spellId(), bypass: null };
    for (const handler of listeners.get('onSpellRuneBypass')) handler(event);
    return event.bypass;
  }
  assert.equal(bypass(), true);
  assert.equal(bypass(core.MagicSpellbook.LUNAR), null, 'the same button in another spellbook is not free');
  const xp = { player: p, skill: core.Skill.MAGIC, allow: null };
  for (const handler of listeners.get('onCanGainExperience')) handler(xp);
  assert.equal(xp.allow, false);
  playing.delete(p);
  assert.equal(bypass(), null);
  playing.add(p);
  p.getInventory().delete(data.RUNE_POUCH, 1);
  assert.equal(bypass(), null);
});

test('unlimited minigame pouches cannot consume or store the ordinary pouch\'s saved runes', (t) => {
  const Pouch = require('../plugins/items/runepouch/Common.RunePouch');
  Pouch.init(api);
  const { p } = player(t);
  p.getInventory().adds(data.RUNE_POUCH, 1);
  p.getInventory().adds(core.ItemIdentifiers.WATER_RUNE, 100);
  assert.equal(Pouch.isPouch(p.getInventory().getItems()[0]), false);
  assert.equal(Pouch.findPouch(p), null);
  const use = { player: p, usedItem: p.getInventory().getItems()[0], usedWithItem: p.getInventory().getItems()[1], handled: false };
  require('../plugins/items/runepouch/Inventory.RunePouch')._test.useRuneOnPouch(use);
  assert.equal(use.handled, false);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.WATER_RUNE), 100);
  p.getInventory().adds(core.ItemIdentifiers.RUNE_POUCH, 1);
  assert.equal(Pouch.findPouch(p).getId(), core.ItemIdentifiers.RUNE_POUCH);
});

test('Castlewars brew uses normal potion cooldowns and restores stats, prayer and stamina', (t) => {
  const { p } = player(t);
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevel(skill, 50, false);
  p.setRunEnergy(10);
  p.getInventory().setItem(0, new core.Item(data.BREW_DOSES[0], 1));
  assert.equal(drink(p, data.BREW_DOSES[0]), true);
  assert.equal(p.getInventory().getItems()[0].getId(), data.BREW_DOSES[1]);
  for (const skill of [core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) assert.equal(p.getSkillManager().getCurrentLevel(skill), 118);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.RANGED), 112);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MAGIC), 109);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 82);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS), 50);
  assert.equal(p.getRunEnergy(), 30);
  assert.ok(p.getAttribute('potions:stamina:end') > Date.now());
  drink(p, data.BREW_DOSES[1]);
  assert.equal(p.getInventory().getItems()[0].getId(), data.BREW_DOSES[1], 'shared potion cooldown prevents double drinking');
});

test('game-only potions refuse drinking outside Castle Wars and while stunned', (t) => {
  const { p } = player(t, false);
  p.getInventory().setItem(0, new core.Item(data.BREW_DOSES[0], 1));
  drink(p, data.BREW_DOSES[0]);
  assert.equal(p.getInventory().getItems()[0].getId(), data.BREW_DOSES[0]);
  playing.add(p);
  p.getTimers().extendOrRegister(core.TimerKey.STUN, 2);
  drink(p, data.BREW_DOSES[0]);
  assert.equal(p.getInventory().getItems()[0].getId(), data.BREW_DOSES[0]);
});

test('content drink registration validates dose chains and cannot replace another potion', () => {
  for (const request of [
    { name: 'Invalid', chains: 'invalid', effect() {} },
    { name: 'Invalid', chains: [[data.BREW_DOSES[0]]], effect() {} },
    { name: 'Invalid', chains: [[-1]], effect() {} },
    { name: 'Invalid', chains: [[51001, 51001]], effect() {} },
  ]) {
    api.emitCustomEvent('potions:register', request);
    assert.equal(request.registered, undefined);
  }
  assert.equal(Potions.getPotionName(data.BREW_DOSES[0]), 'Castlewars brew');
});

test('bucket routing stands directly next to a Castle Wars tap', (t) => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2426, 3076);
  const { p } = player(t);
  const taps = [...MapObjects.mapObjects.values()].flat().filter((object) =>
    core.CacheDefinitions.getObject(object.getId()).name === 'Tap' && game.inGameBounds(object.getLocation()));
  assert.equal(taps.length, 2);
  for (const object of taps) {
    const at = object.getLocation();
    const event = { player: p, object, objectId: object.getId(), definition: object.getDefinition(), sourceLocation: { x: at.getX() + 3, y: at.getY() - 2, z: 0 }, destination: null };
    for (const handler of listeners.get('onObjectRoute')) handler(event);
    assert.ok(event.destination);
    assert.equal(Math.abs(event.destination.x - at.getX()) + Math.abs(event.destination.y - at.getY()), 1);
    assert.equal(core.RegionManager.blocked(new core.Location(event.destination.x, event.destination.y, event.destination.z), null), false);
  }
});

test('cleanup includes buckets and every potion dose; Lanthus and ground supplies use corrected canonical spawns', () => {
  for (const id of [core.ItemIdentifiers.BUCKET, core.ItemIdentifiers.BUCKET_OF_WATER, ...data.BREW_DOSES]) {
    assert.equal(data.CLEANUP_ITEM_IDS.has(id), true);
    assert.equal(data.DEATH_REMOVE_ITEM_IDS.has(id), true);
  }
  const lanthus = require('../data/definitions/npc-spawns.json').filter((spawn) => spawn.name === 'Lanthus');
  assert.equal(lanthus.length, 1);
  assert.equal(lanthus[0].wanderRadius, 0);
  const spawns = require('../data/definitions/ground-items.json').filter((spawn) => spawn.description === 'Castle Wars');
  assert.equal(spawns.some((spawn) => spawn.id === core.ItemIdentifiers.BUCKET), false);
  const tinderboxes = spawns.filter((spawn) => spawn.id === core.ItemIdentifiers.TINDERBOX);
  assert.equal(tinderboxes.length, 4);
  assert.ok(tinderboxes.every((spawn) => spawn.respawn === 2));
  assert.deepEqual(data.ALTAR_SPAWNS, []);
});
