// From server/: node --test tests/mage-training-arena.test.cjs (after yarn build).
//
// The Mage Training Arena against the OSRS Wiki (Mage_Training_Arena, Pizazz_points, Progress_hat,
// Entrance_Guardian, Enchanting_Chamber): the hat and its dialogue, Pizazz Points and their caps,
// the Enchanting Chamber's piles, enchant points, hole and rune reward, and the room's items.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Guardians, Lobby, Telekinetic, Enchanting, Alchemists, Graveyard, Rewards, events, ironmanMode, testApi;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/minigames/magetrainingarena/Common.MageTrainingArena');
  Guardians = require('../plugins/minigames/magetrainingarena/Guardians.MageTrainingArena');
  Lobby = require('../plugins/minigames/magetrainingarena/Lobby.MageTrainingArena');
  Telekinetic = require('../plugins/minigames/magetrainingarena/Telekinetic.MageTrainingArena');
  Enchanting = require('../plugins/minigames/magetrainingarena/Enchanting.MageTrainingArena');
  Alchemists = require('../plugins/minigames/magetrainingarena/Alchemists.MageTrainingArena');
  Graveyard = require('../plugins/minigames/magetrainingarena/Graveyard.MageTrainingArena');
  Rewards = require('../plugins/minigames/magetrainingarena/Rewards.MageTrainingArena');
  ironmanMode = 'none';
  events = [];
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} }, Bank: { ...core.Bank, getTabForItem: () => 0 } },
    persistAttribute: () => {},
    emitCustomEvent(name, event) {
      events.push([name, event]);
      if (name === 'npc-dialogue:start') event.handled = true;
      if (name === 'ironman:mode') event.mode = ironmanMode;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  testApi = api;
  Common.init(api);
});

const loc = (x, y, z = 0) => new core.Location(x, y, z);

function fakePlayer(x = 3363, y = 9644, z = 0) {
  let tile = loc(x, y, z);
  const items = new Map();
  let free = 20;
  const xp = [];
  const strings = new Map();
  const hidden = new Map();
  const camera = [];
  const player = {
    messages: [], attributes: {}, xp, strings, hidden, camera, magic: 99, anims: 0, runEnergy: 100,
    getLocation: () => tile,
    moveTo: (to) => { tile = to; },
    isRegistered: () => true,
    sendMessage: (m) => player.messages.push(m),
    getAttribute: (k) => player.attributes[k],
    setAttribute: (k, v) => { player.attributes[k] = v; },
    getSkillManager: () => ({ getCurrentLevel: () => player.magic, addExperiences: (skill, amount) => xp.push(amount) }),
    getRunEnergy: () => player.runEnergy,
    setRunEnergy: (value) => { player.runEnergy = value; },
    getPacketSender: () => ({
      sendSubInterface() {}, closeSubInterface() {}, sendSound() {}, sendRunEnergy() {},
      sendString: (text, id) => strings.set(id, text),
      sendInterfaceDisplayState: (id, hide) => hidden.set(id, hide),
      sendCameraLookAt: (x, y, height, motion) => camera.push({ mode: 'look', x, y, height, motion }),
      sendCameraMoveTo: (x, y, height, motion) => camera.push({ mode: 'move', x, y, height, motion }),
      sendCameraReset: () => camera.push({ mode: 'reset' }),
    }),
    getInventory: () => ({
      getAmount: (id) => items.get(id) ?? 0,
      contains: (id) => (items.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
      getFreeSlots: () => free,
      getAddableAmount: (item) => {
        if (!core.ItemDefinition.forId(item.getId()).isStackable()) return Math.min(item.getAmount(), free);
        const held = items.get(item.getId()) ?? 0;
        return held > 0 || free > 0 ? Math.min(item.getAmount(), 0x7fffffff - held) : 0;
      },
      getItems: () => player.slots ?? [],
    }),
    getEquipment: () => ({ get: () => null }),
    getBanks: () => [],
    getCurrentBankTab: () => 0,
    performAnimation: () => { player.anims += 1; },
    performGraphic() {},
    setFree: (n) => { free = n; },
    items,
  };
  return player;
}

function fakeNpc(definition) {
  let tile = loc(definition.x, definition.y, definition.z ?? 0);
  let id = definition.id;
  const moves = [];
  return {
    definition,
    moves,
    getLocation: () => tile,
    getId: () => id,
    moveTo: (to) => { tile = to; },
    exactMove: (to, options) => { tile = to; moves.push({ to, options }); },
    setNpcTransformationId: (next) => { id = next; },
  };
}

function telekineticEvent(player, npc, overrides = {}) {
  let runes = 0;
  const event = {
    player,
    npc,
    spellId: Telekinetic.TELEKINETIC_GRAB_SPELL_ID,
    handled: false,
    consumeRunes: () => { runes += 1; return true; },
    runes: () => runes,
    ...overrides,
  };
  return event;
}

test('every id resolves from the cache', () => {
  const { npcs, locs, items, interfaces } = Common.ids;
  assert.deepEqual([npcs.entranceGuardian, npcs.enchantmentGuardian, npcs.hat], [5978, 5981, 7512]);
  assert.deepEqual([locs.enchantPortal, locs.exit, locs.hole], [23674, 23677, 23698]);
  assert.deepEqual([locs.cubePile, locs.cylinderPile, locs.icosahedronPile, locs.pentamidPile], [23694, 23695, 23696, 23697]);
  assert.deepEqual([items.hatDull, items.hatEnergised, items.hatFull], [6885, 6886, 6887]);
  assert.deepEqual([items.cube, items.cylinder, items.icosahedron, items.pentamid, items.orb, items.dragonstone], [6899, 6898, 6900, 6901, 6902, 6903]);
  assert.deepEqual([interfaces.lobby, interfaces.enchanting], [553, 195]);
  assert.deepEqual([locs.telekineticPortal, locs.telekineticWalls, locs.telekineticFinish], [23673, 10755, 23672]);
  assert.deepEqual([npcs.telekineticGuardian, npcs.mazeGuardian, npcs.mazeGuardianMoving, npcs.mazeGuardianComplete], [5979, 6777, 6778, 6779]);
});

test('Pizazz Points stop at each type\'s cap', () => {
  const player = fakePlayer();
  assert.equal(Common.addPoints(player, 'enchantment', 31990), 31990);
  assert.equal(Common.addPoints(player, 'enchantment', 50), 10);
  assert.equal(Common.points(player, 'enchantment'), 32000);
  assert.match(player.messages.at(-1), /Enchantment/);
  assert.equal(Common.addPoints(player, 'telekinetic', 9000), 8000);
  assert.equal(Common.addPoints(player, 'telekinetic', -500), -500);
  assert.equal(Common.points(player, 'telekinetic'), 7500);
});

test('the hat brightens at 300 of every type, fills at 600, and dulls again when points are spent', () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  player.items.set(items.hatDull, 1);
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 300);
  assert.equal(player.items.get(items.hatEnergised), 1);
  assert.equal(player.items.get(items.hatDull), 0);
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 300);
  assert.equal(player.items.get(items.hatFull), 1);
  Common.addPoints(player, 'graveyard', -400);
  assert.equal(player.items.get(items.hatDull), 1);
  assert.equal(player.items.get(items.hatFull), 0);
});

test('the Entrance Guardian gives the hat if there is room, and again once it is lost', () => {
  const player = fakePlayer(3363, 3303);
  const npcId = Common.ids.npcs.entranceGuardian;
  assert.equal(Guardians.variant({ player, npcId }), null);
  player.setFree(0);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player does not have inventory space:' }), true);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has inventory space:' }), false);
  player.setFree(5);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has inventory space:' }), true);
  const action = { player, npcId, action: 'receive', text: 'Progress hat', handled: false };
  Guardians.action(action);
  assert.equal(action.handled, true);
  assert.equal(player.items.get(Common.ids.items.hatDull), 1);
  assert.equal(Guardians.variant({ player, npcId }), Guardians.AFTER_HAT);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player already owns a progress hat:' }), true);
  player.items.set(Common.ids.items.hatDull, 0);
  assert.equal(Guardians.condition({ player, npcId, text: 'If the player has destroyed or lost their progress hat:' }), true);
  assert.equal(Guardians.condition({ player, npcId: 1, text: 'If the player has inventory space:' }), null, 'other NPCs are left alone');
});

test("the hat reads out the four totals in the transcript's blanks", () => {
  const player = fakePlayer();
  Common.addPoints(player, 'telekinetic', 12);
  Common.addPoints(player, 'alchemist', 1500);
  Common.addPoints(player, 'enchantment', 7);
  const request = { player, npcId: Common.ids.npcs.hat, text: 'Ok, I suppose it\'s my job. You have: [number] Telekinetic, [number] Alchemist, [number] Enchantment, and [number] Graveyard Pizazz Points.' };
  Guardians.line(request);
  assert.equal(request.text, 'Ok, I suppose it\'s my job. You have: 12 Telekinetic, 1,500 Alchemist, 7 Enchantment, and 0 Graveyard Pizazz Points.');
  events = [];
  assert.equal(Guardians.talkToHat({ player }), true);
  assert.equal(events[0][0], 'npc-dialogue:start');
  assert.equal(events[0][1].npcId, Common.ids.npcs.hat);
});

test('the Enchanters Teleport needs Magic 7; the Exit Teleport leads back to the hall', () => {
  const player = fakePlayer(3360, 3317);
  player.magic = 6;
  Lobby.enterEnchanting({ player, objectId: Common.ids.locs.enchantPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 7, room: 'Enchanting Chamber' }));
  assert.equal(player.getLocation().getY(), 3317);
  player.magic = 7;
  Lobby.enterEnchanting({ player, objectId: Common.ids.locs.enchantPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], Common.data.enchanting.arrive);
  Lobby.exit({ player, objectId: Common.ids.locs.exit });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], Common.data.lobby.arrive);
  assert.equal(Lobby.exit({ player, objectId: 1 }), false);
});

test('each pile gives its shape, 1 in 32 a dragonstone; nothing with a full pack', () => {
  const player = fakePlayer();
  const { locs, items } = Common.ids;
  Enchanting.takeFromPile({ player, objectId: locs.pentamidPile }, () => 0.5);
  assert.equal(player.items.get(items.pentamid), 1);
  Enchanting.takeFromPile({ player, objectId: locs.cubePile }, () => 0.01);
  assert.equal(player.items.get(items.dragonstone), 1);
  player.setFree(0);
  Enchanting.takeFromPile({ player, objectId: locs.cubePile }, () => 0.5);
  assert.equal(player.items.get(items.cube) ?? 0, 0);
  assert.equal(player.messages.at(-1), Common.message('inventoryFull'));
});

test('enchant points: the spell level, doubled every 10th shape, +2 on the bonus shape, double for a dragonstone', () => {
  assert.equal(Enchanting.enchantPoints(4, { count: 3, bonus: false }), 4);
  assert.equal(Enchanting.enchantPoints(4, { count: 10, bonus: false }), 8);
  assert.equal(Enchanting.enchantPoints(4, { count: 3, bonus: true }), 6);
  assert.equal(Enchanting.enchantPoints(4, { count: 20, bonus: true }), 10);
  assert.equal(Enchanting.enchantPoints(7, { dragonstone: true }), 14);
});

test('an enchant in the chamber turns the shape into an orb with the spell\'s runes and XP', () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  player.items.set(items.cube, 1);
  player.slots = [null, { getId: () => items.cube }];
  let runesSpent = 0;
  const spell = { canCast: () => { runesSpent += 1; return true; }, baseExperience: () => 67, data: { animation: 719, graphic: 153, sound: 137 } };
  Enchanting.chamber.bonus = 'cube';
  const event = { player, spell, spellName: 'Lvl-4 Enchant', itemId: items.cube, slot: 1, handled: false };
  Enchanting.enchantShape(event);
  assert.equal(event.handled, true);
  assert.equal(runesSpent, 1);
  assert.equal(player.items.get(items.cube), 0);
  assert.equal(player.items.get(items.orb), 1);
  assert.deepEqual(player.xp, [67]);
  assert.equal(Common.points(player, 'enchantment'), 6, '4 for the spell, +2 for the bonus cube');
  assert.equal(player.strings.get(Common.ids.components.enchantPoints), '6');
  assert.equal(player.hidden.get(Common.ids.components.bonusCube), false);
  assert.equal(player.hidden.get(Common.ids.components.bonusPentamid), true);

  const outside = fakePlayer(3200, 3200);
  outside.items.set(items.cube, 1);
  const elsewhere = { player: outside, spell, spellName: 'Lvl-4 Enchant', itemId: items.cube, slot: 1, handled: false };
  Enchanting.enchantShape(elsewhere);
  assert.equal(elsewhere.handled, false, 'outside the chamber the jewellery spell says it can\'t');
});

test('the hole takes every orb for 20 XP each; 3 runes for every 20, given on leaving', () => {
  const player = fakePlayer();
  const { items, locs } = Common.ids;
  player.items.set(items.orb, 45);
  Enchanting.deposit({ player, objectId: locs.hole });
  assert.equal(player.items.get(items.orb), 0);
  assert.deepEqual(player.xp, [900]);
  const given = Enchanting.payRunes(player, () => 0);
  assert.deepEqual(given, { blood: 6 });
  assert.equal(player.items.get(Common.ids.items.blood), 6);
  assert.deepEqual(Enchanting.payRunes(player), {}, 'paid once');
});

test("leaving clears the room's items before the runes, so a full pack still gets them; logging out keeps both", () => {
  const Area = Enchanting.defineArea();
  const area = new Area();
  const { items } = Common.ids;
  const player = fakePlayer();
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  player.items.set(items.cube, 27);
  player.setAttribute(Enchanting.ORBS_ATTRIBUTE, 40);
  const inventory = player.getInventory();
  inventory.getFreeSlots = () => (player.items.get(items.cube) > 0 ? 0 : 27);
  player.getInventory = () => inventory;
  area.postLeave(player, true);
  assert.equal(player.items.get(items.cube), 27, 'logout keeps the shapes');
  assert.equal(player.getAttribute(Enchanting.ORBS_ATTRIBUTE), 40, 'and the orbs counted');
  area.postLeave(player, false);
  assert.equal(player.items.get(items.cube), 0);
  const runes = ['blood', 'death', 'cosmic'].reduce((sum, rune) => sum + (player.items.get(items[rune]) ?? 0), 0);
  assert.equal(runes, 6, 'two rewards of 3 runes, in the pack');
  assert.equal(player.getAttribute(Enchanting.ORBS_ATTRIBUTE), 0);
});

test("the room's shapes, orbs and dragonstones never leave it", () => {
  const player = fakePlayer();
  const { items } = Common.ids;
  for (const id of [items.cube, items.cylinder, items.icosahedron, items.pentamid, items.orb, items.dragonstone]) player.items.set(id, 2);
  player.items.set(564, 50);
  assert.equal(Enchanting.removeRoomItems(player), 12);
  assert.equal(player.items.get(564), 50);
});

test('the bonus shape always changes to a different one', () => {
  Enchanting.chamber.bonus = 'cube';
  Enchanting.rotateBonus(() => 0);
  assert.notEqual(Enchanting.chamber.bonus, 'cube');
  const previous = Enchanting.chamber.bonus;
  Enchanting.rotateBonus(() => 0.99);
  assert.notEqual(Enchanting.chamber.bonus, previous);
});

test('the jewellery enchant spells offer other items to the arena before refusing them', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'skills', 'Spells.EnchantJewellery.js'), 'utf8');
  assert.match(source, /emitCustomEvent\("magic:enchant-item"/);
});

// --- The Telekinetic Theatre

test('the ten Telekinetic mazes keep the Wiki/capture starts, goals and arrivals', () => {
  const mazes = Common.data.telekinetic.mazes;
  assert.equal(mazes.length, 10);
  assert.equal(new Set(mazes.map((maze) => maze.goal.join(','))).size, 10);
  for (const maze of mazes) {
    const [minX, maxX, minY, maxY] = maze.walls;
    const [sx, sy, sz] = maze.start;
    const [gx, gy, gz] = maze.goal;
    const [ax, ay, az] = maze.arrive;
    assert.ok(sx > minX && sx < maxX && sy > minY && sy < maxY, `start inside ${maze.walls}`);
    assert.ok(gx >= minX + 1 && gx <= maxX - 1 && gy >= minY + 1 && gy <= maxY - 1, `goal inside ${maze.walls}`);
    assert.equal(sz, gz);
    assert.equal(az, gz);
    assert.ok(Number.isInteger(ax) && Number.isInteger(ay));
  }
  const startFor = (goal) => mazes.find((maze) => maze.goal.join(',') === goal).start;
  assert.deepEqual(startFor('3339,9683,2'), [3348, 9674, 2]);
  assert.deepEqual(startFor('3347,9714,0'), [3343, 9705, 0]);
  assert.deepEqual(startFor('3341,9708,1'), [3350, 9717, 1]);
  assert.deepEqual(startFor('3353,9680,1'), [3351, 9684, 1]);
  assert.deepEqual(startFor('3345,9718,2'), [3346, 9718, 2]);
});

test('the statue slides away from the caster until a maze wall stops it; a corner wastes the cast', () => {
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3328, 9664, false);
  const maze = Common.data.telekinetic.mazes.find((entry) => entry.goal.join(',') === '3339,9683,2');
  assert.deepEqual(Telekinetic.directionFor(loc(3340, 9684, 2), maze.walls), [0, 1]);
  assert.deepEqual(Telekinetic.directionFor(loc(3338, 9678, 2), maze.walls), [-1, 0]);
  assert.deepEqual(Telekinetic.directionFor(loc(3343, 9673, 2), maze.walls), [0, -1]);
  assert.deepEqual(Telekinetic.directionFor(loc(3349, 9678, 2), maze.walls), [1, 0]);
  assert.equal(Telekinetic.directionFor(loc(3338, 9684, 2), maze.walls), null, 'corner');

  let at = loc(...maze.start);
  for (const direction of [[0, 1], [-1, 0], [0, -1], [-1, 0], [0, 1], [-1, 0], [0, -1], [-1, 0], [0, 1]]) {
    at = Telekinetic.slide(at, direction);
  }
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], maze.goal);
});

test('the Telekinetic Teleport needs Magic 33, starts one session, and leaving clears it', () => {
  const spawned = [];
  const removed = [];
  testApi.spawnNpc = (definition) => {
    const npc = fakeNpc(definition);
    spawned.push(npc);
    return npc;
  };
  testApi.removeNpc = (npc) => removed.push(npc);
  const player = fakePlayer(3363, 3318, 0);
  player.magic = 32;
  Telekinetic.enter(player);
  assert.equal(player.messages.at(-1), Common.message('level', { level: 33, room: 'Telekinetic Theatre' }));
  assert.equal(spawned.length, 0);

  player.magic = 33;
  const original = Math.random;
  Math.random = () => 0;
  try {
    Telekinetic.enter(player);
  } finally {
    Math.random = original;
  }
  const maze = Common.data.telekinetic.mazes[0];
  assert.equal(spawned.length, 1);
  assert.deepEqual([spawned[0].getLocation().getX(), spawned[0].getLocation().getY(), spawned[0].getLocation().getZ()], maze.start);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], maze.arrive);
  assert.equal(player.messages.at(-1), Common.message('telekineticEntered'));

  Telekinetic.enter(player);
  assert.equal(spawned.length, 1, 'a second entry joins the existing session');
  Telekinetic.removeSession(player);
  assert.equal(removed[0], spawned[0]);
  assert.equal(Telekinetic.sessionOf(player), null);
});

test('Telekinetic Grab slides the guardian and a solved maze awards its points once', () => {
  const spawned = [];
  testApi.spawnNpc = (definition) => {
    const npc = fakeNpc(definition);
    spawned.push(npc);
    return npc;
  };
  testApi.removeNpc = () => {};
  const player = fakePlayer();
  const session = Telekinetic.startSession(player, 8);
  const npc = session.npc;
  player.moveTo(loc(3340, 9684, 2));
  const pending = [];
  const originalLater = Common.later;
  Common.later = (ticks, action) => pending.push({ ticks, action });
  try {
    const event = telekineticEvent(player, npc);
    Telekinetic.castTelekinetic(event);
    assert.equal(event.handled, true);
    assert.equal(event.runes(), 1);
    assert.equal(player.anims, 1);
    assert.equal(npc.getId(), Common.ids.npcs.mazeGuardianMoving);
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY(), npc.getLocation().getZ()], [3348, 9683, 2]);
    assert.equal(pending[0].ticks, 5);
    pending.shift().action();
    assert.equal(npc.getId(), Common.ids.npcs.mazeGuardian);

    player.moveTo(loc(3338, 9684, 2));
    const corner = telekineticEvent(player, npc);
    Telekinetic.castTelekinetic(corner);
    assert.equal(corner.runes(), 1);
    assert.equal(pending.length, 0, 'a corner cast does not move the statue');
    assert.deepEqual([npc.getLocation().getX(), npc.getLocation().getY()], [3348, 9683]);

    session.solved = true;
    const again = telekineticEvent(player, npc);
    Telekinetic.castTelekinetic(again);
    assert.equal(again.handled, true);
    assert.equal(again.runes(), 0, 'a finished maze does not consume another cast');
  } finally {
    Common.later = originalLater;
    Telekinetic.removeSession(player);
  }
});

test('each maze gives 2 points and 250 XP; every fifth gives the 8-point, rune and energy bonus', () => {
  testApi.spawnNpc = (definition) => fakeNpc(definition);
  testApi.removeNpc = () => {};
  const player = fakePlayer();
  const session = Telekinetic.startSession(player, 8);
  Telekinetic.complete(session);
  assert.equal(Common.points(player, 'telekinetic'), 2);
  assert.deepEqual(player.xp, [250]);
  assert.equal(player.strings.get(Telekinetic.pointsComponent()), '2');
  assert.equal(player.strings.get(Telekinetic.streakComponent()), '1');
  assert.equal(player.messages.at(-1), Common.message('mazeComplete', { points: 2 }));

  for (let i = 0; i < 4; i++) Telekinetic.complete(session);
  assert.equal(Common.points(player, 'telekinetic'), 18, 'five mazes plus the 8-point bonus');
  assert.equal(player.xp.reduce((sum, value) => sum + value, 0), 2250);
  assert.equal(player.items.get(Common.ids.items.law), 10);
  assert.equal(player.getRunEnergy(), 100);
  assert.equal(player.getAttribute(Telekinetic.STREAK_ATTRIBUTE), 0);
  assert.equal(player.strings.get(Telekinetic.pointsComponent()), '18');
  assert.equal(player.strings.get(Telekinetic.streakComponent()), '0');
  assert.equal(player.messages.at(-1), Common.message('mazeBonus', { points: 8, runes: 10 }));
  Telekinetic.removeSession(player);
});

test('Reset returns the statue and keeps the streak; New-maze moves to the next arena', () => {
  const spawned = [];
  const removed = [];
  testApi.spawnNpc = (definition) => {
    const npc = fakeNpc(definition);
    spawned.push(npc);
    return npc;
  };
  testApi.removeNpc = (npc) => removed.push(npc);
  const player = fakePlayer();
  const session = Telekinetic.startSession(player, 0);
  const npc = session.npc;
  player.setAttribute(Telekinetic.STREAK_ATTRIBUTE, 3);
  Telekinetic.removeSession(player);
  assert.equal(removed[0], npc);
  assert.equal(player.getAttribute(Telekinetic.STREAK_ATTRIBUTE), 3, 'leaving keeps the streak');

  const next = Telekinetic.startSession(player, 0);
  player.moveTo(loc(3350, 9690, 0));
  next.npc.moveTo(loc(3347, 9678, 0));
  Telekinetic.reset({ player, npc: next.npc });
  assert.deepEqual([next.npc.getLocation().getX(), next.npc.getLocation().getY(), next.npc.getLocation().getZ()], Common.data.telekinetic.mazes[0].start);
  assert.equal(next.npc.getId(), Common.ids.npcs.mazeGuardian);

  next.solved = true;
  const before = spawned.length;
  const original = Math.random;
  Math.random = () => 0;
  try {
    Telekinetic.newMaze({ player, npc: next.npc });
  } finally {
    Math.random = original;
  }
  assert.equal(removed.at(-1), next.npc);
  assert.equal(spawned.length, before + 1);
  const following = Common.data.telekinetic.mazes[1];
  assert.deepEqual([spawned.at(-1).getLocation().getX(), spawned.at(-1).getLocation().getY(), spawned.at(-1).getLocation().getZ()], following.start);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], following.arrive);
  assert.equal(Telekinetic.sessionOf(player).mazeIndex, 1);
  Telekinetic.removeSession(player);
});

test('Telekinetic Grab awards the live 43 XP, not the old effect-spell value', () => {
  assert.equal(core.EffectSpells.TELEKINETIC_GRAB.baseExperience(), 43);
});

test('Observe, Reset and New-maze reach the Maze Guardian from outside its maze walls', () => {
  const hooks = {};
  const api = new Proxy({ core, persistAttribute: () => {} }, {
    get: (target, key) => target[key] ?? ((handler) => { hooks[key] = handler; }),
  });
  Telekinetic.attach(api);
  assert.equal(typeof hooks.onNpcRoute, 'function', 'the room registers a route override');

  const route = (npcId) => {
    const event = { player: fakePlayer(), npc: { getId: () => npcId }, npcId, range: 1, ignoreProjectileClip: false, handled: false };
    hooks.onNpcRoute(event);
    return event;
  };

  // Every maze room starts the player outside the walls, so a one-tile approach would stop short.
  const furthest = Math.max(...Common.data.telekinetic.mazes.map(({ arrive: [ax, ay], start: [sx, sy] }) =>
    Math.max(Math.abs(ax - sx), Math.abs(ay - sy))));
  assert.ok(furthest > 1);
  for (const npcId of [Common.ids.npcs.mazeGuardian, Common.ids.npcs.mazeGuardianComplete]) {
    const event = route(npcId);
    assert.ok(event.range > furthest, `guardian ${npcId} is reached from the furthest arrival tile`);
    assert.equal(event.ignoreProjectileClip, true);
  }
  const other = route(Common.ids.npcs.telekineticGuardian);
  assert.equal(other.range, 1, 'other NPCs keep the ordinary approach range');
  assert.equal(other.ignoreProjectileClip, false);
});

test('Observe frames the active maze, not the one room the capture visited', () => {
  testApi.spawnNpc = (definition) => fakeNpc(definition);
  testApi.removeNpc = () => {};
  const shot = (index) => {
    const player = fakePlayer();
    const session = Telekinetic.startSession(player, index);
    assert.equal(Telekinetic.observe({ player, npc: session.npc }), true);
    const calls = player.camera.slice();
    Telekinetic.removeSession(player);
    return {
      maze: session.maze,
      calls,
      look: calls.find((call) => call.mode === 'look'),
      move: calls.find((call) => call.mode === 'move'),
    };
  };

  // The capture's only Observe is in maze 1: it looks at (3342,9716) from (3342,9717).
  const captured = shot(1);
  assert.deepEqual([captured.look.x, captured.look.y], [3342, 9716]);
  assert.deepEqual([captured.move.x, captured.move.y, captured.move.height], [3342, 9717, 2275]);
  assert.deepEqual(captured.calls.map((call) => call.mode), ['move', 'look'], 'the look angle comes from the new camera position');

  const shots = Common.data.telekinetic.mazes.map((_, index) => shot(index));
  for (const [index, { maze, look, move }] of shots.entries()) {
    const [minX, maxX, , maxY] = maze.walls;
    const x = Math.floor((minX + maxX) / 2);
    assert.deepEqual([look.x, look.y], [x, maxY + 1], `maze ${index} looks at its own south edge`);
    assert.deepEqual([move.x, move.y, move.height], [x, maxY + 2, 2275], `maze ${index} is viewed from its own south side`);
  }

  const near = shots[0];
  const far = shots[6];
  assert.ok(Math.abs(far.move.y - near.move.y) > 30, 'two distant mazes get different camera positions');
  assert.notDeepEqual([near.move.x, near.move.y], [3342, 9717], 'maze 0 no longer uses maze 1 camera');
  assert.notDeepEqual([far.move.x, far.move.y], [3342, 9717], 'maze 6 no longer uses maze 1 camera');
});

// --- The Alchemists' Playground

const playgroundTile = () => Common.data.alchemists.arrive;

test('the cupboards hold the five items and an empty one in a fixed order, turning between cupboards', () => {
  Alchemists.playground.offset = 0;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(Alchemists.cupboardItem), ['boots', 'kiteshield', 'helm', 'emerald', 'longsword', null]);
  Alchemists.playground.offset = 2;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(Alchemists.cupboardItem), ['longsword', null, 'boots', 'kiteshield', 'helm', 'emerald']);
});

test('every change gives the five items the values 1, 5, 8, 15 and 30, and sometimes a free one', () => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let frees = 0;
  for (let i = 0; i < 30; i++) {
    Alchemists.change(random);
    assert.deepEqual(Object.values(Alchemists.playground.values).sort((a, b) => a - b), [1, 5, 8, 15, 30]);
    if (Alchemists.playground.free) frees += 1;
  }
  assert.ok(frees > 0 && frees < 30);
});

test('Search takes one, Take-5 up to five as room allows; the empty cupboard says so; other cupboards are left alone', () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { locs, items } = Common.ids;
  Alchemists.playground.offset = 0;
  Alchemists.takeFrom(player, locs.cupboard0, false);
  assert.equal(player.items.get(items.boots), 1);
  player.setFree(3);
  Alchemists.takeFrom(player, locs.cupboard4, true);
  assert.equal(player.items.get(items.longsword), 3);
  Alchemists.takeFrom(player, locs.cupboard5, true);
  assert.equal(player.messages.at(-1), Common.message('cupboardEmpty'));
  assert.equal(Alchemists.takeFrom(player, 1, true), false);
});

test("alching the room's items pays this turn's value in arena coins; the free one takes no runes", () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  Alchemists.playground.values = { boots: 30, kiteshield: 1, helm: 5, emerald: 8, longsword: 15 };
  Alchemists.playground.free = 'boots';
  const policy = { player, itemId: items.boots, spellId: 55, allowed: false, coins: 12 };
  Alchemists.alchemyPolicy(policy);
  assert.equal(policy.allowed, true);
  assert.equal(policy.coins, 0, 'no real coins');
  const bypass = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(bypass);
  assert.equal(bypass.bypass, true);
  const otherSpell = { player, spellId: 14, runeId: 561, bypass: null };
  Alchemists.runeBypass(otherSpell);
  assert.equal(otherSpell.bypass, null, 'only the alchemy just allowed');
  Alchemists.alchemyCompleted({ player, itemId: items.boots });
  assert.equal(player.items.get(items.arenaCoins), 30);
  const again = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(again);
  assert.equal(again.bypass, null, 'and only once');

  const paid = { player, itemId: items.helm, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(paid);
  const runes = { player, spellId: 55, runeId: 561, bypass: null };
  Alchemists.runeBypass(runes);
  assert.equal(runes.bypass, null);

  const outside = fakePlayer(3200, 3200, 0);
  const elsewhere = { player: outside, itemId: items.boots, spellId: 55, allowed: false, coins: 0 };
  Alchemists.alchemyPolicy(elsewhere);
  assert.equal(elsewhere.allowed, false);
});

test('the Coin Collector: a point per 100 (the rest a chance of one more), 10 real coins per 100, 2 XP a coin', () => {
  const [x, y, z] = playgroundTile();
  const { items } = Common.ids;
  const banked = [];
  const player = fakePlayer(x, y, z);
  player.getBank = () => ({ contains: () => false, getAddableAmount: (item) => item.getAmount(), add: (item) => banked.push([item.getId(), item.getAmount()]) });
  player.items.set(items.arenaCoins, 250);
  assert.equal(Alchemists.depositCoins(player, () => 0.4), 3, '50% chance taken');
  assert.equal(player.items.get(items.arenaCoins), 0);
  assert.deepEqual(banked, [[items.coins, 20]]);
  assert.deepEqual(player.xp, [500]);
  assert.equal(Common.points(player, 'alchemist'), 3);
  player.items.set(items.arenaCoins, 250);
  assert.equal(Alchemists.depositCoins(player, () => 0.6), 2);
  ironmanMode = 'ultimate';
  const uim = fakePlayer(x, y, z);
  uim.items.set(items.arenaCoins, 100);
  Alchemists.depositCoins(uim, () => 0.9);
  assert.equal(uim.items.get(items.coins), 10, 'an Ultimate Ironman gets them in the pack');
  ironmanMode = 'none';
});

test('the Alchemists Teleport needs Magic 21 and no coins', () => {
  const player = fakePlayer(3363, 3319, 0);
  const { locs, items } = Common.ids;
  player.magic = 20;
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 21, room: "Alchemists' Playground" }));
  player.magic = 21;
  player.items.set(items.coins, 5);
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.equal(player.messages.at(-1), Common.message('noCoins'));
  player.items.set(items.coins, 0);
  Alchemists.enter({ player, objectId: locs.alchemistsPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], playgroundTile());
});

test("leaving pays the arena coins in first, then the room's items and coins are gone", () => {
  const Area = Alchemists.defineArea();
  const area = new Area();
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  player.getBank = () => ({ contains: () => false, getAddableAmount: (item) => item.getAmount(), add() {} });
  const { items } = Common.ids;
  player.items.set(items.arenaCoins, 300);
  player.items.set(items.emerald, 4);
  const before = Common.points(player, 'alchemist');
  area.postLeave(player, true);
  assert.equal(player.items.get(items.arenaCoins), 300, 'logging out keeps them');
  area.postLeave(player, false);
  assert.equal(Common.points(player, 'alchemist') - before, 3);
  assert.equal(player.items.get(items.arenaCoins), 0);
  assert.equal(player.items.get(items.emerald), 0);
});

test("a full bank can't swallow the Coin Collector's real coins: they go to the pack", () => {
  const [x, y, z] = playgroundTile();
  const { items } = Common.ids;
  const player = fakePlayer(x, y, z);
  player.getBank = () => ({ contains: () => false, getAddableAmount: () => 0, add() { throw new Error('nothing fits'); } });
  player.items.set(items.arenaCoins, 300);
  Alchemists.depositCoins(player, () => 0.9);
  assert.equal(player.items.get(items.coins), 30);
  assert.ok(!player.messages.some((m) => /added to your bank/.test(m)));
});

test('in the room an alchemy takes 5 ticks, Low Level Alchemy too; the core waits it out', () => {
  const [x, y, z] = playgroundTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  Alchemists.playground.values = { boots: 30, kiteshield: 1, helm: 5, emerald: 8, longsword: 15 };
  Alchemists.playground.free = null;
  const first = { player, itemId: items.emerald, spellId: 1162, allowed: false, coins: 0, castTicks: 3 };
  Alchemists.alchemyPolicy(first);
  assert.equal(first.allowed, true);
  assert.equal(first.castTicks, 5);
  Alchemists.alchemyCompleted({ player, itemId: items.emerald });
  // The next click isn't refused here: the core cast delay queues it until the 5 ticks are up.
  const second = { player, itemId: items.emerald, spellId: 1162, allowed: false, coins: 0, castTicks: 3 };
  Alchemists.alchemyPolicy(second);
  assert.equal(second.allowed, true);
  assert.equal(second.castTicks, 5);
});

// --- The Creature Graveyard

const graveyardTile = () => Common.data.graveyard.arrive;

test('each bone pile type gives its own kind, then the next kind after every four taken', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { locs, items } = Common.ids;
  for (let i = 0; i < 6; i++) Graveyard.grab({ player, objectId: locs.bonePile2 });
  assert.equal(player.items.get(items.bones2), 4);
  assert.equal(player.items.get(items.bones3), 2);
  for (let i = 0; i < 6; i++) Graveyard.grab({ player, objectId: locs.bonePile4 });
  assert.equal(player.items.get(items.bones4), 4);
  assert.equal(player.items.get(items.bones1), 2, 'kind 4 turns back to kind 1');
  assert.equal(Graveyard.grab({ player, objectId: 1 }), false);
});

test('Bones to Bananas turns every animals\' bone into its fruit, for one cast\'s runes and XP', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  player.items.set(items.bones1, 2);
  player.items.set(items.bones4, 3);
  player.setFree(10);
  let casts = 0;
  const event = { player, spellName: 'Bones to Bananas', handled: false };
  const Spell = core.Spell.prototype;
  const original = Spell.canCast;
  Spell.canCast = function () { casts += 1; return true; };
  try {
    Graveyard.castBonesSpell(event);
  } finally {
    Spell.canCast = original;
  }
  assert.equal(event.handled, true);
  assert.equal(casts, 1);
  assert.equal(player.items.get(items.banana), 14);
  assert.equal(player.items.get(items.bones1), 0);
  assert.equal(player.items.get(items.bones4), 0);
  assert.deepEqual(player.xp, [25]);
});

test('Bones to Peaches needs its unlock in the room; no bones, no cast', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const locked = { player, spellName: 'Bones to Peaches', handled: false };
  Graveyard.castBonesSpell(locked);
  assert.equal(locked.handled, true);
  assert.equal(player.messages.at(-1), Common.message('peachesLocked'));
  const empty = { player, spellName: 'Bones to Bananas', handled: false };
  Graveyard.castBonesSpell(empty);
  assert.equal(player.messages.at(-1), Common.message('noBones'));
  const outside = fakePlayer(3200, 3200, 0);
  const elsewhere = { player: outside, spellName: 'Bones to Bananas', handled: false };
  Graveyard.castBonesSpell(elsewhere);
  assert.equal(elsewhere.handled, false, 'outside the room the spell is the ordinary one');
});

test('the chute: a point per 16 fruit (a peach is 2), at most 3 a deposit, 5 XP a banana and 10 a peach', () => {
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  const { items } = Common.ids;
  player.items.set(items.banana, 20);
  assert.deepEqual(Graveyard.depositFruit(player, () => 0.2), { fruit: 20, points: 2 }, '20 bananas: 1 point and a 25% chance of a second');
  assert.deepEqual(player.xp, [100]);
  player.xp.length = 0;
  player.items.set(items.peach, 27);
  const most = Graveyard.depositFruit(player, () => 0.9);
  assert.deepEqual(most, { fruit: 54, points: 3 }, '27 peaches count as 24 (Wiki)');
  assert.equal(player.items.get(items.peach), 0, 'all of them go in');
  assert.deepEqual(player.xp, [270], 'and give XP');
  assert.equal(Graveyard.depositFruit(fakePlayer(x, y, z)), null);
});

test('every Graveyard point earns a rune, given on leaving; logging out keeps the room\'s things', () => {
  const Area = Graveyard.defineArea();
  const area = new Area();
  const [x, y, z] = graveyardTile();
  const player = fakePlayer(x, y, z);
  player.isPlayer = () => true;
  player.getAsPlayer = () => player;
  const { items } = Common.ids;
  player.items.set(items.banana, 32);
  Graveyard.depositFruit(player, () => 0.9);
  player.items.set(items.bones2, 3);
  area.postLeave(player, true);
  assert.equal(player.items.get(items.bones2), 3);
  assert.equal(player.getAttribute(Graveyard.RUNES_OWED_ATTRIBUTE), 2);
  area.postLeave(player, false);
  assert.equal(player.items.get(items.bones2), 0);
  const runes = Common.data.graveyard.rewardRunes.reduce((sum, rune) => sum + (player.items.get(items[rune]) ?? 0), 0);
  assert.equal(runes, 2);
  assert.equal(player.getAttribute(Graveyard.RUNES_OWED_ATTRIBUTE), 0);
});

test('the Graveyard Teleport needs Magic 15, and no fruit or bones', () => {
  const player = fakePlayer(3365, 3318, 0);
  player.magic = 14;
  Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
  assert.equal(player.messages.at(-1), Common.message('level', { level: 15, room: 'Creature Graveyard' }));
  player.magic = 15;
  for (const key of ['peach', 'banana', 'bones']) {
    player.items.set(Common.ids.items[key], 2);
    Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
    assert.equal(player.messages.at(-1), Common.message('noFruitIn'), key);
    assert.equal(player.items.get(Common.ids.items[key]), 2, 'and nothing of theirs is taken');
    player.items.set(Common.ids.items[key], 0);
  }
  Graveyard.enter({ player, objectId: Common.ids.locs.graveyardPortal });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], graveyardTile());
});

// --- The Rewards Guardian's shop

function shopPlayer() {
  const player = fakePlayer(3362, 3318, 1);
  player.getEquipment = () => ({ get: () => null, set() {}, refreshItems() {} });
  player.varbitsSent = [];
  player.getPacketSender = () => ({ sendConfig() {}, sendSubInterface() {}, sendInterfaceFlagsRange() {}, sendString() {}, sendInterfaceDisplayState() {},
    sendVarbit: (id, value) => player.varbitsSent.push([id, value]), isSubInterfaceOpen: () => player.shopOpen !== false });
  player.setAttribute(Common.HAT_GIVEN_ATTRIBUTE, true);
  return player;
}

const slotOf = (itemId) => Rewards.stock().indexOf(itemId);

test("the shop's stock and prices come from the cache, matching the Wiki's table", () => {
  const stock = Rewards.stock();
  assert.equal(stock.length, 25);
  assert.deepEqual(stock.slice(0, 11), [6908, 6910, 6912, 6914, 6916, 6918, 6920, 6922, 6924, 6889, 6926]);
  assert.deepEqual(Rewards.price(6918), { telekinetic: 350, graveyard: 350, enchantment: 3000, alchemist: 400 }, 'Infinity hat');
  assert.deepEqual(Rewards.price(6889), { telekinetic: 500, graveyard: 500, enchantment: 6000, alchemist: 550 }, "Mage's book");
  assert.deepEqual(Rewards.price(6926), { telekinetic: 200, graveyard: 200, enchantment: 2000, alchemist: 300 }, 'Bones to Peaches');
  assert.deepEqual(Rewards.price(560), { telekinetic: 2, graveyard: 1, enchantment: 20, alchemist: 1 }, 'death rune');
  assert.equal(Rewards.previousWand(6914), 6912, 'master needs teacher');
  assert.equal(Rewards.previousWand(6908), null);
});

test('runes: as many as every type pays for, and the points go down by the price', () => {
  const player = shopPlayer();
  Common.addPoints(player, 'telekinetic', 20);
  Common.addPoints(player, 'alchemist', 20);
  Common.addPoints(player, 'enchantment', 100);
  Common.addPoints(player, 'graveyard', 20);
  assert.equal(Rewards.buy(player, slotOf(560), 10), 5, 'enchantment 20 each allows 5');
  assert.equal(player.items.get(560), 5);
  assert.deepEqual(Common.POINT_TYPES.map((type) => Common.points(player, type)), [10, 15, 0, 15]);
  assert.equal(Rewards.buy(player, slotOf(6918), 1), 0);
  assert.equal(player.messages.at(-1), Common.message('shopTooPoor'));
});

test('wands are upgrades: each takes the tier before it', () => {
  const player = shopPlayer();
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 5000);
  assert.equal(Rewards.buy(player, slotOf(6910), 1), 0);
  assert.equal(player.messages.at(-1), Common.message('shopNeedWand', { wand: 'Beginner wand' }));
  assert.equal(Rewards.buy(player, slotOf(6908), 1), 1);
  assert.equal(Rewards.buy(player, slotOf(6910), 1), 1);
  assert.equal(player.items.get(6908), 0, 'the beginner wand is handed in');
  assert.equal(player.items.get(6910), 1);
});

test('Bones to Peaches is a one-time unlock needing Magic 60, read by the Graveyard', () => {
  const player = shopPlayer();
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 5000);
  player.magic = 59;
  assert.equal(Rewards.buy(player, slotOf(6926), 1), 0);
  assert.equal(player.messages.at(-1), Common.message('shopPeachesLevel'));
  player.magic = 60;
  assert.equal(Rewards.buy(player, slotOf(6926), 5), 1);
  assert.equal(player.getAttribute(Common.PEACHES_UNLOCKED_ATTRIBUTE), true);
  assert.equal(player.items.get(6926) ?? 0, 0, 'no item, an unlock');
  assert.equal(Rewards.buy(player, slotOf(6926), 1), 0);
  assert.equal(player.messages.at(-1), Common.message('shopAlreadyUnlocked'));
});

test('the rune pouch only for a player without one', () => {
  const player = shopPlayer();
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 5000);
  const pouch = Common.ids.items.runePouch;
  assert.equal(Rewards.buy(player, slotOf(pouch), 3), 1);
  assert.equal(Rewards.buy(player, slotOf(pouch), 1), 0);
  assert.equal(player.messages.at(-1), Common.message('shopHavePouch'));
});

test('the guardian sends players without a hat to the Entrance Guardian', () => {
  const player = shopPlayer();
  const npcId = Common.ids.npcs.rewardsGuardian;
  assert.equal(Rewards.variant({ player, npcId }), null);
  player.setAttribute(Common.HAT_GIVEN_ATTRIBUTE, false);
  assert.equal(Rewards.variant({ player, npcId }), Rewards.NO_HAT_VARIANT);
  Rewards.tradeWith({ player, npc: { getId: () => npcId } });
  assert.equal(player.messages.at(-1), Common.message('rewardsNoHat'));
});

test('Select, a quantity and Confirm buy through the interface', () => {
  const player = shopPlayer();
  for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 5000);
  Rewards.open(player);
  const selection = Common.ids.varbits.shopSelection;
  assert.deepEqual(player.varbitsSent.at(-1), [selection, 63], 'nothing selected');
  Rewards.rewardClicked({ player, slot: slotOf(565), opId: 1 });
  assert.deepEqual(player.varbitsSent.at(-1), [selection, slotOf(565)]);
  Rewards.quantity(10)({ player });
  Rewards.confirm({ player });
  assert.equal(player.items.get(565), 10);
  Rewards.quantity(10)({ player });
  Rewards.rewardClicked({ player, slot: slotOf(564), opId: 1 });
  Rewards.confirm({ player });
  assert.equal(player.items.get(564), 1, 'a new selection is x1, as the client shows');
  Rewards.rewardClicked({ player, slot: slotOf(564), opId: 1 });
  Rewards.quantity(Common.data.shop.mostAtOnce)({ player });
  Rewards.confirm({ player });
  assert.equal(player.items.get(564), 29, 'the fourth button is 28');
  player.shopOpen = false;
  Rewards.confirm({ player });
  assert.equal(player.items.get(564), 29, 'nothing bought with the shop closed');
});

test('training-room deaths keep real gear and Hardcore status, clean room items and respawn in the hall', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
  const { GameConstants } = require('../dist/game/GameConstants');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const areas = [];
  const api = PluginManager.createApi('MageTrainingArenaDeathRegression');
  const registerArea = api.registerArea;
  api.registerArea = (area) => { areas.push(area); registerArea(area); };
  const deaths = new Map();
  api.onPlayerDeath((event) => deaths.set(event.player, event));
  const Ironman = require('../plugins/modes/ironman/Common.Ironman');
  Ironman.init(api);
  require('../plugins/modes/ironman/Hardcore.Ironman')(api);
  require('../plugins/minigames/MageTrainingArena.plugin').register(api);
  t.mock.method(ItemOnGroundManager, 'registerLocation', () => {});
  t.mock.method(core.TaskManager, 'submit', () => {});
  const saves = [];
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, 'requestSave', (player, reason) => {
    saves.push({ player, reason, location: player.getLocation().clone(), items: player.getInventory().getValidItems().map((item) => item.getId()) });
  });
  const roomData = Object.entries(Common.data).filter(([key, room]) => key !== 'lobby' && room?.bounds && room?.arrive);
  for (const [name, room] of roomData) await t.test(name, (t) => {
    const player = new Player(null, Common.toLocation(room.arrive));
    player.setUsername('mta_safe_death');
    player.setRegistered(true);
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
    t.mock.method(player, 'sendMessage', () => {});
    t.after(() => player.setRegistered(false));
    player.setAttribute('ironman:mode', 'hardcore');
    const area = areas.find((area) => area.getBoundaries().some((bounds) => bounds.inside(player.getLocation())));
    assert.ok(area, 'the native plugin registered this room');
    area.enter(player);
    player.setArea(area);
    const carried = [556, 557, 558, 559];
    for (const id of carried) player.getInventory().adds(id, 100);
    player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(1155, 1));
    const roomItem = { enchanting: Common.ids.items.cube, alchemists: Common.ids.items.arenaCoins, graveyard: Common.ids.items.banana }[name];
    player.getInventory().adds(roomItem, 1);
    const task = new PlayerDeathTask(player);
    task.execute();
    task.execute();
    task.execute();
    assert.equal(deaths.get(player)?.itemsLost, false);
    assert.equal(Ironman.modeOf(player), 'hardcore');
    for (const id of carried) assert.equal(player.getInventory().getAmount(id), 100);
    assert.equal(player.getEquipment().get(core.Equipment.HEAD_SLOT).getId(), 1155);
    assert.equal(player.getInventory().getAmount(roomItem), 0, 'room-only items are cleaned before the respawn save');
    assert.equal(area.hasMember(player), false);
    assert.equal(player.getArea(), null);
    assert.deepEqual([player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()], Common.data.lobby.arrive);
    const saved = saves.findLast((save) => save.player === player && save.reason === 'respawn');
    assert.ok(saved);
    assert.equal(saved.items.includes(roomItem), false);
  });
  const outside = new Player(null, loc(3200, 3200));
  assert.equal(PluginManager.emitShouldDropItemsOnDeath(outside, null), null, 'normal deaths keep their existing policy');
});

test('native reward purchases charge only what fits in real rune stacks and freed wand slots', async (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  function shopper(t) {
    const player = new Player(null, loc(3362, 3318, 1));
    player.setUsername('mta_shop_limit');
    player.setRegistered(true);
    t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
    t.mock.method(player, 'sendMessage', () => {});
    t.after(() => player.setRegistered(false));
    player.setAttribute(Common.HAT_GIVEN_ATTRIBUTE, true);
    for (const type of Common.POINT_TYPES) Common.addPoints(player, type, 1000);
    return player;
  }
  const id = Common.ids.items.death;
  for (const room of [0, 3]) await t.test(`rune stack with ${room} spaces left`, (t) => {
    const player = shopper(t);
    player.getInventory().adds(id, 0x7fffffff - room);
    const before = Common.POINT_TYPES.map((type) => Common.points(player, type));
    const cost = Rewards.price(id);
    Rewards.open(player);
    Rewards.select({ player, slot: slotOf(id) });
    Rewards.quantity(10)({ player });
    Rewards.confirm({ player });
    assert.equal(player.getInventory().getAmount(id), 0x7fffffff);
    const after = Common.POINT_TYPES.map((type, i) => before[i] - (cost[type] ?? 0) * room);
    assert.deepEqual(Common.POINT_TYPES.map((type) => Common.points(player, type)), after);
    Rewards.confirm({ player });
    assert.deepEqual(Common.POINT_TYPES.map((type) => Common.points(player, type)), after, 'a full stack cannot charge again');
  });
  await t.test('wand upgrade uses the old wand slot in a full inventory', (t) => {
    const player = shopper(t);
    const beginner = core.ItemIdentifiers.BEGINNER_WAND;
    const apprentice = core.ItemIdentifiers.APPRENTICE_WAND;
    player.getInventory().adds(beginner, 1);
    player.getInventory().adds(core.ItemIdentifiers.BRONZE_FULL_HELM, 27);
    assert.equal(player.getInventory().getFreeSlots(), 0);
    const before = Common.POINT_TYPES.map((type) => Common.points(player, type));
    Rewards.open(player);
    Rewards.select({ player, slot: slotOf(apprentice) });
    Rewards.confirm({ player });
    assert.equal(player.getInventory().getAmount(beginner), 0);
    assert.equal(player.getInventory().getAmount(apprentice), 1);
    assert.equal(player.getInventory().getFreeSlots(), 0);
    const cost = Rewards.price(apprentice);
    assert.deepEqual(Common.POINT_TYPES.map((type) => Common.points(player, type)), Common.POINT_TYPES.map((type, i) => before[i] - (cost[type] ?? 0)));
  });
});
