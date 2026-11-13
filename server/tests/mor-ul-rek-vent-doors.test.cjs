// Run after `yarn build`: node --test tests/mor-ul-rek-vent-doors.test.cjs
//
// Mor Ul Rek's hot vent doors against rsprox (224/01437, 235/03870-03891, 236/03958): Pass steps the
// player through to the far side in one 2-tile step.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');
const { TaskManager } = require('../dist/game/task/TaskManager');

let pass;
let showCape;
let guardCondition;
let dialogueAction;
let core;

before(() => {
  const handlers = {};
  core = PluginManager.getCoreApi();
  const api = {
    core,
    onObjectInteraction: (name, actions) => { handlers[name] = actions; },
    onNpcDialogueCondition: (handler) => { guardCondition = guardCondition ?? handler; },
    onItemOnNpc: (handler) => { showCape = handler; },
    onCustomEvent: (name, handler) => { if (name === 'npc-dialogue:action') dialogueAction = handler; },
    persistAttribute() {},
  };
  require('../plugins/areas/MorUiRek.plugin').register(api);
  pass = handlers['Hot vent door'].Pass;
});

function player(x, y, access = true) {
  const attributes = new Map([['mor-ul-rek:access', access]]);
  const items = new Set();
  const p = {
    location: new Location(x, y, 0), steps: [],
    flags: new Set(), items, messages: [],
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => ({ contains: (id) => items.has(id) }),
    getEquipment: () => ({ get: () => null }),
    sendMessage: (message) => p.messages.push(message),
    getLocation: () => p.location,
    setFlag(f) { p.flags.add(f); }, removeFlag(f) { p.flags.delete(f); },
    moveTo(l) { p.location = l; },
    getMovementQueue: () => ({ reset() {}, addSteps: (l) => p.steps.push([l.getX(), l.getY()]) }),
  };
  return p;
}

const door = (x, y, face) => ({ getLocation: () => new Location(x, y, 0), getFace: () => face });

test('north of a rotation-0 door, Pass steps 2 tiles south through it (recorded: 2436,5121 -> 2436,5119)', () => {
  const p = player(2436, 5121);
  assert.equal(pass({ player: p, object: door(2436, 5120, 0) }), true);
  assert.deepEqual(p.steps, [[2436, 5119]]);
  assert.ok(p.flags.has('movement:ignore-clipping'), 'the step goes through the door tile');
  for (let i = 0; i < 2; i++) TaskManager.process();
  assert.ok(!p.flags.has('movement:ignore-clipping'), 'clipping is back once through');
});

test('from the south it goes north; a rotation-3 door is passed east-west; a diagonal start walks round first', () => {
  const south = player(2457, 5118);
  pass({ player: south, object: door(2457, 5119, 0) });
  assert.deepEqual(south.steps, [[2457, 5120]]);
  const east = player(2495, 5174);
  pass({ player: east, object: door(2494, 5174, 3) });
  assert.deepEqual(east.steps, [[2493, 5174]]);
  const diagonal = player(2437, 5121);
  pass({ player: diagonal, object: door(2436, 5120, 0) });
  assert.deepEqual(diagonal.steps, [[2436, 5121], [2436, 5119]], 'walked round to the door, then through');
});

test('Pass on two ticks in a row still crosses: only the latest pass ends the clipping exemption (real movement)', (t) => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
  CachePipeline.initialize();
  RegionManager.init();
  const p = new Player(null);
  // No client: only the session's writes are stubbed; movement and clipping are the real ones.
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.setRegistered(true);
  p.setAttribute('mor-ul-rek:access', true);
  t.after(() => p.setRegistered(false));
  p.moveTo(new Location(2436, 5121, 0));
  p.setNeedsPlacement(false); // the player update that follows a move
  p.setRunning(false); // walking: one tile a turn, so the second click lands with the player on the door
  const door = { getLocation: () => new Location(2436, 5120, 0), getFace: () => 0, getId: () => CacheDefinitions.getLocId('tzhaar_city_passthrough') };
  const turn = () => { TaskManager.process(); p.getMovementQueue().process(); };
  assert.equal(p.getMovementQueue().canWalkTo(new Location(2436, 5120, 0)), false, 'the door blocks its own tile');
  pass({ player: p, object: door });
  turn();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2436, 5120], 'on the door tile');
  pass({ player: p, object: door });
  for (let i = 0; i < 4; i++) turn();
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [2436, 5119]);
  assert.equal(p.hasFlag('movement:ignore-clipping'), false, 'clipping is back afterwards');
});

test('all five doors require permission to enter, and let a player without permission leave', () => {
  const entrances = [
    [2436, 5120, 0, 0, 1], [2457, 5119, 0, 0, 1], [2474, 5137, 0, 0, 1],
    [2494, 5174, 3, -1, 0], [2495, 5157, 3, -1, 0],
  ];
  for (const [x, y, face, dx, dy] of entrances) {
    const object = door(x, y, face);
    const outside = player(x + dx, y + dy, false);
    pass({ player: outside, object });
    assert.match(outside.messages[0], /show a fire cape/);
    assert.deepEqual(outside.steps, []);
    assert.equal(outside.flags.size, 0);
    const inside = player(x - dx, y - dy, false);
    pass({ player: inside, object });
    assert.deepEqual(inside.steps, [[x + dx, y + dy]]);
  }
  const besideEastWestDoor = player(2494, 5173, false);
  pass({ player: besideEastWestDoor, object: door(2494, 5174, 3) });
  assert.deepEqual(besideEastWestDoor.steps, []);
});

test('showing an owned cape to a guard unlocks later crossings without taking the cape', () => {
  const playerOutside = player(2436, 5121, false);
  const object = door(2436, 5120, 0);
  const itemId = core.ItemIdentifiers.FIRE_CAPE;
  const guard = core.NpcIdentifiers.TZHAAR_KET_9;
  showCape({ player: playerOutside, npcId: guard, itemId, handled: false });
  assert.equal(playerOutside.getAttribute('mor-ul-rek:access'), false, 'a missing cape grants nothing');
  playerOutside.items.add(itemId);
  pass({ player: playerOutside, object });
  assert.deepEqual(playerOutside.steps, [], 'carrying it without showing it grants nothing');
  // Showing a held cape plays the guard's exchange, which grants access at its message box
  // (mor-ul-rek-cape-on-guard.test.cjs, with a real player); its box step is the dialogue action.
  dialogueAction({ player: playerOutside, npcId: guard, kind: 'message', stepId: '2-PLAV', handled: false });
  assert.ok(playerOutside.items.delete(itemId), 'the cape was still held');
  pass({ player: playerOutside, object });
  assert.deepEqual(playerOutside.steps, [[2436, 5119]]);
});

test('the guard dialogue exposes the cape option only while held and rechecks it when shown', () => {
  const p = player(2436, 5121, false);
  const npcId = core.NpcIdentifiers.TZHAAR_KET_9;
  const definition = { getName: () => 'TzHaar-Ket' };
  const text = 'If the player has a firecape with them:';
  const step = { player: p, npcId, kind: 'message', stepId: '2-PLAV' };
  assert.equal(guardCondition({ player: p, npcId, definition, text }), false);
  p.items.add(core.ItemIdentifiers.FIRE_MAX_CAPE);
  assert.equal(guardCondition({ player: p, npcId, definition, text }), true);
  p.items.clear();
  dialogueAction(step);
  assert.equal(step.end, true);
  assert.equal(p.getAttribute('mor-ul-rek:access'), false);
  p.items.add(core.ItemIdentifiers.FIRE_MAX_CAPE);
  dialogueAction({ ...step, end: false });
  assert.equal(p.getAttribute('mor-ul-rek:access'), true);
});

test("TzHaar dialogue fills [TzHaar caste] with the player's TzHaar name (Wiki: TzHaar; rsprox 227/00073, 227/01749)", () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const Plugin = require('../plugins/areas/MorUiRek.plugin');
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  const fill = (text) => { const request = { player: p, text }; Plugin.fillTzhaarTitle(request); return request.text; };
  // Every pair equal: Mej first. No inner core access yet: no honorific.
  assert.equal(fill('You need help [TzHaar caste]-[player name]?'), 'You need help JalYt-Mej-[player name]?');
  assert.equal(fill("What's a '[TzHaar caste]'?"), "What's a 'JalYt-Mej'?");
  assert.equal(fill('Can I help you JalYt-[TzHaar caste]-[player name]?'), 'Can I help you JalYt-Mej-[player name]?', 'no doubled JalYt');
  p.getSkillManager().setMaxLevels(core.Skill.STRENGTH, 99, false).setMaxLevels(core.Skill.DEFENCE, 99, false);
  p.setAttribute('mor-ul-rek:access', true);
  assert.equal(fill('That is most impressive [TzHaar caste]-[player name].'), 'That is most impressive JalYt-Ket-Xo-[player name].');
  assert.equal(fill('Hello JalYt-[TzHaar caste]-Xo-[player name].'), 'Hello JalYt-Ket-Xo-[player name].', 'no doubled Xo');
  p.setAttribute('inferno:completions', 1);
  assert.equal(fill('Then you [TzHaar caste]!'), 'Then you JalYt-Ket-Kal!');
  assert.equal(fill("Ah that would be [TzHaar caste]-[champion's name]!"), "Ah that would be [TzHaar caste]-[champion's name]!",
    "the Fight Pit champion's caste is not the player's");
});

test("TzHaar dialogue branches on the player's caste (If the player's caste is JalYt-Ket:)", () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const Plugin = require('../plugins/areas/MorUiRek.plugin');
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  const ask = (caste) => Plugin.casteCondition({ player: p, text: `If the player's caste is JalYt-${caste}:` });
  assert.deepEqual(['Mej', 'Ket', 'Xil', 'Hur'].map(ask), [true, false, false, false]);
  p.getSkillManager().setMaxLevels(core.Skill.CRAFTING, 99, false).setMaxLevels(core.Skill.SMITHING, 99, false);
  assert.deepEqual(['Mej', 'Ket', 'Xil', 'Hur'].map(ask), [false, false, false, true]);
  assert.equal(Plugin.casteCondition({ player: p, text: 'If the player has a firecape with them:' }), null);
});
