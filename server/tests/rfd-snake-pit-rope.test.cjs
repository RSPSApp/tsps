// From server/: node --test tests/rfd-snake-pit-rope.test.cjs (after yarn build).
// #5685 item 2: the Awowogei snake pit rope. Ladders.plugin.js claims every "Rope"/"Climb" click, so the
// quest handler never ran; the pit rope now answers Ladders' "ladders:climb" ownership check.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

// Register only the quests this audit reads instead of the whole Quests.plugin
// list, so an unrelated in-flight quest source cannot make this scoped test fail.
const TEST_QUEST_MODULES = [
  'RecipeForDisaster',
  'CooksAssistant', 'FishingContest', 'GoblinDiplomacy', 'BigChompyBirdHunting',
  'Biohazard', 'DemonSlayer', 'MurderMystery', 'NatureSpirit', 'WitchsHouse',
  'GertrudesCat', 'ShadowOfTheStorm', 'MonkeyMadnessI', 'FamilyCrest', 'HeroesQuest',
  'LostCity', 'MerlinsCrystal', 'ShieldOfArrav', 'DragonSlayer', 'ShiloVillage',
  'JunglePotion', 'DruidicRitual', 'UndergroundPass', 'PlagueCity', 'WaterfallQuest',
  'DesertTreasureI', 'HorrorFromTheDeep', 'LegendsQuest', 'OneSmallFavour',
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  RegionManager.init();
});

/** What a real sender's getVarbit answers: the last value sent, else 0. */
const varbitReader = (log) => (id) =>
  log.findLast(([method, varbitId]) => method === 'sendVarbit' && varbitId === id)?.[2] ?? 0;

function makePlayer() {
  const attrs = new Map();
  const items = new Map();
  const equipment = new Map();
  const messages = [];
  const moves = [];
  const xp = new Map();
  const log = [];
  let full = false;
  let location = new core.Location(3209, 3215, 0);
  let area = null;
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    contains: id => (items.get(id) ?? 0) > 0,
    adds: (id, amount = 1) => {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) {
        messages.push('Not enough space in your inventory.');
        return false;
      }
      items.set(id, (items.get(id) ?? 0) + amount);
      return true;
    },
    deleteNumber: (id, amount = 1) => {
      items.set(id, Math.max(0, (items.get(id) ?? 0) - amount));
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter(amount => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items.entries()].filter(([, amount]) => amount > 0)
      .map(([id, amount]) => ({ getId: () => id, getAmount: () => amount, getDefinition: () => ({ getWeight: () => 0 }) })),
  };
  const sender = new Proxy({ getVarbit: varbitReader(log) }, { get: (target, prop) => target[prop] ?? ((...args) => { log.push([String(prop), ...args]); return sender; }) });
  const skillManager = {
    getCurrentLevel: skill => xp.get(`level:${skill}`) ?? 99,
    getMaxLevel: skill => xp.get(`level:${skill}`) ?? 99,
    getExperience: skill => xp.get(`xp:${skill}`) ?? 0,
    addExperience: (skill, amount) => xp.set(`xp:${skill}`, (xp.get(`xp:${skill}`) ?? 0) + amount),
    addExperiences: (skill, amount) => xp.set(`xp:${skill}`, (xp.get(`xp:${skill}`) ?? 0) + amount),
    setCurrentLevelCombat: (skill, value) => xp.set(`level:${skill}`, value),
  };
  return {
    attrs, items, equipment, messages, moves, log, xp,
    setFull(value) { full = value; },
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: slot => {
      const id = equipment.get(slot);
      return id === undefined ? null : { getId: () => id };
    } }),
    getSkillManager: () => skillManager,
    getUsername: () => 'rfd-test', getDisplayName: () => 'rfd-test',
    getPrivateArea: () => null,
    getPacketSender: () => sender,
    getDialogueManager: () => ({ isActive: () => false, getCurrent: () => null, startDialogues: noop, handleResume: noop, reset: noop }),
    getLocation: () => location,
    getArea: () => area,
    setArea: next => { area = next; },
    getPrayerActive: () => [],
    getAsPlayer() { return this; },
    moveTo: next => { location = next; moves.push([next.getX(), next.getY(), next.getZ()]); },
    performAnimation: noop,
    sendMessage: text => messages.push(text),
    setRunEnergy: noop,
    setSpecialPercentage: noop,
    isRegistered: () => true,
    isPlayer: () => true,
  };
}


const STATE = 'recipe-for-disaster:awowogei-state';
const L = core.Location;
let loaded = false;
function loadReal() {
  if (loaded) return;
  PluginManager.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  loaded = true;
}
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');

function pitPlayer({ stage = 4, at = [3022, 5488, 0] } = {}) {
  const p = makePlayer();
  p.getPrivateArea = () => null;
  runtime.getRegisteredQuests().findLast(e => e.key === 'recipe_for_disaster').setStage(p, stage);
  p.setLocation(...at);
  return p;
}

function climbRope(p, objectId = 15571, at = [3023, 5488, 0]) {
  const object = MapObjects.get(objectId, new L(...at), null);
  assert.ok(object, `real object ${objectId} at ${at}`);
  const event = { player: p, object, definition: ObjectDefinition.forId(objectId), objectId, clickType: 1,
    option: 'climb', location: { x: at[0], y: at[1], z: at[2] },
    sourceLocation: { x: p.getLocation().getX(), y: p.getLocation().getY(), z: p.getLocation().getZ() }, handled: false };
  PluginManager.emitObjectInteraction(event);
  return event;
}

test('the real pit rope (Rope, Climb) takes an RFD player out of the snake pit', () => {
  loadReal();
  const p = pitPlayer();
  const event = climbRope(p);
  assert.equal(event.handled, true);
  assert.deepEqual(p.moves.at(-1), [2922, 2722, 0], 'exits to the surface beside the pit');
  assert.ok(p.messages.includes('You climb up the rope and out of the snake pit.'));
});

test('a player who is not on Recipe for Disaster is not claimed by the quest (Ladders keeps the click)', () => {
  loadReal();
  const p = pitPlayer({ stage: 0 });
  climbRope(p);
  assert.deepEqual(p.moves, [], 'the quest does not move a player who has not reached the quest stage');
  assert.ok(!p.messages.includes('You climb up the rope and out of the snake pit.'));
});

test('the claim only answers inside the snake hole and for the pit rope', () => {
  loadReal();
  const outside = pitPlayer({ at: [3000, 5400, 0] });
  const req = { player: outside, object: MapObjects.get(15571, new L(3023, 5488, 0), null), objectId: 15571, clickType: 1, handled: false };
  PluginManager.emitCustomEvent('ladders:climb', req);
  assert.equal(req.handled, false);
  assert.deepEqual(outside.moves, []);
  const inside = pitPlayer();
  const other = { player: inside, object: null, objectId: 15570, clickType: 1, handled: false };
  PluginManager.emitCustomEvent('ladders:climb', other);
  assert.equal(other.handled, false, 'another object is not claimed');
  assert.deepEqual(inside.moves, []);
});
